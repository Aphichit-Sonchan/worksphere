import type { ColumnCategory, TaskPriority } from "@/generated/prisma/enums";
import { db } from "@/server/db";

export interface DashboardTaskItem {
  id: string;
  key: string;
  title: string;
  priority: TaskPriority;
  dueDate: Date | null;
  projectId: string;
  projectName: string;
  columnName: string;
}

export interface OrgDashboardRawData {
  projectsCount: number;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  dueSoonTasks: number;
  myAssignedOpenCount: number;
  myOverdueCount: number;
  myDueSoonCount: number;
  myTasks: DashboardTaskItem[];
}

export interface ProjectAnalyticsRawTask {
  columnId: string;
  priority: TaskPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: Date | null;
  completedAt: Date | null;
}

export interface ProjectAnalyticsRawData {
  columns: Array<{
    id: string;
    name: string;
    category: ColumnCategory;
    position: string;
  }>;
  tasks: ProjectAnalyticsRawTask[];
}

export interface AnalyticsRepository {
  loadOrgDashboardRaw(params: {
    orgId: string;
    userId: string;
    now: Date;
    dueSoonUntil: Date;
  }): Promise<OrgDashboardRawData>;

  loadProjectAnalyticsRaw(params: {
    projectId: string;
    orgId: string;
  }): Promise<ProjectAnalyticsRawData>;
}

class PrismaAnalyticsRepository implements AnalyticsRepository {
  async loadOrgDashboardRaw(params: {
    orgId: string;
    userId: string;
    now: Date;
    dueSoonUntil: Date;
  }): Promise<OrgDashboardRawData> {
    const openFilter = {
      orgId: params.orgId,
      deletedAt: null,
      completedAt: null,
      column: { category: { not: "DONE" as const } },
    };

    const [
      projectsCount,
      totalTasks,
      completedTasks,
      overdueTasks,
      dueSoonTasks,
      myAssignedOpenCount,
      myOverdueCount,
      myDueSoonCount,
      myTaskRows,
    ] = await Promise.all([
      db.project.count({ where: { orgId: params.orgId, deletedAt: null } }),
      db.task.count({ where: { orgId: params.orgId, deletedAt: null } }),
      db.task.count({
        where: {
          orgId: params.orgId,
          deletedAt: null,
          OR: [{ completedAt: { not: null } }, { column: { category: "DONE" } }],
        },
      }),
      db.task.count({
        where: { ...openFilter, dueDate: { lt: params.now } },
      }),
      db.task.count({
        where: { ...openFilter, dueDate: { gte: params.now, lte: params.dueSoonUntil } },
      }),
      db.task.count({
        where: { ...openFilter, assigneeId: params.userId },
      }),
      db.task.count({
        where: { ...openFilter, assigneeId: params.userId, dueDate: { lt: params.now } },
      }),
      db.task.count({
        where: {
          ...openFilter,
          assigneeId: params.userId,
          dueDate: { gte: params.now, lte: params.dueSoonUntil },
        },
      }),
      db.task.findMany({
        where: { ...openFilter, assigneeId: params.userId },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        take: 8,
        include: {
          project: { select: { id: true, key: true, name: true } },
          column: { select: { name: true } },
        },
      }),
    ]);

    return {
      projectsCount,
      totalTasks,
      completedTasks,
      overdueTasks,
      dueSoonTasks,
      myAssignedOpenCount,
      myOverdueCount,
      myDueSoonCount,
      myTasks: myTaskRows.map((t) => ({
        id: t.id,
        key: `${t.project.key}-${t.number}`,
        title: t.title,
        priority: t.priority,
        dueDate: t.dueDate,
        projectId: t.project.id,
        projectName: t.project.name,
        columnName: t.column.name,
      })),
    };
  }

  async loadProjectAnalyticsRaw(params: {
    projectId: string;
    orgId: string;
  }): Promise<ProjectAnalyticsRawData> {
    const [columns, tasks] = await Promise.all([
      db.boardColumn.findMany({
        where: { projectId: params.projectId },
        orderBy: { position: "asc" },
        select: { id: true, name: true, category: true, position: true },
      }),
      db.task.findMany({
        where: {
          projectId: params.projectId,
          orgId: params.orgId,
          deletedAt: null,
        },
        select: {
          columnId: true,
          priority: true,
          assigneeId: true,
          dueDate: true,
          completedAt: true,
          assignee: { select: { name: true } },
        },
      }),
    ]);

    return {
      columns,
      tasks: tasks.map((t) => ({
        columnId: t.columnId,
        priority: t.priority,
        assigneeId: t.assigneeId,
        assigneeName: t.assignee?.name ?? null,
        dueDate: t.dueDate,
        completedAt: t.completedAt,
      })),
    };
  }
}

export const prismaAnalyticsRepository: AnalyticsRepository = new PrismaAnalyticsRepository();
