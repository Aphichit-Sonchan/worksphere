import {
  ACCESS_COOKIE_NAME,
  parseCookiesHeader,
} from "@/server/modules/auth/cookies";
import { verifyAccessToken } from "@/server/modules/auth/crypto";
import {
  prismaAuthRepository,
  type AuthRepository,
} from "@/server/modules/auth/auth.repository";
import {
  projectTaskService,
  type ProjectTaskService,
} from "@/server/modules/project/project-task.service";
import type { PresenceUser } from "./events";

export interface SocketActor {
  userId: string;
  sessionId: string;
  name: string;
  email: string;
}

export async function authenticateSocketHandshake(
  handshake: {
    auth?: Record<string, unknown>;
    headers?: Record<string, string | string[] | undefined>;
  },
  authRepo: AuthRepository = prismaAuthRepository,
): Promise<SocketActor | null> {
  const authToken =
    typeof handshake.auth?.token === "string" && handshake.auth.token.trim()
      ? handshake.auth.token.trim()
      : null;

  const cookieHeader = Array.isArray(handshake.headers?.cookie)
    ? handshake.headers.cookie.join("; ")
    : (handshake.headers?.cookie ?? null);
  const cookieToken = parseCookiesHeader(cookieHeader)[ACCESS_COOKIE_NAME] ?? null;

  const rawToken = authToken ?? cookieToken;
  if (!rawToken) return null;

  const verified = verifyAccessToken(rawToken);
  if (!verified.ok) return null;

  const activeSession = await authRepo.findActiveSessionById(verified.payload.sid);
  if (!activeSession || activeSession.userId !== verified.payload.sub) {
    return null;
  }

  const user = await authRepo.findUserById(verified.payload.sub);
  if (!user || user.disabledAt) return null;

  return {
    userId: user.id,
    sessionId: activeSession.id,
    name: user.name,
    email: user.email,
  };
}

export async function authorizeProjectRoomJoin(
  actorId: string,
  projectId: string,
  projSvc: Pick<ProjectTaskService, "resolveProjectContext"> = projectTaskService,
): Promise<boolean> {
  if (!projectId || typeof projectId !== "string") return false;
  try {
    await projSvc.resolveProjectContext(actorId, projectId, "project:read");
    return true;
  } catch {
    return false;
  }
}

/** ติดตามรายชื่อสมาชิกที่กำลังเปิดบอร์ดโปรเจกต์เดียวกันแบบเรียลไทม์ (Online Presence) */
export class PresenceTracker {
  // projectId -> Map<socketId, PresenceUser>
  private readonly projectSockets = new Map<string, Map<string, PresenceUser>>();

  join(projectId: string, socketId: string, user: PresenceUser): PresenceUser[] {
    let map = this.projectSockets.get(projectId);
    if (!map) {
      map = new Map();
      this.projectSockets.set(projectId, map);
    }
    map.set(socketId, user);
    return this.listOnlineUsers(projectId);
  }

  leave(projectId: string, socketId: string): PresenceUser[] {
    const map = this.projectSockets.get(projectId);
    if (map) {
      map.delete(socketId);
      if (map.size === 0) this.projectSockets.delete(projectId);
    }
    return this.listOnlineUsers(projectId);
  }

  leaveAll(socketId: string): string[] {
    const affectedProjects: string[] = [];
    for (const [projectId, map] of this.projectSockets.entries()) {
      if (map.delete(socketId)) {
        affectedProjects.push(projectId);
        if (map.size === 0) this.projectSockets.delete(projectId);
      }
    }
    return affectedProjects;
  }

  listOnlineUsers(projectId: string): PresenceUser[] {
    const map = this.projectSockets.get(projectId);
    if (!map) return [];
    const dedup = new Map<string, PresenceUser>();
    for (const u of map.values()) {
      dedup.set(u.userId, u);
    }
    return [...dedup.values()];
  }
}
