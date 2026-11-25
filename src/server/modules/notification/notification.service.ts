import type { NotificationType } from "@/generated/prisma/enums";
import { publishRealtimeEvent, REALTIME_EVENTS, rooms } from "@/realtime/events";
import { notFound } from "@/server/http/errors";
import {
  tenancyService,
  type TenancyService,
} from "@/server/modules/organization/tenancy.service";
import {
  prismaNotificationRepository,
  type NotificationRepository,
} from "./notification.repository";

/**
 * ดึงรายชื่อสมาชิกที่ถูก `@mention` ในข้อความ (รองรับทั้ง `@email@domain.com` และ `@ชื่อ`)
 */
export function extractMentionedUserIds(
  body: string,
  candidates: ReadonlyArray<{ userId: string; email: string; name: string }>,
  excludeUserId?: string,
): string[] {
  const matched = new Set<string>();
  const lowerBody = body.toLowerCase();

  for (const member of candidates) {
    if (member.userId === excludeUserId) continue;
    const emailToken = `@${member.email.toLowerCase()}`;
    const localPart = `@${member.email.split("@")[0]?.toLowerCase() ?? ""}`;
    const compactName = `@${member.name.toLowerCase().replace(/\s+/g, "")}`;
    const firstWordName = `@${member.name.trim().split(/\s+/)[0]?.toLowerCase() ?? ""}`;

    if (
      lowerBody.includes(emailToken) ||
      (localPart.length > 2 && lowerBody.includes(localPart)) ||
      (compactName.length > 2 && lowerBody.includes(compactName)) ||
      (firstWordName.length > 2 && lowerBody.includes(firstWordName))
    ) {
      matched.add(member.userId);
    }
  }

  return [...matched];
}

export class NotificationService {
  constructor(
    private readonly repo: NotificationRepository = prismaNotificationRepository,
    private readonly tenancy: TenancyService = tenancyService,
  ) {}

  async dispatch(
    items: Array<{
      orgId: string;
      userId: string;
      type: NotificationType;
      title: string;
      linkUrl?: string | null;
      payload?: Record<string, unknown>;
    }>,
  ) {
    if (items.length === 0) return [];
    const created = await this.repo.createNotifications(items);

    await Promise.all(
      created.map(async (notif) => {
        const unreadCount = await this.repo.countUnread(notif.userId);
        await publishRealtimeEvent(
          rooms.user(notif.userId),
          REALTIME_EVENTS.NOTIFICATION_CREATED,
          { notification: notif, unreadCount },
        );
      }),
    );

    return created;
  }

  async notifyInvitedEmailIfRegistered(params: {
    orgId: string;
    orgName: string;
    email: string;
    invitePath: string;
  }) {
    const existingUser = await this.repo.findUserByEmail(params.email);
    if (!existingUser) return;
    await this.dispatch([
      {
        orgId: params.orgId,
        userId: existingUser.id,
        type: "INVITED",
        title: `You have been invited to join ${params.orgName}`,
        linkUrl: params.invitePath,
        payload: { orgName: params.orgName },
      },
    ]);
  }

  async listMyNotifications(
    userId: string,
    options: { unreadOnly?: boolean; cursor?: string; limit?: number } = {},
  ) {
    return this.repo.listUserNotifications({
      userId,
      unreadOnly: options.unreadOnly ?? false,
      cursor: options.cursor,
      limit: Math.min(Math.max(options.limit ?? 30, 1), 100),
    });
  }

  async markRead(userId: string, notificationId: string) {
    const ok = await this.repo.markNotificationRead(notificationId, userId);
    if (!ok) {
      throw notFound("Notification not found");
    }
    const unreadCount = await this.repo.countUnread(userId);
    return { read: true, unreadCount };
  }

  async markAllRead(userId: string) {
    const updatedCount = await this.repo.markAllNotificationsRead(userId);
    return { updatedCount, unreadCount: 0 };
  }

  async listOrgAuditLogs(
    actorId: string,
    orgId: string,
    options: { cursor?: string; limit?: number } = {},
  ) {
    await this.tenancy.resolveOrgContext(actorId, orgId, "org:read_audit");
    return this.repo.listOrgAuditLogs({
      orgId,
      cursor: options.cursor,
      limit: Math.min(Math.max(options.limit ?? 30, 1), 100),
    });
  }

  async listProjectActivityDirect(params: {
    orgId: string;
    projectId: string;
    cursor?: string;
    limit?: number;
  }) {
    return this.repo.listProjectActivity({
      orgId: params.orgId,
      projectId: params.projectId,
      cursor: params.cursor,
      limit: Math.min(Math.max(params.limit ?? 40, 1), 100),
    });
  }
}

export const notificationService = new NotificationService();
