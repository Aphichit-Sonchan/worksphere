import type { TaskPriority } from "@/generated/prisma/enums";
import { wouldCreateDependencyCycle } from "@/lib/graph/dependency-dag";
import { generatePositionBetween } from "@/lib/ordering/fractional-index";
import type {
  CreateColumnInput,
  CreateProjectInput,
  CreateSubtaskInput,
  CreateTagInput,
  CreateTaskInput,
  MoveTaskInput,
  TaskQueryInput,
  UpdateColumnInput,
  UpdateProjectInput,
  UpdateTaskInput,
} from "@/lib/validation/project-task";
import { publishRealtimeEvent, REALTIME_EVENTS, rooms } from "@/realtime/events";
import { badRequest, conflict, forbidden, notFound } from "@/server/http/errors";
import {
  CACHE_TTL,
  cache,
  CacheKeys,
  MemoryCacheAdapter,
  rememberCached,
  type CacheAdapter,
} from "@/server/infra/cache";
import { getStorage, type StorageAdapter } from "@/server/infra/storage";
import { generateOpaqueToken } from "@/server/modules/auth/crypto";
import {
  extractMentionedUserIds,
  notificationService,
  type NotificationService,
} from "@/server/modules/notification/notification.service";
import { serializeTasksExport, type ExportRow } from "@/workers/processors";
import {
  tenancyService,
  type OrgContext,
  type TenancyService,
} from "@/server/modules/organization/tenancy.service";
import {
  effectiveProjectRole,
  orgRoleHas,
  projectRoleHas,
  type ProjectPermission,
  type ProjectRole,
} from "@/server/permissions/roles";
import {
  prismaProjectTaskRepository,
  type ProjectRecord,
  type ProjectTaskRepository,
} from "./project-task.repository";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
const VALID_PRIORITIES = new Set<TaskPriority>(["LOWEST", "LOW", "MEDIUM", "HIGH", "HIGHEST"]);

export interface ProjectContext extends OrgContext {
  project: ProjectRecord;
  projectRole: ProjectRole;
}

function sanitizeFileName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-\u0E00-\u0E7F]/g, "_").slice(0, 120) || "attachment.bin";
}

export class ProjectTaskService {
  private readonly notifier: NotificationService | null;
  private readonly cacheStore: CacheAdapter;

  constructor(
    private readonly repo: ProjectTaskRepository = prismaProjectTaskRepository,
    private readonly tenancy: TenancyService = tenancyService,
    private readonly storage: StorageAdapter = getStorage(),
    notifier?: NotificationService | null,
    cacheStore?: CacheAdapter,
  ) {
    this.notifier =
      notifier !== undefined
        ? notifier
        : repo === prismaProjectTaskRepository
          ? notificationService
          : null;
    this.cacheStore =
      cacheStore ?? (repo === prismaProjectTaskRepository ? cache : new MemoryCacheAdapter());
  }

  private async invalidateProjectMeta(projectId: string) {
    await this.cacheStore.delByPrefix(`proj:${projectId}:`);
  }

  private async invalidateTaskStats(orgId: string, projectId: string) {
    await Promise.all([
      this.cacheStore.del(CacheKeys.projectStats(projectId)),
      this.cacheStore.delByPrefix(`org:${orgId}:dashboard:`),
    ]);
  }

  /**
   * ตรวจสิทธิ์ระดับโปรเจกต์พร้อมกั้นข้อมูลข้าม Tenant:
   * - ไม่พบโปรเจกต์ หรืออยู่คนละองค์กร หรือไม่ได้รับสิทธิ์เข้าถึงโปรเจกต์ -> 404 NOT_FOUND
   * - เข้าถึงโปรเจกต์ได้แต่ไม่มีสิทธิ์ทำรายการ -> 403 FORBIDDEN
   */
  async resolveProjectContext(
    actorId: string,
    projectId: string,
    requiredPermission: ProjectPermission = "project:read",
    ownership?: { ownerId: string },
  ): Promise<ProjectContext> {
    const project = await this.repo.findProjectById(projectId);
    if (!project) {
      throw notFound("Project not found");
    }

    const orgCtx = await this.tenancy.resolveOrgContext(actorId, project.orgId, "org:read");
    const explicitMember = await this.repo.findProjectMembership(projectId, actorId);
    const projectRole = effectiveProjectRole(orgCtx.orgRole, explicitMember?.role ?? null);

    if (!projectRole) {
      throw notFound("Project not found");
    }

    const allowed = projectRoleHas(
      projectRole,
      requiredPermission,
      ownership ? { ownerId: ownership.ownerId, userId: actorId } : undefined,
    );

    if (!allowed) {
      throw forbidden("You do not have permission to perform this project action");
    }

    return { ...orgCtx, project, projectRole };
  }

  // ───────────── Projects, Members, Columns & Tags (WS-401) ─────────────

  async listOrgProjects(actorId: string, orgId: string) {
    const orgCtx = await this.tenancy.resolveOrgContext(actorId, orgId, "org:read");
    const canSeeAll = orgRoleHas(orgCtx.orgRole, "workspace:manage_all");
    return this.repo.listProjectsForOrg(orgId, canSeeAll ? undefined : actorId);
  }

  async listWorkspaceProjects(actorId: string, workspaceId: string) {
    const wsCtx = await this.tenancy.resolveWorkspaceContext(
      actorId,
      workspaceId,
      "workspace:read",
    );
    const canSeeAll = orgRoleHas(wsCtx.orgRole, "workspace:manage_all");
    return this.repo.listProjectsForWorkspace(workspaceId, canSeeAll ? undefined : actorId);
  }

  async createProject(actorId: string, workspaceId: string, input: CreateProjectInput) {
    const wsCtx = await this.tenancy.resolveWorkspaceContext(
      actorId,
      workspaceId,
      "project:create",
    );

    const existingKey = await this.repo.findProjectByKey(wsCtx.org.id, input.key);
    if (existingKey) {
      throw conflict(`Project key "${input.key}" is already used in this organization`);
    }

    return this.repo.createProjectWithDefaults({
      orgId: wsCtx.org.id,
      workspaceId,
      key: input.key,
      name: input.name,
      description: input.description,
      creatorId: actorId,
    });
  }

  async getProjectOverview(actorId: string, projectId: string) {
    const ctx = await this.resolveProjectContext(actorId, projectId, "project:read");
    const meta = await rememberCached(
      CacheKeys.projectMeta(projectId),
      CACHE_TTL.PROJECT_META,
      async () => {
        const [columns, tags, members] = await Promise.all([
          this.repo.listColumns(projectId),
          this.repo.listTags(projectId),
          this.repo.listProjectMembers(projectId),
        ]);
        return { columns, tags, members };
      },
      this.cacheStore,
    );

    return {
      project: ctx.project,
      myProjectRole: ctx.projectRole,
      ...meta,
    };
  }

  async updateProject(actorId: string, projectId: string, input: UpdateProjectInput) {
    const perm = input.archived !== undefined ? "project:archive" : "project:update";
    const ctx = await this.resolveProjectContext(actorId, projectId, perm);

    const archivedAt =
      input.archived === undefined
        ? ctx.project.archivedAt
        : input.archived
          ? (ctx.project.archivedAt ?? new Date())
          : null;

    const updated = await this.repo.updateProject(projectId, {
      name: input.name,
      description: input.description,
      archivedAt,
    });
    await this.invalidateProjectMeta(projectId);
    return updated;
  }

  async listProjectMembers(actorId: string, projectId: string) {
    await this.resolveProjectContext(actorId, projectId, "project:read");
    return this.repo.listProjectMembers(projectId);
  }

  async upsertProjectMember(
    actorId: string,
    projectId: string,
    userId: string,
    role: ProjectRole,
  ) {
    const ctx = await this.resolveProjectContext(actorId, projectId, "project:manage_members");
    const orgMembers = await this.tenancy.listMembers(actorId, ctx.org.id);
    if (!orgMembers.some((m) => m.userId === userId)) {
      throw badRequest("User must belong to this organization before joining the project");
    }
    await this.repo.upsertProjectMember(projectId, userId, role);
    await this.invalidateProjectMeta(projectId);
  }

  async removeProjectMember(actorId: string, projectId: string, targetUserId: string) {
    await this.resolveProjectContext(actorId, projectId, "project:manage_members");
    await this.repo.removeProjectMember(projectId, targetUserId);
    await this.invalidateProjectMeta(projectId);
  }

  async createColumn(actorId: string, projectId: string, input: CreateColumnInput) {
    await this.resolveProjectContext(actorId, projectId, "board:manage_columns");
    const columns = await this.repo.listColumns(projectId);

    let position: string;
    if (input.afterColumnId) {
      const idx = columns.findIndex((c) => c.id === input.afterColumnId);
      if (idx < 0) throw badRequest("Reference column not found");
      const before = columns[idx]!.position;
      const after = columns[idx + 1]?.position ?? null;
      position = generatePositionBetween(before, after);
    } else {
      const last = columns.at(-1)?.position ?? null;
      position = generatePositionBetween(last, null);
    }

    const created = await this.repo.createColumn({
      projectId,
      name: input.name,
      category: input.category,
      position,
      wipLimit: input.wipLimit,
    });
    await this.invalidateProjectMeta(projectId);
    return created;
  }

  async updateColumn(
    actorId: string,
    projectId: string,
    columnId: string,
    input: UpdateColumnInput,
  ) {
    await this.resolveProjectContext(actorId, projectId, "board:manage_columns");
    const col = await this.repo.findColumnById(columnId);
    if (!col || col.projectId !== projectId) throw notFound("Column not found");
    const updated = await this.repo.updateColumn(columnId, input);
    await this.invalidateProjectMeta(projectId);
    return updated;
  }

  async deleteColumn(actorId: string, projectId: string, columnId: string) {
    await this.resolveProjectContext(actorId, projectId, "board:manage_columns");
    const col = await this.repo.findColumnById(columnId);
    if (!col || col.projectId !== projectId) throw notFound("Column not found");

    const count = await this.repo.countTasksInColumn(columnId);
    if (count > 0) {
      throw conflict("Move or delete all tasks in this column before removing it");
    }
    await this.repo.deleteColumn(columnId);
    await this.invalidateProjectMeta(projectId);
  }

  async createTag(actorId: string, projectId: string, input: CreateTagInput) {
    await this.resolveProjectContext(actorId, projectId, "tag:manage");
    const existing = await this.repo.listTags(projectId);
    if (existing.some((t) => t.name.toLowerCase() === input.name.toLowerCase())) {
      throw conflict("Tag with this name already exists in the project");
    }
    const created = await this.repo.createTag(projectId, input.name, input.color);
    await this.invalidateProjectMeta(projectId);
    return created;
  }

  async deleteTag(actorId: string, projectId: string, tagId: string) {
    await this.resolveProjectContext(actorId, projectId, "tag:manage");
    await this.repo.deleteTag(projectId, tagId);
    await this.invalidateProjectMeta(projectId);
  }

  // ───────────── Tasks, Subtasks, Search & Kanban Move (WS-402, WS-403, WS-405) ─────────────

  private assertProjectWritable(project: ProjectRecord) {
    if (project.archivedAt) {
      throw conflict("Archived projects are read-only; restore the project first");
    }
  }

  private async ensureValidAssignee(actorId: string, orgId: string, assigneeId?: string | null) {
    if (!assigneeId) return;
    const orgMembers = await this.tenancy.listMembers(actorId, orgId);
    if (!orgMembers.some((m) => m.userId === assigneeId)) {
      throw badRequest("Assignee must be a member of this organization");
    }
  }

  private async assertNoIncompleteDependenciesForDone(
    taskId: string,
    targetCategory: "TODO" | "IN_PROGRESS" | "DONE",
  ) {
    if (targetCategory !== "DONE") return;
    const blockers = await this.repo.findIncompleteBlockers(taskId);
    if (blockers.length > 0) {
      const list = blockers.map((b) => b.key).join(", ");
      throw conflict(
        `Cannot mark complete until prerequisite tasks are Done: ${list}`,
        "DEPENDENCY_INCOMPLETE",
        { blockers },
      );
    }
  }

  async queryTasks(actorId: string, projectId: string, query: TaskQueryInput) {
    const ctx = await this.resolveProjectContext(actorId, projectId, "project:read");

    const priorities = query.priority
      ? query.priority
          .split(",")
          .map((s) => s.trim().toUpperCase() as TaskPriority)
          .filter((p) => VALID_PRIORITIES.has(p))
      : undefined;

    return this.repo.queryTasks({
      projectId,
      orgId: ctx.org.id,
      q: query.q,
      columnId: query.columnId,
      priorities,
      assigneeId: query.assigneeId,
      tagId: query.tagId,
      includeSubtasks: query.includeSubtasks === "1",
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  async createTask(actorId: string, projectId: string, input: CreateTaskInput) {
    const ctx = await this.resolveProjectContext(actorId, projectId, "task:create");
    this.assertProjectWritable(ctx.project);

    const columns = await this.repo.listColumns(projectId);
    if (columns.length === 0) {
      throw badRequest("Project has no board columns configured");
    }

    const targetColumn = input.columnId
      ? columns.find((c) => c.id === input.columnId)
      : columns[0];
    if (!targetColumn) {
      throw badRequest("Target board column does not belong to this project");
    }

    if (input.parentId) {
      const parent = await this.repo.findTaskDetailById(input.parentId);
      if (!parent || parent.projectId !== projectId) {
        throw badRequest("Parent task not found in this project");
      }
      if (parent.parentId) {
        throw badRequest("Subtasks cannot be nested deeper than one level");
      }
    }

    await this.ensureValidAssignee(actorId, ctx.org.id, input.assigneeId);

    const lastPos = await this.repo.findLastTaskPositionInColumn(targetColumn.id);
    const position = generatePositionBetween(lastPos, null);

    const created = await this.repo.createTask({
      orgId: ctx.org.id,
      projectId,
      columnId: targetColumn.id,
      parentId: input.parentId ?? null,
      title: input.title,
      description: input.description,
      priority: input.priority,
      position,
      assigneeId: input.assigneeId ?? null,
      reporterId: actorId,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      completedAt: targetColumn.category === "DONE" ? new Date() : null,
      tagIds: input.tagIds,
    });

    await publishRealtimeEvent(rooms.project(projectId), REALTIME_EVENTS.TASK_CREATED, {
      task: created,
      actorId,
    });

    if (this.notifier && created.assignee && created.assignee.id !== actorId) {
      await this.notifier.dispatch([
        {
          orgId: ctx.org.id,
          userId: created.assignee.id,
          type: "TASK_ASSIGNED",
          title: `Assigned to ${created.key}: ${created.title}`,
          linkUrl: `/app/projects/${projectId}`,
          payload: { taskId: created.id, taskKey: created.key, projectId },
        },
      ]);
    }

    return created;
  }

  async createSubtask(actorId: string, parentTaskId: string, input: CreateSubtaskInput) {
    const parent = await this.repo.findTaskDetailById(parentTaskId);
    if (!parent) throw notFound("Parent task not found");

    return this.createTask(actorId, parent.projectId, {
      title: input.title,
      priority: input.priority,
      assigneeId: input.assigneeId ?? null,
      parentId: parent.id,
    });
  }

  async getTask(actorId: string, taskId: string) {
    const task = await this.repo.findTaskDetailById(taskId);
    if (!task) throw notFound("Task not found");
    await this.resolveProjectContext(actorId, task.projectId, "project:read");
    return task;
  }

  async updateTask(actorId: string, taskId: string, input: UpdateTaskInput) {
    const task = await this.repo.findTaskDetailById(taskId);
    if (!task) throw notFound("Task not found");

    const ctx = await this.resolveProjectContext(actorId, task.projectId, "task:update");
    this.assertProjectWritable(ctx.project);

    if (input.assigneeId !== undefined) {
      await this.ensureValidAssignee(actorId, ctx.org.id, input.assigneeId);
    }

    let completedAtPatch: Date | null | undefined;
    let positionPatch: string | undefined;

    if (input.columnId && input.columnId !== task.columnId) {
      const targetCol = await this.repo.findColumnById(input.columnId);
      if (!targetCol || targetCol.projectId !== task.projectId) {
        throw badRequest("Target column does not belong to this project");
      }
      await this.assertNoIncompleteDependenciesForDone(task.id, targetCol.category);
      const lastPos = await this.repo.findLastTaskPositionInColumn(targetCol.id);
      positionPatch = generatePositionBetween(lastPos, null);
      completedAtPatch = targetCol.category === "DONE" ? new Date() : null;
    }

    const res = await this.repo.updateTaskWithVersion({
      taskId: task.id,
      orgId: ctx.org.id,
      expectedVersion: input.version,
      actorId,
      patch: {
        title: input.title,
        description: input.description,
        columnId: input.columnId,
        position: positionPatch,
        priority: input.priority,
        assigneeId: input.assigneeId,
        dueDate:
          input.dueDate === undefined
            ? undefined
            : input.dueDate === null
              ? null
              : new Date(input.dueDate),
        completedAt: completedAtPatch,
        tagIds: input.tagIds,
      },
      activityAction: "task.updated",
      activityMeta: { key: task.key },
    });

    if (!res.ok) {
      const latestTask = await this.repo.findTaskDetailById(task.id);
      throw conflict("Task was modified by another user", "VERSION_CONFLICT", {
        currentVersion: res.currentVersion,
        latestTask,
      });
    }

    await this.invalidateTaskStats(ctx.org.id, task.projectId);

    await publishRealtimeEvent(rooms.project(task.projectId), REALTIME_EVENTS.TASK_UPDATED, {
      task: res.task,
      actorId,
    });

    if (this.notifier) {
      const pendingNotifs: Array<{
        orgId: string;
        userId: string;
        type: "TASK_ASSIGNED" | "STATUS_CHANGED";
        title: string;
        linkUrl: string;
        payload: Record<string, unknown>;
      }> = [];

      // แจ้งเตือนเมื่อเปลี่ยนผู้รับผิดชอบเป็นคนใหม่
      if (
        input.assigneeId &&
        input.assigneeId !== task.assignee?.id &&
        input.assigneeId !== actorId
      ) {
        pendingNotifs.push({
          orgId: ctx.org.id,
          userId: input.assigneeId,
          type: "TASK_ASSIGNED",
          title: `Assigned to ${res.task.key}: ${res.task.title}`,
          linkUrl: `/app/projects/${task.projectId}`,
          payload: { taskId: task.id, taskKey: res.task.key, projectId: task.projectId },
        });
      }

      // แจ้งเตือนเมื่อเปลี่ยนสถานะคอลัมน์
      if (input.columnId && input.columnId !== task.columnId) {
        const watchers = new Set<string>([task.reporter.id]);
        if (res.task.assignee) watchers.add(res.task.assignee.id);
        watchers.delete(actorId);
        for (const uid of watchers) {
          pendingNotifs.push({
            orgId: ctx.org.id,
            userId: uid,
            type: "STATUS_CHANGED",
            title: `${res.task.key} moved to a new status`,
            linkUrl: `/app/projects/${task.projectId}`,
            payload: { taskId: task.id, taskKey: res.task.key, projectId: task.projectId },
          });
        }
      }

      if (pendingNotifs.length > 0) {
        await this.notifier.dispatch(pendingNotifs);
      }
    }

    return res.task;
  }

  async moveTask(actorId: string, taskId: string, input: MoveTaskInput) {
    const task = await this.repo.findTaskDetailById(taskId);
    if (!task) throw notFound("Task not found");

    const ctx = await this.resolveProjectContext(actorId, task.projectId, "task:move");
    this.assertProjectWritable(ctx.project);

    const targetCol = await this.repo.findColumnById(input.columnId);
    if (!targetCol || targetCol.projectId !== task.projectId) {
      throw badRequest("Target column does not belong to this project");
    }

    await this.assertNoIncompleteDependenciesForDone(task.id, targetCol.category);

    const beforePos =
      input.beforeTaskId && input.beforeTaskId !== task.id
        ? await this.repo.findTaskPositionInColumn(input.beforeTaskId, targetCol.id)
        : null;
    const afterPos =
      input.afterTaskId && input.afterTaskId !== task.id
        ? await this.repo.findTaskPositionInColumn(input.afterTaskId, targetCol.id)
        : null;

    let position: string;
    if (!beforePos && !afterPos) {
      const lastPos = await this.repo.findLastTaskPositionInColumn(targetCol.id);
      position =
        task.columnId === targetCol.id && lastPos === task.position
          ? task.position
          : generatePositionBetween(lastPos, null);
    } else if (beforePos && afterPos && beforePos >= afterPos) {
      position = generatePositionBetween(beforePos, null);
    } else {
      position = generatePositionBetween(beforePos, afterPos);
    }

    const completedAt =
      targetCol.category === "DONE" ? (task.completedAt ?? new Date()) : null;

    const res = await this.repo.updateTaskWithVersion({
      taskId: task.id,
      orgId: ctx.org.id,
      expectedVersion: input.version,
      actorId,
      patch: {
        columnId: targetCol.id,
        position,
        completedAt,
      },
      activityAction: "task.moved",
      activityMeta: {
        key: task.key,
        fromColumnId: task.columnId,
        toColumnId: targetCol.id,
      },
    });

    if (!res.ok) {
      const latestTask = await this.repo.findTaskDetailById(task.id);
      throw conflict("Task was modified concurrently", "VERSION_CONFLICT", {
        currentVersion: res.currentVersion,
        latestTask,
      });
    }

    await this.invalidateTaskStats(ctx.org.id, task.projectId);

    await publishRealtimeEvent(rooms.project(task.projectId), REALTIME_EVENTS.TASK_MOVED, {
      taskId: task.id,
      fromColumnId: task.columnId,
      toColumnId: targetCol.id,
      position: res.task.position,
      version: res.task.version,
      actorId,
    });

    if (this.notifier && task.columnId !== targetCol.id) {
      const watchers = new Set<string>([task.reporter.id]);
      if (task.assignee) watchers.add(task.assignee.id);
      watchers.delete(actorId);

      if (watchers.size > 0) {
        await this.notifier.dispatch(
          [...watchers].map((uid) => ({
            orgId: ctx.org.id,
            userId: uid,
            type: "STATUS_CHANGED" as const,
            title: `${task.key} moved to "${targetCol.name}"`,
            linkUrl: `/app/projects/${task.projectId}`,
            payload: {
              taskId: task.id,
              taskKey: task.key,
              columnName: targetCol.name,
              projectId: task.projectId,
            },
          })),
        );
      }
    }

    return res.task;
  }

  async deleteTask(actorId: string, taskId: string) {
    const task = await this.repo.findTaskDetailById(taskId);
    if (!task) throw notFound("Task not found");

    const ctx = await this.resolveProjectContext(actorId, task.projectId, "task:delete", {
      ownerId: task.reporter.id,
    });
    this.assertProjectWritable(ctx.project);

    await this.repo.softDeleteTask(task.id, ctx.org.id, actorId);
    await publishRealtimeEvent(rooms.project(task.projectId), REALTIME_EVENTS.TASK_DELETED, {
      taskId: task.id,
      actorId,
    });
  }

  // ───────────── Task Dependencies & Cycle Detection (WS-404) ─────────────

  async addDependency(actorId: string, taskId: string, dependsOnTaskId: string) {
    if (taskId === dependsOnTaskId) {
      throw badRequest("A task cannot depend on itself");
    }

    const [task, prereq] = await Promise.all([
      this.repo.findTaskDetailById(taskId),
      this.repo.findTaskDetailById(dependsOnTaskId),
    ]);
    if (!task) throw notFound("Task not found");

    const ctx = await this.resolveProjectContext(
      actorId,
      task.projectId,
      "task:manage_dependencies",
    );
    this.assertProjectWritable(ctx.project);

    if (!prereq || prereq.projectId !== task.projectId) {
      throw badRequest("Prerequisite task must belong to the same project");
    }

    if (task.blockedBy.some((b) => b.taskId === dependsOnTaskId)) {
      throw conflict("This dependency already exists");
    }

    const existingEdges = await this.repo.listProjectDependencyEdges(task.projectId);
    const createsCycle = wouldCreateDependencyCycle(existingEdges, {
      taskId,
      dependsOnTaskId,
    });

    if (createsCycle) {
      throw conflict(
        `Adding dependency on ${prereq.key} would create a circular dependency`,
        "DEPENDENCY_CYCLE",
      );
    }

    await this.repo.addDependency({
      projectId: task.projectId,
      orgId: ctx.org.id,
      taskId,
      dependsOnTaskId,
      actorId,
    });

    return this.repo.findTaskDetailById(taskId);
  }

  async removeDependency(actorId: string, taskId: string, depId: string) {
    const task = await this.repo.findTaskDetailById(taskId);
    if (!task) throw notFound("Task not found");

    const ctx = await this.resolveProjectContext(
      actorId,
      task.projectId,
      "task:manage_dependencies",
    );
    this.assertProjectWritable(ctx.project);

    const removed = await this.repo.removeDependency(task.projectId, taskId, depId);
    if (!removed) throw notFound("Dependency not found");
  }

  // ───────────── Comments & File Attachments (WS-406) ─────────────

  async listComments(actorId: string, taskId: string, cursor?: string, limit = 30) {
    const task = await this.repo.findTaskDetailById(taskId);
    if (!task) throw notFound("Task not found");
    await this.resolveProjectContext(actorId, task.projectId, "project:read");
    return this.repo.listComments(taskId, cursor, limit);
  }

  async createComment(actorId: string, taskId: string, body: string) {
    const task = await this.repo.findTaskDetailById(taskId);
    if (!task) throw notFound("Task not found");
    const ctx = await this.resolveProjectContext(actorId, task.projectId, "comment:create");

    const created = await this.repo.createComment({
      orgId: ctx.org.id,
      projectId: task.projectId,
      taskId,
      authorId: actorId,
      body,
    });

    await publishRealtimeEvent(rooms.project(task.projectId), REALTIME_EVENTS.COMMENT_CREATED, {
      taskId,
      comment: created,
    });

    if (this.notifier) {
      const orgMembers = await this.tenancy.listMembers(actorId, ctx.org.id);
      const mentionedIds = extractMentionedUserIds(body, orgMembers, actorId);
      if (mentionedIds.length > 0) {
        await this.notifier.dispatch(
          mentionedIds.map((uid) => ({
            orgId: ctx.org.id,
            userId: uid,
            type: "MENTIONED" as const,
            title: `${created.author.name} mentioned you in ${task.key}`,
            linkUrl: `/app/projects/${task.projectId}`,
            payload: {
              taskId: task.id,
              taskKey: task.key,
              commentId: created.id,
              projectId: task.projectId,
            },
          })),
        );
      }
    }

    return created;
  }

  async updateComment(actorId: string, commentId: string, body: string) {
    const existing = await this.repo.findCommentById(commentId);
    if (!existing) throw notFound("Comment not found");

    await this.resolveProjectContext(actorId, existing.projectId, "comment:update", {
      ownerId: existing.authorId,
    });
    const updated = await this.repo.updateComment(commentId, body);
    await publishRealtimeEvent(
      rooms.project(existing.projectId),
      REALTIME_EVENTS.COMMENT_UPDATED,
      { taskId: existing.taskId, commentId, body },
    );
    return updated;
  }

  async deleteComment(actorId: string, commentId: string) {
    const existing = await this.repo.findCommentById(commentId);
    if (!existing) throw notFound("Comment not found");

    await this.resolveProjectContext(actorId, existing.projectId, "comment:delete", {
      ownerId: existing.authorId,
    });
    await this.repo.softDeleteComment(commentId);
    await publishRealtimeEvent(
      rooms.project(existing.projectId),
      REALTIME_EVENTS.COMMENT_DELETED,
      { taskId: existing.taskId, commentId },
    );
  }

  async listProjectActivity(actorId: string, projectId: string, cursor?: string, limit = 40) {
    const ctx = await this.resolveProjectContext(actorId, projectId, "project:read");
    const svc = this.notifier ?? notificationService;
    return svc.listProjectActivityDirect({
      orgId: ctx.org.id,
      projectId,
      cursor,
      limit,
    });
  }

  async generateTasksExport(
    actorId: string,
    projectId: string,
    format: "csv" | "json" = "csv",
  ): Promise<{ exportId: string; downloadUrl: string; rowCount: number }> {
    const ctx = await this.resolveProjectContext(actorId, projectId, "project:read");
    const [columns, queried] = await Promise.all([
      this.repo.listColumns(projectId),
      this.repo.queryTasks({
        projectId,
        orgId: ctx.org.id,
        includeSubtasks: true,
        sort: "createdAt:asc",
        limit: 500,
      }),
    ]);

    const colMap = new Map(columns.map((c) => [c.id, c]));
    const rows: ExportRow[] = queried.items.map((t) => ({
      key: t.key,
      title: t.title,
      status: colMap.get(t.columnId)?.name ?? "",
      category: t.columnCategory,
      priority: t.priority,
      assignee: t.assignee ? `${t.assignee.name} <${t.assignee.email}>` : "",
      dueDate: t.dueDate ? t.dueDate.toISOString() : "",
      completedAt: t.completedAt ? t.completedAt.toISOString() : "",
    }));

    const exportId = generateOpaqueToken(12);
    const bytes = serializeTasksExport(rows, format);
    const storageKey = `exports/${ctx.org.id}/${projectId}/${exportId}.${format}`;
    await this.storage.put(
      storageKey,
      bytes,
      format === "json" ? "application/json" : "text/csv; charset=utf-8",
    );

    return {
      exportId,
      downloadUrl: `/api/v1/projects/${projectId}/exports/${exportId}?format=${format}`,
      rowCount: rows.length,
    };
  }

  async readTasksExport(
    actorId: string,
    projectId: string,
    exportId: string,
    format: "csv" | "json",
  ): Promise<{ bytes: Buffer; fileName: string; mimeType: string }> {
    const ctx = await this.resolveProjectContext(actorId, projectId, "project:read");
    const safeId = exportId.replace(/[^a-zA-Z0-9_-]/g, "");
    const storageKey = `exports/${ctx.org.id}/${projectId}/${safeId}.${format}`;
    try {
      const bytes = await this.storage.read(storageKey);
      return {
        bytes,
        fileName: `${ctx.project.key.toLowerCase()}-tasks.${format}`,
        mimeType: format === "json" ? "application/json" : "text/csv; charset=utf-8",
      };
    } catch {
      throw notFound("Export file not found");
    }
  }

  async uploadAttachment(
    actorId: string,
    taskId: string,
    file: { fileName: string; mimeType: string; bytes: Buffer },
  ) {
    const task = await this.repo.findTaskDetailById(taskId);
    if (!task) throw notFound("Task not found");

    const ctx = await this.resolveProjectContext(actorId, task.projectId, "attachment:upload");
    this.assertProjectWritable(ctx.project);

    if (file.bytes.byteLength === 0) {
      throw badRequest("Uploaded file is empty");
    }
    if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw badRequest("File exceeds maximum size limit of 10 MB");
    }

    const safeName = sanitizeFileName(file.fileName);
    const storageKey = `${ctx.org.id}/${task.projectId}/${task.id}/${generateOpaqueToken(12)}_${safeName}`;
    await this.storage.put(storageKey, file.bytes, file.mimeType);

    return this.repo.createAttachment({
      orgId: ctx.org.id,
      taskId: task.id,
      uploaderId: actorId,
      fileName: safeName,
      mimeType: file.mimeType || "application/octet-stream",
      sizeBytes: file.bytes.byteLength,
      storageKey,
    });
  }

  async downloadAttachment(actorId: string, attachmentId: string) {
    const att = await this.repo.findAttachmentById(attachmentId);
    if (!att) throw notFound("Attachment not found");

    await this.resolveProjectContext(actorId, att.projectId, "project:read");
    const bytes = await this.storage.read(att.storageKey);
    return { attachment: att, bytes };
  }

  async deleteAttachment(actorId: string, attachmentId: string) {
    const att = await this.repo.findAttachmentById(attachmentId);
    if (!att) throw notFound("Attachment not found");

    await this.resolveProjectContext(actorId, att.projectId, "attachment:delete", {
      ownerId: att.uploaderId,
    });

    await this.storage.remove(att.storageKey);
    await this.repo.deleteAttachment(attachmentId);
  }
}

export const projectTaskService = new ProjectTaskService();
