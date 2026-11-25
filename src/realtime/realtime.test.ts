import type { AddressInfo } from "node:net";
import { io as createClient } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NotificationType, OrgRole } from "@/generated/prisma/enums";
import { forbidden, notFound } from "@/server/http/errors";
import type { AuthRepository, AuthUserRecord } from "@/server/modules/auth/auth.repository";
import { signAccessToken } from "@/server/modules/auth/crypto";
import type {
  ActivityLogRecord,
  NotificationRecord,
  NotificationRepository,
} from "@/server/modules/notification/notification.repository";
import {
  extractMentionedUserIds,
  NotificationService,
} from "@/server/modules/notification/notification.service";
import type { TenancyService } from "@/server/modules/organization/tenancy.service";
import {
  REALTIME_EVENTS,
  rooms,
  signInternalPayload,
} from "./events";
import { createRealtimeServer } from "./server";

function buildMockAuthRepo(users: AuthUserRecord[], activeSessionIds: Set<string>): AuthRepository {
  const map = new Map(users.map((u) => [u.id, u]));
  return {
    findUserByEmail: async (email) => users.find((u) => u.email === email) ?? null,
    findUserById: async (id) => map.get(id) ?? null,
    listUserOrganizations: async () => [],
    createUserWithSessionAndVerifyToken: async () => {
      throw new Error("unused");
    },
    createSession: async () => ({ id: "s" }),
    findSessionByRefreshHash: async () => null,
    findActiveSessionById: async (sid) => {
      if (!activeSessionIds.has(sid)) return null;
      const uid = sid.replace("ses_", "u_");
      return { id: sid, userId: uid };
    },
    rotateSession: async () => null,
    revokeSessionFamily: async () => {},
    revokeSessionById: async () => {},
    revokeSessionByRefreshHash: async () => {},
    revokeAllUserSessions: async () => {},
    consumeEmailVerificationToken: async () => false,
    createPasswordResetToken: async () => {},
    consumePasswordResetAndUpdatePassword: async () => false,
  };
}

class MemNotificationRepo implements NotificationRepository {
  rows: NotificationRecord[] = [];
  logs: ActivityLogRecord[] = [];
  private seq = 0;

  async createNotifications(
    items: Array<{
      orgId: string;
      userId: string;
      type: NotificationType;
      title: string;
      linkUrl?: string | null;
      payload?: Record<string, unknown>;
    }>,
  ) {
    const out: NotificationRecord[] = [];
    for (const item of items) {
      this.seq += 1;
      const rec: NotificationRecord = {
        id: `ntf_${this.seq}`,
        orgId: item.orgId,
        userId: item.userId,
        type: item.type,
        title: item.title,
        linkUrl: item.linkUrl ?? null,
        payload: item.payload ?? {},
        readAt: null,
        createdAt: new Date(),
      };
      this.rows.unshift(rec);
      out.push(rec);
    }
    return out;
  }

  async listUserNotifications(params: {
    userId: string;
    unreadOnly: boolean;
    limit: number;
  }) {
    const filtered = this.rows.filter(
      (r) => r.userId === params.userId && (!params.unreadOnly || !r.readAt),
    );
    return {
      items: filtered.slice(0, params.limit),
      unreadCount: await this.countUnread(params.userId),
      nextCursor: null,
      hasMore: false,
    };
  }

  async markNotificationRead(notificationId: string, userId: string) {
    const found = this.rows.find((r) => r.id === notificationId && r.userId === userId);
    if (!found) return false;
    found.readAt = new Date();
    return true;
  }

  async markAllNotificationsRead(userId: string) {
    let n = 0;
    for (const r of this.rows) {
      if (r.userId === userId && !r.readAt) {
        r.readAt = new Date();
        n += 1;
      }
    }
    return n;
  }

  async countUnread(userId: string) {
    return this.rows.filter((r) => r.userId === userId && !r.readAt).length;
  }

  async findUserByEmail(email: string) {
    return email === "bob@acme.io" ? { id: "u_bob", email, name: "Bob" } : null;
  }

  async listProjectActivity() {
    return { items: this.logs, nextCursor: null, hasMore: false };
  }

  async listOrgAuditLogs() {
    return { items: this.logs, nextCursor: null, hasMore: false };
  }
}

describe("Phase 5 — Socket.IO Auth, Room Isolation, Presence & Notifications (WS-501..WS-504)", () => {
  let cleanupServer: (() => Promise<void>) | null = null;

  beforeEach(() => {
    cleanupServer = null;
  });

  afterEach(async () => {
    if (cleanupServer) await cleanupServer();
  });

  it("WS-501 & WS-502: authenticates handshake, authorizes project rooms, broadcasts to members, and blocks outsiders", async () => {
    const now = new Date();
    const users: AuthUserRecord[] = [
      {
        id: "u_alice",
        email: "alice@acme.io",
        name: "Alice",
        avatarUrl: null,
        passwordHash: "x",
        systemRole: "USER",
        locale: "th",
        emailVerifiedAt: now,
        disabledAt: null,
        createdAt: now,
      },
      {
        id: "u_eve",
        email: "eve@other.io",
        name: "Eve",
        avatarUrl: null,
        passwordHash: "x",
        systemRole: "USER",
        locale: "th",
        emailVerifiedAt: now,
        disabledAt: null,
        createdAt: now,
      },
    ];

    const authRepo = buildMockAuthRepo(users, new Set(["ses_alice", "ses_eve"]));
    const secret = "internal-bridge-test-secret-32chars!!";

    const srv = createRealtimeServer({
      authRepo,
      internalSecret: secret,
      projService: {
        resolveProjectContext: async (actorId, projectId) => {
          if (actorId === "u_alice" && projectId === "proj_alpha") {
            return {} as never;
          }
          throw notFound("Project not found");
        },
      },
    });
    cleanupServer = srv.close;

    await new Promise<void>((resolve) => srv.httpServer.listen(0, "127.0.0.1", () => resolve()));
    const port = (srv.httpServer.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}`;

    // 1. ไม่ส่ง Token ต้องเชื่อมต่อไม่สำเร็จ (UNAUTHENTICATED)
    const unauthClient = createClient(url, { reconnection: false });
    const unauthErr = await new Promise<Error>((resolve) => {
      unauthClient.on("connect_error", (err) => resolve(err));
    });
    expect(unauthErr.message).toBe("UNAUTHENTICATED");
    unauthClient.close();

    // 2. เชื่อมต่อ Alice (มีสิทธิ์เข้า proj_alpha) และ Eve (คนนอกองค์กร)
    const aliceToken = signAccessToken({
      userId: "u_alice",
      sessionId: "ses_alice",
      systemRole: "USER",
    });
    const eveToken = signAccessToken({
      userId: "u_eve",
      sessionId: "ses_eve",
      systemRole: "USER",
    });

    const aliceSocket = createClient(url, { auth: { token: aliceToken }, reconnection: false });
    const eveSocket = createClient(url, { auth: { token: eveToken }, reconnection: false });

    await Promise.all([
      new Promise<void>((r) => aliceSocket.on("connect", () => r())),
      new Promise<void>((r) => eveSocket.on("connect", () => r())),
    ]);

    const aliceJoinAck = await new Promise<{ ok: boolean; onlineUsers?: unknown[] }>((resolve) => {
      aliceSocket.emit("project:join", { projectId: "proj_alpha" }, resolve);
    });
    expect(aliceJoinAck.ok).toBe(true);
    expect(aliceJoinAck.onlineUsers).toHaveLength(1);

    // Eve พยายามแอบเข้าห้อง proj_alpha -> ต้องถูกปฏิเสธด้วย FORBIDDEN!
    const eveJoinAck = await new Promise<{ ok: boolean; code?: string }>((resolve) => {
      eveSocket.emit("project:join", { projectId: "proj_alpha" }, resolve);
    });
    expect(eveJoinAck).toEqual({ ok: false, code: "FORBIDDEN" });

    let eveReceivedIllegalEvent = false;
    eveSocket.on(REALTIME_EVENTS.TASK_MOVED, () => {
      eveReceivedIllegalEvent = true;
    });

    const aliceMovedPromise = new Promise<{ taskId: string }>((resolve) => {
      aliceSocket.on(REALTIME_EVENTS.TASK_MOVED, resolve);
    });

    // ทดสอบการส่งผ่าน Internal Publish Endpoint พร้อมตรวจลายเซ็น HMAC
    const badPublish = await fetch(`${url}/internal/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ws-signature": "forged" },
      body: JSON.stringify({ room: rooms.project("proj_alpha"), event: "task.moved", data: {} }),
    });
    expect(badPublish.status).toBe(401);

    const validBody = JSON.stringify({
      room: rooms.project("proj_alpha"),
      event: REALTIME_EVENTS.TASK_MOVED,
      data: { taskId: "tsk_99" },
    });
    const okPublish = await fetch(`${url}/internal/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ws-signature": signInternalPayload(validBody, secret),
      },
      body: validBody,
    });
    expect(okPublish.status).toBe(200);

    const movedData = await aliceMovedPromise;
    expect(movedData.taskId).toBe("tsk_99");
    await new Promise((r) => setTimeout(r, 40));
    expect(eveReceivedIllegalEvent).toBe(false);

    aliceSocket.close();
    eveSocket.close();
  });

  it("WS-503 & WS-504: extracts @mentions, manages unread notification lifecycle, and enforces audit log RBAC", async () => {
    const members = [
      { userId: "u_alice", email: "alice@acme.io", name: "Alice Wong" },
      { userId: "u_bob", email: "bob@acme.io", name: "Bob Chen" },
      { userId: "u_cara", email: "cara@acme.io", name: "Cara Lee" },
    ];

    // ผู้เขียนคอมเมนต์คือ u_alice กล่าวถึง @bob และ @cara@acme.io (ไม่แจ้งเตือนตัวเองซ้ำ)
    const mentioned = extractMentionedUserIds(
      "Hey @alice and @bob please check with @cara@acme.io!",
      members,
      "u_alice",
    );
    expect(mentioned.sort()).toEqual(["u_bob", "u_cara"]);

    const repo = new MemNotificationRepo();
    const roleByUser: Record<string, OrgRole> = {
      u_alice: "ORG_OWNER",
      u_bob: "MEMBER",
    };
    const mockTenancy = {
      resolveOrgContext: async (actorId: string, _orgId: string, perm: string) => {
        const role = roleByUser[actorId];
        if (!role) throw notFound();
        if (perm === "org:read_audit" && role === "MEMBER") throw forbidden();
        return {} as never;
      },
    } as unknown as TenancyService;

    const svc = new NotificationService(repo, mockTenancy);

    await svc.dispatch([
      { orgId: "org_1", userId: "u_bob", type: "TASK_ASSIGNED", title: "ENG-1 assigned" },
      { orgId: "org_1", userId: "u_bob", type: "MENTIONED", title: "Mentioned in ENG-1" },
    ]);

    const list1 = await svc.listMyNotifications("u_bob");
    expect(list1.unreadCount).toBe(2);

    // คนอื่นกดอ่านแจ้งเตือนของ Bob ไม่ได้ (404)
    await expect(svc.markRead("u_alice", list1.items[0]!.id)).rejects.toMatchObject({
      status: 404,
    });

    const readOne = await svc.markRead("u_bob", list1.items[0]!.id);
    expect(readOne.unreadCount).toBe(1);

    const cleared = await svc.markAllRead("u_bob");
    expect(cleared.unreadCount).toBe(0);

    // Audit Logs: MEMBER ถูกปฏิเสธด้วย 403, ส่วน ORG_OWNER ดูได้สำเร็จ
    await expect(svc.listOrgAuditLogs("u_bob", "org_1")).rejects.toMatchObject({ status: 403 });
    const audit = await svc.listOrgAuditLogs("u_alice", "org_1");
    expect(audit.items).toEqual([]);
  });
});
