import type { ColumnCategory, TaskPriority } from "@/generated/prisma/enums";
import { comparePositions } from "@/lib/ordering/fractional-index";
import {
  CACHE_TTL,
  cache,
  CacheKeys,
  MemoryCacheAdapter,
  rememberCached,
  type CacheAdapter,
} from "@/server/infra/cache";
import {
  tenancyService,
  type TenancyService,
} from "@/server/modules/organization/tenancy.service";
import {
  projectTaskService,
  type ProjectTaskService,
} from "@/server/modules/project/project-task.service";
import {
  prismaAnalyticsRepository,
  type AnalyticsRepository,
} from "./analytics.repository";

const DUE_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 วันข้างหน้า
const PRIORITY_ORDER: ReadonlyArray<TaskPriority> = [
  "HIGHEST",
  "HIGH",
  "MEDIUM",
  "LOW",
  "LOWEST",
];

export interface OrgDashboardSummaryDto {
  totals: {
    projects: number;
    totalTasks: number;
    completedTasks: number;
    openTasks: number;
    overdueTasks: number;
    dueSoonTasks: number;
    completionRate: number;
  };
  myWork: {
    assignedOpenCount: number;
    overdueCount: number;
    dueSoonCount: number;
    tasks: Array<{
      id: string;
      key: string;
      title: string;
      priority: TaskPriority;
      dueDate: string | null;
      projectId: string;
      projectName: string;
      columnName: string;
    }>;
  };
}

export interface ProjectAnalyticsDto {
  totals: {
    totalTasks: number;
    completedTasks: number;
    openTasks: number;
    overdueTasks: number;
    completionRate: number;
  };
  byStatus: Array<{
    columnId: string;
    name: string;
    category: ColumnCategory;
    count: number;
    percentage: number;
  }>;
  byPriority: Array<{
    priority: TaskPriority;
    count: number;
    percentage: number;
  }>;
  byAssignee: Array<{
    userId: string | null;
    name: string;
    total: number;
    completed: number;
    open: number;
  }>;
}

function roundPercent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

export class AnalyticsService {
  private readonly cacheStore: CacheAdapter;

  constructor(
    private readonly repo: AnalyticsRepository = prismaAnalyticsRepository,
    private readonly tenancy: TenancyService = tenancyService,
    private readonly projects: ProjectTaskService = projectTaskService,
    cacheStore?: CacheAdapter,
  ) {
    this.cacheStore =
      cacheStore ?? (repo === prismaAnalyticsRepository ? cache : new MemoryCacheAdapter());
  }

  async getOrganizationDashboardSummary(
    actorId: string,
    orgId: string,
    now = new Date(),
  ): Promise<OrgDashboardSummaryDto> {
    await this.tenancy.resolveOrgContext(actorId, orgId, "org:read");

    return rememberCached(
      CacheKeys.orgDashboard(orgId, actorId),
      CACHE_TTL.DASHBOARD,
      async () => {
        const dueSoonUntil = new Date(now.getTime() + DUE_SOON_WINDOW_MS);
        const raw = await this.repo.loadOrgDashboardRaw({
          orgId,
          userId: actorId,
          now,
          dueSoonUntil,
        });

        const openTasks = Math.max(0, raw.totalTasks - raw.completedTasks);

        return {
          totals: {
            projects: raw.projectsCount,
            totalTasks: raw.totalTasks,
            completedTasks: raw.completedTasks,
            openTasks,
            overdueTasks: raw.overdueTasks,
            dueSoonTasks: raw.dueSoonTasks,
            completionRate: roundPercent(raw.completedTasks, raw.totalTasks),
          },
          myWork: {
            assignedOpenCount: raw.myAssignedOpenCount,
            overdueCount: raw.myOverdueCount,
            dueSoonCount: raw.myDueSoonCount,
            tasks: raw.myTasks.map((t) => ({
              id: t.id,
              key: t.key,
              title: t.title,
              priority: t.priority,
              dueDate: t.dueDate ? t.dueDate.toISOString() : null,
              projectId: t.projectId,
              projectName: t.projectName,
              columnName: t.columnName,
            })),
          },
        };
      },
      this.cacheStore,
    );
  }

  async getProjectAnalytics(
    actorId: string,
    projectId: string,
    now = new Date(),
  ): Promise<ProjectAnalyticsDto> {
    const ctx = await this.projects.resolveProjectContext(actorId, projectId, "analytics:read");

    return rememberCached(
      CacheKeys.projectStats(projectId),
      CACHE_TTL.DASHBOARD,
      async () => {
        const raw = await this.repo.loadProjectAnalyticsRaw({
          projectId,
          orgId: ctx.org.id,
        });

        const sortedCols = [...raw.columns].sort((a, b) =>
          comparePositions(a.position, b.position),
        );
        const colMap = new Map(sortedCols.map((c) => [c.id, c]));

        const totalTasks = raw.tasks.length;
        let completedTasks = 0;
        let overdueTasks = 0;

        const statusCounts = new Map<string, number>();
        const priorityCounts = new Map<TaskPriority, number>();
        const assigneeStats = new Map<
          string,
          { userId: string | null; name: string; total: number; completed: number; open: number }
        >();

        for (const col of sortedCols) statusCounts.set(col.id, 0);
        for (const p of PRIORITY_ORDER) priorityCounts.set(p, 0);

        for (const t of raw.tasks) {
          const col = colMap.get(t.columnId);
          const isDone = col?.category === "DONE" || t.completedAt !== null;
          if (isDone) {
            completedTasks += 1;
          } else if (t.dueDate && t.dueDate.getTime() < now.getTime()) {
            overdueTasks += 1;
          }

          statusCounts.set(t.columnId, (statusCounts.get(t.columnId) ?? 0) + 1);
          priorityCounts.set(t.priority, (priorityCounts.get(t.priority) ?? 0) + 1);

          const aKey = t.assigneeId ?? "__unassigned__";
          const existing = assigneeStats.get(aKey) ?? {
            userId: t.assigneeId,
            name: t.assigneeName ?? "Unassigned",
            total: 0,
            completed: 0,
            open: 0,
          };
          existing.total += 1;
          if (isDone) existing.completed += 1;
          else existing.open += 1;
          assigneeStats.set(aKey, existing);
        }

        const openTasks = Math.max(0, totalTasks - completedTasks);

        return {
          totals: {
            totalTasks,
            completedTasks,
            openTasks,
            overdueTasks,
            completionRate: roundPercent(completedTasks, totalTasks),
          },
          byStatus: sortedCols.map((col) => {
            const count = statusCounts.get(col.id) ?? 0;
            return {
              columnId: col.id,
              name: col.name,
              category: col.category,
              count,
              percentage: roundPercent(count, totalTasks),
            };
          }),
          byPriority: PRIORITY_ORDER.map((priority) => {
            const count = priorityCounts.get(priority) ?? 0;
            return {
              priority,
              count,
              percentage: roundPercent(count, totalTasks),
            };
          }),
          byAssignee: [...assigneeStats.values()].sort((a, b) => b.total - a.total),
        };
      },
      this.cacheStore,
    );
  }
}

export const analyticsService = new AnalyticsService();
