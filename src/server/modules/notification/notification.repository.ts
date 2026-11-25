import type { Prisma } from "@/generated/prisma/client";
import type { NotificationType } from "@/generated/prisma/enums";
import { db } from "@/server/db";

export interface NotificationRecord {
  id: string;
  orgId: string;
  userId: string;
  type: NotificationType;
  title: string;
  linkUrl: string | null;
  payload: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

export interface ActivityLogRecord {
  id: string;
  orgId: string;
  workspaceId: string | null;
  projectId: string | null;
  taskId: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  actor: { id: string; name: string; email: string };
  createdAt: Date;
}

export interface NotificationRepository {
  createNotifications(
    items: Array<{
      orgId: string;
      userId: string;
      type: NotificationType;
      title: string;
      linkUrl?: string | null;
      payload?: Record<string, unknown>;
    }>,
  ): Promise<NotificationRecord[]>;
  listUserNotifications(params: {
    userId: string;
    unreadOnly: boolean;
    cursor?: string;
    limit: number;
  }): Promise<{
    items: NotificationRecord[];
    unreadCount: number;
    nextCursor: string | null;
    hasMore: boolean;
  }>;
  markNotificationRead(notificationId: string, userId: string): Promise<boolean>;
  markAllNotificationsRead(userId: string): Promise<number>;
  countUnread(userId: string): Promise<number>;
  findUserByEmail(email: string): Promise<{ id: string; email: string; name: string } | null>;

  listProjectActivity(params: {
    projectId: string;
    orgId: string;
    cursor?: string;
    limit: number;
  }): Promise<{ items: ActivityLogRecord[]; nextCursor: string | null; hasMore: boolean }>;
  listOrgAuditLogs(params: {
    orgId: string;
    cursor?: string;
    limit: number;
  }): Promise<{ items: ActivityLogRecord[]; nextCursor: string | null; hasMore: boolean }>;
}

function mapNotification(row: {
  id: string;
  orgId: string;
  userId: string;
  type: NotificationType;
  title: string;
  linkUrl: string | null;
  payload: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
}): NotificationRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    type: row.type,
    title: row.title,
    linkUrl: row.linkUrl,
    payload:
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

function mapActivity(row: {
  id: string;
  orgId: string;
  workspaceId: string | null;
  projectId: string | null;
  taskId: string | null;
  action: string;
  metadata: Prisma.JsonValue | null;
  actor: { id: string; name: string; email: string };
  createdAt: Date;
}): ActivityLogRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    taskId: row.taskId,
    action: row.action,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
    actor: row.actor,
    createdAt: row.createdAt,
  };
}

export class PrismaNotificationRepository implements NotificationRepository {
  async createNotifications(
    items: Array<{
      orgId: string;
      userId: string;
      type: NotificationType;
      title: string;
      linkUrl?: string | null;
      payload?: Record<string, unknown>;
    }>,
  ): Promise<NotificationRecord[]> {
    if (items.length === 0) return [];
    // WS-605: ใช้ createManyAndReturn ส่งคำสั่ง Batch เดียว ป้องกันปัญหา N+1 Queries
    const rows = await db.notification.createManyAndReturn({
      data: items.map((item) => ({
        orgId: item.orgId,
        userId: item.userId,
        type: item.type,
        title: item.title,
        linkUrl: item.linkUrl ?? null,
        payload: (item.payload ?? {}) as Prisma.InputJsonValue,
      })),
    });
    return rows.map(mapNotification);
  }

  async listUserNotifications(params: {
    userId: string;
    unreadOnly: boolean;
    cursor?: string;
    limit: number;
  }) {
    const [rows, unreadCount] = await Promise.all([
      db.notification.findMany({
        where: {
          userId: params.userId,
          ...(params.unreadOnly ? { readAt: null } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: params.limit + 1,
        ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      }),
      db.notification.count({
        where: { userId: params.userId, readAt: null },
      }),
    ]);

    const hasMore = rows.length > params.limit;
    const sliced = hasMore ? rows.slice(0, params.limit) : rows;
    return {
      items: sliced.map(mapNotification),
      unreadCount,
      nextCursor: hasMore ? (sliced.at(-1)?.id ?? null) : null,
      hasMore,
    };
  }

  async markNotificationRead(notificationId: string, userId: string): Promise<boolean> {
    const existing = await db.notification.findFirst({
      where: { id: notificationId, userId },
      select: { id: true, readAt: true },
    });
    if (!existing) return false;
    if (!existing.readAt) {
      await db.notification.update({
        where: { id: notificationId },
        data: { readAt: new Date() },
      });
    }
    return true;
  }

  async markAllNotificationsRead(userId: string): Promise<number> {
    const res = await db.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return res.count;
  }

  async countUnread(userId: string): Promise<number> {
    return db.notification.count({ where: { userId, readAt: null } });
  }

  async findUserByEmail(email: string) {
    return db.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, email: true, name: true },
    });
  }

  async listProjectActivity(params: {
    projectId: string;
    orgId: string;
    cursor?: string;
    limit: number;
  }) {
    const rows = await db.activityLog.findMany({
      where: { projectId: params.projectId, orgId: params.orgId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      include: { actor: { select: { id: true, name: true, email: true } } },
    });

    const hasMore = rows.length > params.limit;
    const sliced = hasMore ? rows.slice(0, params.limit) : rows;
    return {
      items: sliced.map(mapActivity),
      nextCursor: hasMore ? (sliced.at(-1)?.id ?? null) : null,
      hasMore,
    };
  }

  async listOrgAuditLogs(params: { orgId: string; cursor?: string; limit: number }) {
    const rows = await db.activityLog.findMany({
      where: { orgId: params.orgId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      include: { actor: { select: { id: true, name: true, email: true } } },
    });

    const hasMore = rows.length > params.limit;
    const sliced = hasMore ? rows.slice(0, params.limit) : rows;
    return {
      items: sliced.map(mapActivity),
      nextCursor: hasMore ? (sliced.at(-1)?.id ?? null) : null,
      hasMore,
    };
  }
}

export const prismaNotificationRepository = new PrismaNotificationRepository();
