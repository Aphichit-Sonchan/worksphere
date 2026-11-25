import { describe, expect, it } from "vitest";
import { wouldCreateDependencyCycle } from "@/lib/graph/dependency-dag";
import {
  comparePositions,
  generateInitialPositions,
  generatePositionBetween,
} from "@/lib/ordering/fractional-index";
import { notFound } from "@/server/http/errors";
import { CacheKeys, MemoryCacheAdapter } from "@/server/infra/cache";
import type { TenancyService } from "@/server/modules/organization/tenancy.service";
import type { ProjectTaskService } from "@/server/modules/project/project-task.service";
import type { AnalyticsRepository } from "./analytics.repository";
import { AnalyticsService } from "./analytics.service";

describe("Phase 7 Unit & Analytics Suite (WS-701, WS-705)", () => {
  it("computes organization dashboard & project analytics accurately with zero-division safety and caching", async () => {
    const cacheStore = new MemoryCacheAdapter();
    let orgCalls = 0;
    let projectCalls = 0;

    const fakeRepo: AnalyticsRepository = {
      async loadOrgDashboardRaw() {
        orgCalls += 1;
        return {
          projectsCount: 3,
          totalTasks: 20,
          completedTasks: 13,
          overdueTasks: 2,
          dueSoonTasks: 4,
          myAssignedOpenCount: 3,
          myOverdueCount: 1,
          myDueSoonCount: 2,
          myTasks: [
            {
              id: "tsk_1",
              key: "ENG-12",
              title: "Optimize SQL query plan",
              priority: "HIGHEST",
              dueDate: new Date("2026-11-26T00:00:00Z"),
              projectId: "proj_1",
              projectName: "Core Platform",
              columnName: "In Progress",
            },
          ],
        };
      },
      async loadProjectAnalyticsRaw({ projectId }) {
        projectCalls += 1;
        if (projectId === "proj_empty") {
          return {
            columns: [
              { id: "c1", name: "To Do", category: "TODO", position: "a" },
              { id: "c2", name: "Done", category: "DONE", position: "b" },
            ],
            tasks: [],
          };
        }
        return {
          columns: [
            { id: "c_done", name: "Done", category: "DONE", position: "c" },
            { id: "c_todo", name: "To Do", category: "TODO", position: "a" },
            { id: "c_prog", name: "In Progress", category: "IN_PROGRESS", position: "b" },
          ],
          tasks: [
            {
              columnId: "c_done",
              priority: "HIGH",
              assigneeId: "u_1",
              assigneeName: "Alice",
              dueDate: new Date("2026-11-20T00:00:00Z"),
              completedAt: new Date("2026-11-19T00:00:00Z"),
            },
            {
              columnId: "c_prog",
              priority: "HIGHEST",
              assigneeId: "u_1",
              assigneeName: "Alice",
              dueDate: new Date("2026-11-20T00:00:00Z"), // overdue!
              completedAt: null,
            },
            {
              columnId: "c_todo",
              priority: "MEDIUM",
              assigneeId: null,
              assigneeName: null,
              dueDate: new Date("2026-11-30T00:00:00Z"),
              completedAt: null,
            },
            {
              columnId: "c_done",
              priority: "HIGH",
              assigneeId: "u_2",
              assigneeName: "Bob",
              dueDate: null,
              completedAt: new Date("2026-11-22T00:00:00Z"),
            },
          ],
        };
      },
    };

    const fakeTenancy = {
      async resolveOrgContext(actorId: string, orgId: string) {
        if (orgId !== "org_1" || actorId === "u_outsider") {
          throw notFound("Organization not found");
        }
        return { org: { id: orgId }, actorId, orgRole: "MEMBER" };
      },
    } as unknown as TenancyService;

    const fakeProjects = {
      async resolveProjectContext(actorId: string, projectId: string) {
        if (actorId === "u_outsider") throw notFound("Project not found");
        return { org: { id: "org_1" }, project: { id: projectId }, projectRole: "MEMBER" };
      },
    } as unknown as ProjectTaskService;

    const svc = new AnalyticsService(fakeRepo, fakeTenancy, fakeProjects, cacheStore);
    const fixedNow = new Date("2026-11-25T00:00:00Z");

    const summary1 = await svc.getOrganizationDashboardSummary("u_1", "org_1", fixedNow);
    const summary2 = await svc.getOrganizationDashboardSummary("u_1", "org_1", fixedNow);
    expect(orgCalls).toBe(1); // Hit read-through cache on second call
    expect(summary1.totals).toEqual({
      projects: 3,
      totalTasks: 20,
      completedTasks: 13,
      openTasks: 7,
      overdueTasks: 2,
      dueSoonTasks: 4,
      completionRate: 65,
    });
    expect(summary2.myWork.tasks[0]?.key).toBe("ENG-12");

    // Empty project must return 0% completion rate without NaN
    const emptyStats = await svc.getProjectAnalytics("u_1", "proj_empty", fixedNow);
    expect(emptyStats.totals.completionRate).toBe(0);
    expect(emptyStats.byStatus.every((s) => s.percentage === 0)).toBe(true);

    // Populated project must sort columns by fractional position and aggregate status/priority/assignee
    const stats = await svc.getProjectAnalytics("u_1", "proj_1", fixedNow);
    const cachedStats = await svc.getProjectAnalytics("u_1", "proj_1", fixedNow);
    expect(projectCalls).toBe(2); // 1 for proj_empty + 1 for proj_1 (cached on repeat)
    expect(cachedStats.totals).toEqual({
      totalTasks: 4,
      completedTasks: 2,
      openTasks: 2,
      overdueTasks: 1,
      completionRate: 50,
    });
    expect(stats.byStatus.map((s) => s.name)).toEqual(["To Do", "In Progress", "Done"]);
    expect(stats.byStatus.find((s) => s.name === "Done")).toMatchObject({
      count: 2,
      percentage: 50,
    });
    expect(stats.byPriority.find((p) => p.priority === "HIGH")).toMatchObject({
      count: 2,
      percentage: 50,
    });
    expect(stats.byAssignee[0]).toEqual({
      userId: "u_1",
      name: "Alice",
      total: 2,
      completed: 1,
      open: 1,
    });

    // Invalidation clears cached stats
    await cacheStore.del(CacheKeys.projectStats("proj_1"));
    await svc.getProjectAnalytics("u_1", "proj_1", fixedNow);
    expect(projectCalls).toBe(3);

    // Cross-tenant outsider receives 404 NOT_FOUND
    await expect(
      svc.getOrganizationDashboardSummary("u_outsider", "org_1", fixedNow),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("WS-701 stress: maintains strict ordering across 60 fractional-index insertions and complex diamond DAGs", () => {
    const positions = generateInitialPositions(5);
    // สุ่มแทรกการ์ดระหว่างตำแหน่งติดกัน 60 ครั้งติดต่อกัน ต้องเรียงลำดับถูกต้อง 100%
    for (let i = 0; i < 60; i += 1) {
      const idx = i % (positions.length - 1);
      const mid = generatePositionBetween(positions[idx]!, positions[idx + 1]!);
      expect(comparePositions(positions[idx]!, mid)).toBeLessThan(0);
      expect(comparePositions(mid, positions[idx + 1]!)).toBeLessThan(0);
      positions.splice(idx + 1, 0, mid);
    }

    for (let i = 1; i < positions.length; i += 1) {
      expect(comparePositions(positions[i - 1]!, positions[i]!)).toBeLessThan(0);
    }

    // Diamond DAG: T4 depends on T2 & T3; T2 & T3 both depend on T1 -> Valid (not a cycle)
    const edges = [
      { taskId: "T2", dependsOnTaskId: "T1" },
      { taskId: "T3", dependsOnTaskId: "T1" },
      { taskId: "T4", dependsOnTaskId: "T2" },
    ];
    expect(wouldCreateDependencyCycle(edges, { taskId: "T4", dependsOnTaskId: "T3" })).toBe(false);
    edges.push({ taskId: "T4", dependsOnTaskId: "T3" });

    // Making T1 depend on T4 closes a 4-node cycle (T1 -> T4 -> T2 -> T1) -> Blocked!
    expect(wouldCreateDependencyCycle(edges, { taskId: "T1", dependsOnTaskId: "T4" })).toBe(true);
  });
});
