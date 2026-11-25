import type { Prisma } from "@/generated/prisma/client";
import type {
  ColumnCategory,
  ProjectRole,
  TaskPriority,
} from "@/generated/prisma/enums";
import { generateInitialPositions } from "@/lib/ordering/fractional-index";
import type { DependencyEdge } from "@/lib/graph/dependency-dag";
import { db } from "@/server/db";

export interface ProjectRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  workspaceName: string;
  key: string;
  name: string;
  description: string | null;
  taskCounter: number;
  createdById: string;
  archivedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  taskCount: number;
  memberCount: number;
}

export interface BoardColumnRecord {
  id: string;
  projectId: string;
  name: string;
  category: ColumnCategory;
  position: string;
  wipLimit: number | null;
}

export interface TagRecord {
  id: string;
  projectId: string;
  name: string;
  color: string;
}

export interface ProjectMemberDetail {
  userId: string;
  email: string;
  name: string;
  role: ProjectRole;
  joinedAt: Date;
}

export interface TaskSummaryRecord {
  id: string;
  orgId: string;
  projectId: string;
  projectKey: string;
  columnId: string;
  columnCategory: ColumnCategory;
  parentId: string | null;
  number: number;
  key: string; // เช่น "ENG-12"
  title: string;
  description: string | null;
  priority: TaskPriority;
  position: string;
  version: number;
  assignee: { id: string; name: string; email: string } | null;
  reporter: { id: string; name: string; email: string };
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  tags: TagRecord[];
  subtaskCount: number;
  completedSubtaskCount: number;
  commentCount: number;
  attachmentCount: number;
  incompleteBlockerKeys: string[];
}

export interface TaskDetailRecord extends TaskSummaryRecord {
  subtasks: Array<{
    id: string;
    number: number;
    key: string;
    title: string;
    columnId: string;
    columnCategory: ColumnCategory;
    priority: TaskPriority;
    assignee: { id: string; name: string } | null;
    completedAt: Date | null;
    version: number;
  }>;
  blockedBy: Array<{
    dependencyId: string;
    taskId: string;
    key: string;
    title: string;
    category: ColumnCategory;
  }>;
  blocks: Array<{
    dependencyId: string;
    taskId: string;
    key: string;
    title: string;
    category: ColumnCategory;
  }>;
  attachments: AttachmentRecord[];
}

export interface CommentRecord {
  id: string;
  orgId: string;
  taskId: string;
  author: { id: string; name: string; email: string };
  body: string;
  editedAt: Date | null;
  createdAt: Date;
}

export interface AttachmentRecord {
  id: string;
  orgId: string;
  taskId: string;
  uploaderId: string;
  uploaderName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: Date;
}

export interface QueryTasksParams {
  projectId: string;
  orgId: string;
  q?: string;
  columnId?: string;
  priorities?: TaskPriority[];
  assigneeId?: string; // หรือ "unassigned"
  tagId?: string;
  includeSubtasks: boolean;
  sort: "position:asc" | "createdAt:desc" | "createdAt:asc" | "dueDate:asc" | "priority:desc";
  cursor?: string;
  limit: number;
}

export interface ProjectTaskRepository {
  listProjectsForOrg(orgId: string, restrictToUserId?: string): Promise<ProjectRecord[]>;
  listProjectsForWorkspace(
    workspaceId: string,
    restrictToUserId?: string,
  ): Promise<ProjectRecord[]>;
  findProjectById(projectId: string): Promise<ProjectRecord | null>;
  findProjectByKey(orgId: string, key: string): Promise<{ id: string } | null>;
  findProjectMembership(
    projectId: string,
    userId: string,
  ): Promise<{ role: ProjectRole } | null>;
  createProjectWithDefaults(params: {
    orgId: string;
    workspaceId: string;
    key: string;
    name: string;
    description?: string;
    creatorId: string;
  }): Promise<{ project: ProjectRecord; columns: BoardColumnRecord[]; tags: TagRecord[] }>;
  updateProject(
    projectId: string,
    data: { name?: string; description?: string | null; archivedAt?: Date | null },
  ): Promise<ProjectRecord>;

  listProjectMembers(projectId: string): Promise<ProjectMemberDetail[]>;
  upsertProjectMember(projectId: string, userId: string, role: ProjectRole): Promise<void>;
  removeProjectMember(projectId: string, userId: string): Promise<void>;

  listColumns(projectId: string): Promise<BoardColumnRecord[]>;
  findColumnById(columnId: string): Promise<BoardColumnRecord | null>;
  createColumn(params: {
    projectId: string;
    name: string;
    category: ColumnCategory;
    position: string;
    wipLimit?: number | null;
  }): Promise<BoardColumnRecord>;
  updateColumn(
    columnId: string,
    data: { name?: string; category?: ColumnCategory; wipLimit?: number | null },
  ): Promise<BoardColumnRecord>;
  countTasksInColumn(columnId: string): Promise<number>;
  deleteColumn(columnId: string): Promise<void>;

  listTags(projectId: string): Promise<TagRecord[]>;
  createTag(projectId: string, name: string, color: string): Promise<TagRecord>;
  deleteTag(projectId: string, tagId: string): Promise<void>;

  findLastTaskPositionInColumn(columnId: string): Promise<string | null>;
  findTaskPositionInColumn(taskId: string, columnId: string): Promise<string | null>;
  createTask(params: {
    orgId: string;
    projectId: string;
    columnId: string;
    parentId?: string | null;
    title: string;
    description?: string;
    priority: TaskPriority;
    position: string;
    assigneeId?: string | null;
    reporterId: string;
    dueDate?: Date | null;
    completedAt?: Date | null;
    tagIds?: string[];
  }): Promise<TaskDetailRecord>;
  findTaskDetailById(taskId: string): Promise<TaskDetailRecord | null>;
  queryTasks(
    params: QueryTasksParams,
  ): Promise<{ items: TaskSummaryRecord[]; nextCursor: string | null; hasMore: boolean }>;
  updateTaskWithVersion(params: {
    taskId: string;
    orgId: string;
    expectedVersion?: number;
    actorId: string;
    patch: {
      title?: string;
      description?: string | null;
      columnId?: string;
      position?: string;
      priority?: TaskPriority;
      assigneeId?: string | null;
      dueDate?: Date | null;
      completedAt?: Date | null;
      tagIds?: string[];
    };
    activityAction: string;
    activityMeta?: Record<string, unknown>;
  }): Promise<{ ok: true; task: TaskDetailRecord } | { ok: false; currentVersion: number }>;
  softDeleteTask(taskId: string, orgId: string, actorId: string): Promise<void>;

  listProjectDependencyEdges(projectId: string): Promise<DependencyEdge[]>;
  findIncompleteBlockers(taskId: string): Promise<Array<{ id: string; key: string; title: string }>>;
  addDependency(params: {
    projectId: string;
    orgId: string;
    taskId: string;
    dependsOnTaskId: string;
    actorId: string;
  }): Promise<{ id: string }>;
  removeDependency(projectId: string, taskId: string, depId: string): Promise<boolean>;

  listComments(
    taskId: string,
    cursor?: string,
    limit?: number,
  ): Promise<{ items: CommentRecord[]; nextCursor: string | null; hasMore: boolean }>;
  findCommentById(
    commentId: string,
  ): Promise<{ id: string; orgId: string; taskId: string; projectId: string; authorId: string } | null>;
  createComment(params: {
    orgId: string;
    projectId: string;
    taskId: string;
    authorId: string;
    body: string;
  }): Promise<CommentRecord>;
  updateComment(commentId: string, body: string): Promise<CommentRecord>;
  softDeleteComment(commentId: string): Promise<void>;

  createAttachment(params: {
    orgId: string;
    taskId: string;
    uploaderId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string;
  }): Promise<AttachmentRecord>;
  findAttachmentById(
    attachmentId: string,
  ): Promise<(AttachmentRecord & { projectId: string }) | null>;
  deleteAttachment(attachmentId: string): Promise<void>;
}

const PROJECT_INCLUDE = {
  workspace: { select: { name: true } },
  _count: {
    select: {
      members: true,
      tasks: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.ProjectInclude;

function mapProject(
  p: Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>,
): ProjectRecord {
  return {
    id: p.id,
    orgId: p.orgId,
    workspaceId: p.workspaceId,
    workspaceName: p.workspace.name,
    key: p.key,
    name: p.name,
    description: p.description,
    taskCounter: p.taskCounter,
    createdById: p.createdById,
    archivedAt: p.archivedAt,
    deletedAt: p.deletedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    memberCount: p._count.members,
    taskCount: p._count.tasks,
  };
}

const TASK_SUMMARY_INCLUDE = {
  project: { select: { key: true } },
  column: { select: { category: true } },
  assignee: { select: { id: true, name: true, email: true } },
  reporter: { select: { id: true, name: true, email: true } },
  tags: { include: { tag: true } },
  subtasks: {
    where: { deletedAt: null },
    select: { id: true, completedAt: true, column: { select: { category: true } } },
  },
  blockedBy: {
    where: { dependsOnTask: { deletedAt: null } },
    include: {
      dependsOnTask: {
        select: {
          number: true,
          project: { select: { key: true } },
          column: { select: { category: true } },
        },
      },
    },
  },
  _count: {
    select: {
      comments: { where: { deletedAt: null } },
      attachments: true,
    },
  },
} satisfies Prisma.TaskInclude;

function mapTaskSummary(
  t: Prisma.TaskGetPayload<{ include: typeof TASK_SUMMARY_INCLUDE }>,
): TaskSummaryRecord {
  const key = `${t.project.key}-${t.number}`;
  const completedSubtaskCount = t.subtasks.filter(
    (s) => s.column.category === "DONE" || s.completedAt !== null,
  ).length;
  const incompleteBlockerKeys = t.blockedBy
    .filter((b) => b.dependsOnTask.column.category !== "DONE")
    .map((b) => `${b.dependsOnTask.project.key}-${b.dependsOnTask.number}`);

  return {
    id: t.id,
    orgId: t.orgId,
    projectId: t.projectId,
    projectKey: t.project.key,
    columnId: t.columnId,
    columnCategory: t.column.category,
    parentId: t.parentId,
    number: t.number,
    key,
    title: t.title,
    description: t.description,
    priority: t.priority,
    position: t.position,
    version: t.version,
    assignee: t.assignee,
    reporter: t.reporter,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    tags: t.tags.map((tt) => tt.tag),
    subtaskCount: t.subtasks.length,
    completedSubtaskCount,
    commentCount: t._count.comments,
    attachmentCount: t._count.attachments,
    incompleteBlockerKeys,
  };
}

const TASK_DETAIL_INCLUDE = {
  ...TASK_SUMMARY_INCLUDE,
  subtasks: {
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" as const },
    include: {
      project: { select: { key: true } },
      column: { select: { category: true } },
      assignee: { select: { id: true, name: true } },
    },
  },
  blockedBy: {
    where: { dependsOnTask: { deletedAt: null } },
    include: {
      dependsOnTask: {
        select: {
          id: true,
          number: true,
          title: true,
          project: { select: { key: true } },
          column: { select: { category: true } },
        },
      },
    },
  },
  blocks: {
    where: { task: { deletedAt: null } },
    include: {
      task: {
        select: {
          id: true,
          number: true,
          title: true,
          project: { select: { key: true } },
          column: { select: { category: true } },
        },
      },
    },
  },
  attachments: {
    orderBy: { createdAt: "desc" as const },
    include: { uploader: { select: { name: true } } },
  },
} satisfies Prisma.TaskInclude;

function mapTaskDetail(
  t: Prisma.TaskGetPayload<{ include: typeof TASK_DETAIL_INCLUDE }>,
): TaskDetailRecord {
  const base = mapTaskSummary(t);
  return {
    ...base,
    subtasks: t.subtasks.map((s) => ({
      id: s.id,
      number: s.number,
      key: `${s.project.key}-${s.number}`,
      title: s.title,
      columnId: s.columnId,
      columnCategory: s.column.category,
      priority: s.priority,
      assignee: s.assignee,
      completedAt: s.completedAt,
      version: s.version,
    })),
    blockedBy: t.blockedBy.map((b) => ({
      dependencyId: b.id,
      taskId: b.dependsOnTask.id,
      key: `${b.dependsOnTask.project.key}-${b.dependsOnTask.number}`,
      title: b.dependsOnTask.title,
      category: b.dependsOnTask.column.category,
    })),
    blocks: t.blocks.map((b) => ({
      dependencyId: b.id,
      taskId: b.task.id,
      key: `${b.task.project.key}-${b.task.number}`,
      title: b.task.title,
      category: b.task.column.category,
    })),
    attachments: t.attachments.map((a) => ({
      id: a.id,
      orgId: a.orgId,
      taskId: a.taskId,
      uploaderId: a.uploaderId,
      uploaderName: a.uploader.name,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      storageKey: a.storageKey,
      createdAt: a.createdAt,
    })),
  };
}

export class PrismaProjectTaskRepository implements ProjectTaskRepository {
  async listProjectsForOrg(orgId: string, restrictToUserId?: string): Promise<ProjectRecord[]> {
    const rows = await db.project.findMany({
      where: {
        orgId,
        deletedAt: null,
        ...(restrictToUserId ? { members: { some: { userId: restrictToUserId } } } : {}),
      },
      include: PROJECT_INCLUDE,
      orderBy: [{ archivedAt: "asc" }, { createdAt: "desc" }],
    });
    return rows.map(mapProject);
  }

  async listProjectsForWorkspace(
    workspaceId: string,
    restrictToUserId?: string,
  ): Promise<ProjectRecord[]> {
    const rows = await db.project.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        ...(restrictToUserId ? { members: { some: { userId: restrictToUserId } } } : {}),
      },
      include: PROJECT_INCLUDE,
      orderBy: [{ archivedAt: "asc" }, { createdAt: "desc" }],
    });
    return rows.map(mapProject);
  }

  async findProjectById(projectId: string): Promise<ProjectRecord | null> {
    const row = await db.project.findUnique({
      where: { id: projectId },
      include: PROJECT_INCLUDE,
    });
    return row && !row.deletedAt ? mapProject(row) : null;
  }

  async findProjectByKey(orgId: string, key: string) {
    return db.project.findUnique({
      where: { orgId_key: { orgId, key } },
      select: { id: true },
    });
  }

  async findProjectMembership(projectId: string, userId: string) {
    return db.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
  }

  async createProjectWithDefaults(params: {
    orgId: string;
    workspaceId: string;
    key: string;
    name: string;
    description?: string;
    creatorId: string;
  }) {
    return db.$transaction(async (tx) => {
      const colPositions = generateInitialPositions(4);
      const created = await tx.project.create({
        data: {
          orgId: params.orgId,
          workspaceId: params.workspaceId,
          key: params.key,
          name: params.name,
          description: params.description ?? null,
          createdById: params.creatorId,
        },
        include: {
          workspace: { select: { name: true } },
        },
      });

      await tx.projectMember.create({
        data: {
          projectId: created.id,
          userId: params.creatorId,
          role: "PROJECT_MANAGER",
        },
      });

      // ใช้ createMany เพื่อส่งคำสั่งแบบ Batch เดียว ลดจำนวน Round-trip ข้ามเครือข่ายไปยัง Neon
      await tx.boardColumn.createMany({
        data: [
          { projectId: created.id, name: "To Do", category: "TODO", position: colPositions[0]! },
          {
            projectId: created.id,
            name: "In Progress",
            category: "IN_PROGRESS",
            position: colPositions[1]!,
          },
          {
            projectId: created.id,
            name: "In Review",
            category: "IN_PROGRESS",
            position: colPositions[2]!,
          },
          { projectId: created.id, name: "Done", category: "DONE", position: colPositions[3]! },
        ],
      });

      await tx.tag.createMany({
        data: [
          { projectId: created.id, name: "Feature", color: "#2563eb" },
          { projectId: created.id, name: "Bug", color: "#e11d48" },
          { projectId: created.id, name: "Improvement", color: "#059669" },
        ],
      });

      await tx.activityLog.create({
        data: {
          orgId: params.orgId,
          workspaceId: params.workspaceId,
          projectId: created.id,
          actorId: params.creatorId,
          action: "project.created",
          metadata: { key: created.key, name: created.name },
        },
      });

      const columns = await tx.boardColumn.findMany({
        where: { projectId: created.id },
        orderBy: { position: "asc" },
      });
      const tags = await tx.tag.findMany({
        where: { projectId: created.id },
        orderBy: { name: "asc" },
      });

      return {
        project: {
          id: created.id,
          orgId: created.orgId,
          workspaceId: created.workspaceId,
          workspaceName: created.workspace.name,
          key: created.key,
          name: created.name,
          description: created.description,
          taskCounter: created.taskCounter,
          createdById: created.createdById,
          archivedAt: created.archivedAt,
          deletedAt: created.deletedAt,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
          memberCount: 1,
          taskCount: 0,
        },
        columns,
        tags,
      };
    });
  }

  async updateProject(
    projectId: string,
    data: { name?: string; description?: string | null; archivedAt?: Date | null },
  ): Promise<ProjectRecord> {
    const updated = await db.project.update({
      where: { id: projectId },
      data,
      include: PROJECT_INCLUDE,
    });
    return mapProject(updated);
  }

  async listProjectMembers(projectId: string): Promise<ProjectMemberDetail[]> {
    const rows = await db.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      userId: r.user.id,
      email: r.user.email,
      name: r.user.name,
      role: r.role,
      joinedAt: r.createdAt,
    }));
  }

  async upsertProjectMember(projectId: string, userId: string, role: ProjectRole) {
    await db.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, userId, role },
      update: { role },
    });
  }

  async removeProjectMember(projectId: string, userId: string) {
    await db.projectMember.deleteMany({ where: { projectId, userId } });
  }

  async listColumns(projectId: string): Promise<BoardColumnRecord[]> {
    return db.boardColumn.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
    });
  }

  async findColumnById(columnId: string): Promise<BoardColumnRecord | null> {
    return db.boardColumn.findUnique({ where: { id: columnId } });
  }

  async createColumn(params: {
    projectId: string;
    name: string;
    category: ColumnCategory;
    position: string;
    wipLimit?: number | null;
  }): Promise<BoardColumnRecord> {
    return db.boardColumn.create({
      data: {
        projectId: params.projectId,
        name: params.name,
        category: params.category,
        position: params.position,
        wipLimit: params.wipLimit ?? null,
      },
    });
  }

  async updateColumn(
    columnId: string,
    data: { name?: string; category?: ColumnCategory; wipLimit?: number | null },
  ): Promise<BoardColumnRecord> {
    return db.boardColumn.update({ where: { id: columnId }, data });
  }

  async countTasksInColumn(columnId: string): Promise<number> {
    return db.task.count({ where: { columnId, deletedAt: null } });
  }

  async deleteColumn(columnId: string) {
    await db.boardColumn.delete({ where: { id: columnId } });
  }

  async listTags(projectId: string): Promise<TagRecord[]> {
    return db.tag.findMany({ where: { projectId }, orderBy: { name: "asc" } });
  }

  async createTag(projectId: string, name: string, color: string): Promise<TagRecord> {
    return db.tag.create({ data: { projectId, name, color } });
  }

  async deleteTag(projectId: string, tagId: string) {
    await db.tag.deleteMany({ where: { id: tagId, projectId } });
  }

  async findLastTaskPositionInColumn(columnId: string): Promise<string | null> {
    const last = await db.task.findFirst({
      where: { columnId, deletedAt: null },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    return last?.position ?? null;
  }

  async findTaskPositionInColumn(taskId: string, columnId: string): Promise<string | null> {
    const row = await db.task.findFirst({
      where: { id: taskId, columnId, deletedAt: null },
      select: { position: true },
    });
    return row?.position ?? null;
  }

  async createTask(params: {
    orgId: string;
    projectId: string;
    columnId: string;
    parentId?: string | null;
    title: string;
    description?: string;
    priority: TaskPriority;
    position: string;
    assigneeId?: string | null;
    reporterId: string;
    dueDate?: Date | null;
    completedAt?: Date | null;
    tagIds?: string[];
  }): Promise<TaskDetailRecord> {
    const createdId = await db.$transaction(async (tx) => {
      // เพิ่มเลขรันต่อโปรเจกต์แบบ Atomic ป้องกันเลขซ้ำเมื่อสร้างพร้อมกัน
      const proj = await tx.project.update({
        where: { id: params.projectId },
        data: { taskCounter: { increment: 1 } },
        select: { taskCounter: true, key: true, workspaceId: true },
      });

      const validTags =
        params.tagIds && params.tagIds.length > 0
          ? await tx.tag.findMany({
              where: { projectId: params.projectId, id: { in: params.tagIds } },
              select: { id: true },
            })
          : [];

      const created = await tx.task.create({
        data: {
          orgId: params.orgId,
          projectId: params.projectId,
          columnId: params.columnId,
          parentId: params.parentId ?? null,
          number: proj.taskCounter,
          title: params.title,
          description: params.description ?? null,
          priority: params.priority,
          position: params.position,
          assigneeId: params.assigneeId ?? null,
          reporterId: params.reporterId,
          dueDate: params.dueDate ?? null,
          completedAt: params.completedAt ?? null,
        },
        select: { id: true, number: true, title: true },
      });

      if (validTags.length > 0) {
        await tx.taskTag.createMany({
          data: validTags.map((t) => ({ taskId: created.id, tagId: t.id })),
        });
      }

      await tx.activityLog.create({
        data: {
          orgId: params.orgId,
          workspaceId: proj.workspaceId,
          projectId: params.projectId,
          taskId: created.id,
          actorId: params.reporterId,
          action: params.parentId ? "subtask.created" : "task.created",
          metadata: {
            key: `${proj.key}-${created.number}`,
            title: created.title,
          },
        },
      });

      return created.id;
    });

    const full = await this.findTaskDetailById(createdId);
    if (!full) throw new Error("Failed to load created task");
    return full;
  }

  async findTaskDetailById(taskId: string): Promise<TaskDetailRecord | null> {
    const row = await db.task.findUnique({
      where: { id: taskId },
      include: TASK_DETAIL_INCLUDE,
    });
    return row && !row.deletedAt ? mapTaskDetail(row) : null;
  }

  async queryTasks(params: QueryTasksParams) {
    const where: Prisma.TaskWhereInput = {
      projectId: params.projectId,
      orgId: params.orgId,
      deletedAt: null,
      ...(params.includeSubtasks ? {} : { parentId: null }),
      ...(params.columnId ? { columnId: params.columnId } : {}),
      ...(params.priorities && params.priorities.length > 0
        ? { priority: { in: params.priorities } }
        : {}),
      ...(params.assigneeId
        ? params.assigneeId === "unassigned"
          ? { assigneeId: null }
          : { assigneeId: params.assigneeId }
        : {}),
      ...(params.tagId ? { tags: { some: { tagId: params.tagId } } } : {}),
    };

    if (params.q) {
      const q = params.q.trim();
      const numMatch = q.match(/(?:^[A-Za-z]+-)?(\d+)$/);
      const parsedNumber = numMatch ? Number.parseInt(numMatch[1]!, 10) : null;
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        ...(parsedNumber !== null ? [{ number: parsedNumber }] : []),
      ];
    }

    const orderBy: Prisma.TaskOrderByWithRelationInput[] =
      params.sort === "createdAt:desc"
        ? [{ createdAt: "desc" }, { id: "desc" }]
        : params.sort === "createdAt:asc"
          ? [{ createdAt: "asc" }, { id: "asc" }]
          : params.sort === "dueDate:asc"
            ? [{ dueDate: "asc" }, { position: "asc" }]
            : params.sort === "priority:desc"
              ? [{ priority: "desc" }, { position: "asc" }]
              : [{ columnId: "asc" }, { position: "asc" }, { id: "asc" }];

    const rows = await db.task.findMany({
      where,
      orderBy,
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      include: TASK_SUMMARY_INCLUDE,
    });

    const hasMore = rows.length > params.limit;
    const sliced = hasMore ? rows.slice(0, params.limit) : rows;
    const nextCursor = hasMore ? (sliced.at(-1)?.id ?? null) : null;

    return {
      items: sliced.map(mapTaskSummary),
      nextCursor,
      hasMore,
    };
  }

  async updateTaskWithVersion(params: {
    taskId: string;
    orgId: string;
    expectedVersion?: number;
    actorId: string;
    patch: {
      title?: string;
      description?: string | null;
      columnId?: string;
      position?: string;
      priority?: TaskPriority;
      assigneeId?: string | null;
      dueDate?: Date | null;
      completedAt?: Date | null;
      tagIds?: string[];
    };
    activityAction: string;
    activityMeta?: Record<string, unknown>;
  }): Promise<{ ok: true; task: TaskDetailRecord } | { ok: false; currentVersion: number }> {
    const txRes = await db.$transaction<
      { ok: true } | { ok: false; currentVersion: number }
    >(async (tx) => {
      const existing = await tx.task.findFirst({
        where: { id: params.taskId, orgId: params.orgId, deletedAt: null },
        select: { id: true, version: true, projectId: true },
      });
      if (!existing) {
        return { ok: false, currentVersion: 0 };
      }

      if (params.expectedVersion !== undefined && existing.version !== params.expectedVersion) {
        return { ok: false, currentVersion: existing.version };
      }

      const { tagIds, ...scalarPatch } = params.patch;
      const claimed = await tx.task.updateMany({
        where: {
          id: params.taskId,
          orgId: params.orgId,
          deletedAt: null,
          version: existing.version,
        },
        data: {
          ...scalarPatch,
          version: { increment: 1 },
        },
      });

      if (claimed.count === 0) {
        const latest = await tx.task.findUnique({
          where: { id: params.taskId },
          select: { version: true },
        });
        return { ok: false, currentVersion: latest?.version ?? existing.version };
      }

      if (tagIds !== undefined) {
        await tx.taskTag.deleteMany({ where: { taskId: params.taskId } });
        if (tagIds.length > 0) {
          const validTags = await tx.tag.findMany({
            where: { projectId: existing.projectId, id: { in: tagIds } },
            select: { id: true },
          });
          if (validTags.length > 0) {
            await tx.taskTag.createMany({
              data: validTags.map((t) => ({ taskId: params.taskId, tagId: t.id })),
            });
          }
        }
      }

      await tx.activityLog.create({
        data: {
          orgId: params.orgId,
          projectId: existing.projectId,
          taskId: params.taskId,
          actorId: params.actorId,
          action: params.activityAction,
          metadata: (params.activityMeta ?? {}) as Prisma.InputJsonValue,
        },
      });

      return { ok: true };
    });

    if (!txRes.ok) return txRes;
    const reloaded = await this.findTaskDetailById(params.taskId);
    if (!reloaded) return { ok: false, currentVersion: 0 };
    return { ok: true, task: reloaded };
  }

  async softDeleteTask(taskId: string, orgId: string, actorId: string) {
    await db.$transaction(async (tx) => {
      const now = new Date();
      const target = await tx.task.findFirst({
        where: { id: taskId, orgId, deletedAt: null },
        select: { projectId: true },
      });
      if (!target) return;

      await tx.task.updateMany({
        where: { OR: [{ id: taskId }, { parentId: taskId }], orgId },
        data: { deletedAt: now },
      });

      await tx.activityLog.create({
        data: {
          orgId,
          projectId: target.projectId,
          taskId,
          actorId,
          action: "task.deleted",
        },
      });
    });
  }

  async listProjectDependencyEdges(projectId: string): Promise<DependencyEdge[]> {
    return db.taskDependency.findMany({
      where: {
        projectId,
        task: { deletedAt: null },
        dependsOnTask: { deletedAt: null },
      },
      select: { taskId: true, dependsOnTaskId: true },
    });
  }

  async findIncompleteBlockers(taskId: string) {
    const rows = await db.taskDependency.findMany({
      where: {
        taskId,
        dependsOnTask: {
          deletedAt: null,
          column: { category: { not: "DONE" } },
        },
      },
      include: {
        dependsOnTask: {
          select: {
            id: true,
            number: true,
            title: true,
            project: { select: { key: true } },
          },
        },
      },
    });

    return rows.map((r) => ({
      id: r.dependsOnTask.id,
      key: `${r.dependsOnTask.project.key}-${r.dependsOnTask.number}`,
      title: r.dependsOnTask.title,
    }));
  }

  async addDependency(params: {
    projectId: string;
    orgId: string;
    taskId: string;
    dependsOnTaskId: string;
    actorId: string;
  }) {
    return db.$transaction(async (tx) => {
      const created = await tx.taskDependency.create({
        data: {
          projectId: params.projectId,
          taskId: params.taskId,
          dependsOnTaskId: params.dependsOnTaskId,
          createdById: params.actorId,
        },
        select: { id: true },
      });

      await tx.activityLog.create({
        data: {
          orgId: params.orgId,
          projectId: params.projectId,
          taskId: params.taskId,
          actorId: params.actorId,
          action: "task.dependency_added",
          metadata: { dependsOnTaskId: params.dependsOnTaskId },
        },
      });

      return created;
    });
  }

  async removeDependency(projectId: string, taskId: string, depId: string) {
    const res = await db.taskDependency.deleteMany({
      where: { id: depId, projectId, taskId },
    });
    return res.count > 0;
  }

  async listComments(taskId: string, cursor?: string, limit = 30) {
    const rows = await db.comment.findMany({
      where: { taskId, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { author: { select: { id: true, name: true, email: true } } },
    });

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: sliced.map((c) => ({
        id: c.id,
        orgId: c.orgId,
        taskId: c.taskId,
        author: c.author,
        body: c.body,
        editedAt: c.editedAt,
        createdAt: c.createdAt,
      })),
      nextCursor: hasMore ? (sliced.at(-1)?.id ?? null) : null,
      hasMore,
    };
  }

  async findCommentById(commentId: string) {
    const row = await db.comment.findUnique({
      where: { id: commentId },
      include: { task: { select: { projectId: true } } },
    });
    if (!row || row.deletedAt) return null;
    return {
      id: row.id,
      orgId: row.orgId,
      taskId: row.taskId,
      projectId: row.task.projectId,
      authorId: row.authorId,
    };
  }

  async createComment(params: {
    orgId: string;
    projectId: string;
    taskId: string;
    authorId: string;
    body: string;
  }): Promise<CommentRecord> {
    return db.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          orgId: params.orgId,
          taskId: params.taskId,
          authorId: params.authorId,
          body: params.body,
        },
        include: { author: { select: { id: true, name: true, email: true } } },
      });

      await tx.activityLog.create({
        data: {
          orgId: params.orgId,
          projectId: params.projectId,
          taskId: params.taskId,
          actorId: params.authorId,
          action: "comment.created",
        },
      });

      return {
        id: created.id,
        orgId: created.orgId,
        taskId: created.taskId,
        author: created.author,
        body: created.body,
        editedAt: created.editedAt,
        createdAt: created.createdAt,
      };
    });
  }

  async updateComment(commentId: string, body: string): Promise<CommentRecord> {
    const updated = await db.comment.update({
      where: { id: commentId },
      data: { body, editedAt: new Date() },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
    return {
      id: updated.id,
      orgId: updated.orgId,
      taskId: updated.taskId,
      author: updated.author,
      body: updated.body,
      editedAt: updated.editedAt,
      createdAt: updated.createdAt,
    };
  }

  async softDeleteComment(commentId: string) {
    await db.comment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
  }

  async createAttachment(params: {
    orgId: string;
    taskId: string;
    uploaderId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string;
  }): Promise<AttachmentRecord> {
    const created = await db.attachment.create({
      data: params,
      include: { uploader: { select: { name: true } } },
    });
    return {
      id: created.id,
      orgId: created.orgId,
      taskId: created.taskId,
      uploaderId: created.uploaderId,
      uploaderName: created.uploader.name,
      fileName: created.fileName,
      mimeType: created.mimeType,
      sizeBytes: created.sizeBytes,
      storageKey: created.storageKey,
      createdAt: created.createdAt,
    };
  }

  async findAttachmentById(attachmentId: string) {
    const row = await db.attachment.findUnique({
      where: { id: attachmentId },
      include: {
        uploader: { select: { name: true } },
        task: { select: { projectId: true, deletedAt: true } },
      },
    });
    if (!row || row.task.deletedAt) return null;
    return {
      id: row.id,
      orgId: row.orgId,
      taskId: row.taskId,
      projectId: row.task.projectId,
      uploaderId: row.uploaderId,
      uploaderName: row.uploader.name,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      storageKey: row.storageKey,
      createdAt: row.createdAt,
    };
  }

  async deleteAttachment(attachmentId: string) {
    await db.attachment.delete({ where: { id: attachmentId } });
  }
}

export const prismaProjectTaskRepository = new PrismaProjectTaskRepository();
