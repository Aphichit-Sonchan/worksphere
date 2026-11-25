import { db } from "@/server/db";
import { mailer, type MailAdapter } from "@/server/infra/mailer";
import { getStorage, type StorageAdapter } from "@/server/infra/storage";
import { notificationService } from "@/server/modules/notification/notification.service";

export const JOB_NAMES = {
  INVITATION_EMAIL: "invitation.send_email",
  DEADLINE_REMINDER: "task.deadline_reminder",
  PROJECT_EXPORT: "project.export_tasks",
  WEEKLY_SUMMARY: "org.weekly_summary",
} as const;

export interface ExportRow {
  key: string;
  title: string;
  status: string;
  category: string;
  priority: string;
  assignee: string;
  dueDate: string;
  completedAt: string;
}

function escapeCsvCell(value: string): string {
  // ป้องกัน CSV Formula Injection (=, +, -, @) และครอบเครื่องหมายคำพูดอย่างถูกต้อง
  const neutralized = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

export function serializeTasksExport(rows: ExportRow[], format: "csv" | "json"): Buffer {
  if (format === "json") {
    return Buffer.from(JSON.stringify(rows, null, 2), "utf8");
  }

  const header = [
    "Key",
    "Title",
    "Status",
    "Category",
    "Priority",
    "Assignee",
    "DueDate",
    "CompletedAt",
  ].join(",");

  const lines = rows.map((r) =>
    [
      escapeCsvCell(r.key),
      escapeCsvCell(r.title),
      escapeCsvCell(r.status),
      escapeCsvCell(r.category),
      escapeCsvCell(r.priority),
      escapeCsvCell(r.assignee),
      escapeCsvCell(r.dueDate),
      escapeCsvCell(r.completedAt),
    ].join(","),
  );

  return Buffer.from([header, ...lines].join("\n"), "utf8");
}

export async function runProjectExportJob(
  params: {
    exportId: string;
    orgId: string;
    projectId: string;
    requestedByUserId: string;
    format: "csv" | "json";
  },
  storage: StorageAdapter = getStorage(),
): Promise<{ storageKey: string; rowCount: number }> {
  const project = await db.project.findUniqueOrThrow({
    where: { id: params.projectId },
    select: { key: true, name: true },
  });

  const tasks = await db.task.findMany({
    where: {
      projectId: params.projectId,
      orgId: params.orgId,
      deletedAt: null,
    },
    orderBy: { number: "asc" },
    include: {
      column: { select: { name: true, category: true } },
      assignee: { select: { name: true, email: true } },
    },
  });

  const rows: ExportRow[] = tasks.map((t) => ({
    key: `${project.key}-${t.number}`,
    title: t.title,
    status: t.column.name,
    category: t.column.category,
    priority: t.priority,
    assignee: t.assignee ? `${t.assignee.name} <${t.assignee.email}>` : "",
    dueDate: t.dueDate ? t.dueDate.toISOString() : "",
    completedAt: t.completedAt ? t.completedAt.toISOString() : "",
  }));

  const bytes = serializeTasksExport(rows, params.format);
  const mimeType = params.format === "json" ? "application/json" : "text/csv; charset=utf-8";
  const storageKey = `exports/${params.orgId}/${params.projectId}/${params.exportId}.${params.format}`;

  await storage.put(storageKey, bytes, mimeType);

  await notificationService.dispatch([
    {
      orgId: params.orgId,
      userId: params.requestedByUserId,
      type: "STATUS_CHANGED",
      title: `Export ready for ${project.name} (${rows.length} tasks)`,
      linkUrl: `/api/v1/projects/${params.projectId}/exports/${params.exportId}?format=${params.format}`,
      payload: { exportId: params.exportId, format: params.format, rowCount: rows.length },
    },
  ]);

  return { storageKey, rowCount: rows.length };
}

export async function runDeadlineReminderSweep(
  now = new Date(),
  mail: MailAdapter = mailer,
): Promise<number> {
  const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const dueSoon = await db.task.findMany({
    where: {
      deletedAt: null,
      completedAt: null,
      assigneeId: { not: null },
      dueDate: { gt: now, lte: in24Hours },
      column: { category: { not: "DONE" } },
    },
    include: {
      project: { select: { key: true } },
      assignee: { select: { id: true, email: true, name: true } },
    },
    take: 200,
  });

  if (dueSoon.length === 0) return 0;

  await notificationService.dispatch(
    dueSoon.map((t) => ({
      orgId: t.orgId,
      userId: t.assignee!.id,
      type: "TASK_ASSIGNED" as const,
      title: `Reminder: ${t.project.key}-${t.number} "${t.title}" is due soon`,
      linkUrl: `/app/projects/${t.projectId}`,
      payload: { taskId: t.id },
    })),
  );

  for (const t of dueSoon) {
    await mail.send({
      to: t.assignee!.email,
      subject: `Due soon: ${t.project.key}-${t.number} ${t.title}`,
      text: `Hi ${t.assignee!.name}, task ${t.project.key}-${t.number} is due at ${t.dueDate?.toISOString()}.`,
    });
  }

  return dueSoon.length;
}

export async function runWeeklyOrgSummaryJob(
  orgId: string,
  mail: MailAdapter = mailer,
): Promise<void> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [org, completedCount, openCount, owners] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    db.task.count({ where: { orgId, deletedAt: null, completedAt: { gte: since } } }),
    db.task.count({ where: { orgId, deletedAt: null, completedAt: null } }),
    db.organizationMember.findMany({
      where: { orgId, role: "ORG_OWNER" },
      include: { user: { select: { email: true, name: true } } },
    }),
  ]);
  if (!org) return;

  for (const owner of owners) {
    await mail.send({
      to: owner.user.email,
      subject: `Weekly Summary — ${org.name}`,
      text: `Hello ${owner.user.name}, this week in ${org.name}: ${completedCount} tasks completed, ${openCount} tasks currently open.`,
    });
  }
}
