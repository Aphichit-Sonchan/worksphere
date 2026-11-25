import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ColumnCategory,
  OrgRole,
  ProjectRole,
  TaskPriority,
  WorkspaceRole,
} from "@/generated/prisma/enums";
import { comparePositions, generateInitialPositions } from "@/lib/ordering/fractional-index";
import { LocalDiskStorageAdapter } from "@/server/infra/storage";
import type { MailAdapter } from "@/server/infra/mailer";
import type {
  OrgRecord,
  TenancyRepository,
  WorkspaceRecord,
} from "@/server/modules/organization/tenancy.repository";
import { TenancyService } from "@/server/modules/organization/tenancy.service";
import type {
  AttachmentRecord,
  BoardColumnRecord,
  CommentRecord,
  ProjectMemberDetail,
  ProjectRecord,
  ProjectTaskRepository,
  QueryTasksParams,
  TagRecord,
  TaskDetailRecord,
  TaskSummaryRecord,
} from "./project-task.repository";
import { ProjectTaskService } from "./project-task.service";

const noopMailer: MailAdapter = { async send() {} };

class MemTenancyRepo implements TenancyRepository {
  users = new Map<string, { id: string; email: string; name: string }>();
  orgs = new Map<string, OrgRecord>();
  orgMembers = new Map<string, { orgId: string; userId: string; role: OrgRole }>();
  workspaces = new Map<string, WorkspaceRecord>();
  wsMembers = new Map<string, { workspaceId: string; userId: string; role: WorkspaceRole }>();

  seed(params: {
    users: Array<{ id: string; email: string; name: string }>;
    orgs: Array<{ id: string; name: string; slug: string; ownerId: string }>;
    workspaces: Array<{ id: string; orgId: string; name: string; slug: string; creatorId: string }>;
  }) {
    const now = new Date();
    for (const u of params.users) this.users.set(u.id, u);
    for (const o of params.orgs) {
      this.orgs.set(o.id, {
        id: o.id,
        name: o.name,
        slug: o.slug,
        createdById: o.ownerId,
        suspendedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      this.orgMembers.set(`${o.id}:${o.ownerId}`, {
        orgId: o.id,
        userId: o.ownerId,
        role: "ORG_OWNER",
      });
    }
    for (const w of params.workspaces) {
      this.workspaces.set(w.id, {
        id: w.id,
        orgId: w.orgId,
        name: w.name,
        slug: w.slug,
        description: null,
        createdById: w.creatorId,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        memberCount: 1,
        projectCount: 0,
      });
      this.wsMembers.set(`${w.id}:${w.creatorId}`, {
        workspaceId: w.id,
        userId: w.creatorId,
        role: "WORKSPACE_ADMIN",
      });
    }
  }

  addOrgMember(orgId: string, userId: string, role: OrgRole) {
    this.orgMembers.set(`${orgId}:${userId}`, { orgId, userId, role });
  }

  async findUserBasicById(id: string) {
    return this.users.get(id) ?? null;
  }
  async listOrganizationsForUser() {
    return [];
  }
  async findOrgBySlug() {
    return null;
  }
  async findOrgById(id: string) {
    return this.orgs.get(id) ?? null;
  }
  async findOrgMembership(orgId: string, userId: string) {
    const m = this.orgMembers.get(`${orgId}:${userId}`);
    return m ? { role: m.role } : null;
  }
  async countOrgOwners() {
    return 1;
  }
  async createOrganizationWithDefaultWorkspace(): Promise<never> {
    throw new Error("not used");
  }
  async updateOrganization(): Promise<never> {
    throw new Error("not used");
  }
  async softDeleteOrganization() {}
  async listOrgMembers(orgId: string) {
    const out = [];
    for (const m of this.orgMembers.values()) {
      if (m.orgId !== orgId) continue;
      const u = this.users.get(m.userId)!;
      out.push({
        userId: u.id,
        email: u.email,
        name: u.name,
        avatarUrl: null,
        role: m.role,
        joinedAt: new Date(),
      });
    }
    return out;
  }
  async updateOrgMemberRole() {}
  async removeOrgMember() {}
  async listPendingInvitations() {
    return [];
  }
  async createInvitation(): Promise<never> {
    throw new Error("not used");
  }
  async findInvitationById() {
    return null;
  }
  async findInvitationByTokenHash() {
    return null;
  }
  async revokeInvitation() {}
  async acceptInvitation() {
    return false;
  }
  async listWorkspaces() {
    return [];
  }
  async findWorkspaceBySlug() {
    return null;
  }
  async findWorkspaceById(id: string) {
    return this.workspaces.get(id) ?? null;
  }
  async findWorkspaceMembership(wsId: string, userId: string) {
    const m = this.wsMembers.get(`${wsId}:${userId}`);
    return m ? { role: m.role } : null;
  }
  async createWorkspace(): Promise<never> {
    throw new Error("not used");
  }
  async updateWorkspace(): Promise<never> {
    throw new Error("not used");
  }
  async listWorkspaceMembers() {
    return [];
  }
  async upsertWorkspaceMember() {}
  async removeWorkspaceMember() {}
  async listAllOrganizationsForAdmin() {
    return [];
  }
  async setOrganizationSuspended(): Promise<never> {
    throw new Error("not used");
  }
}

interface StoredTask {
  id: string;
  orgId: string;
  projectId: string;
  columnId: string;
  parentId: string | null;
  number: number;
  title: string;
  description: string | null;
  priority: TaskPriority;
  position: string;
  version: number;
  assigneeId: string | null;
  reporterId: string;
  dueDate: Date | null;
  completedAt: Date | null;
  deletedAt: Date | null;
  tagIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

class MemProjectTaskRepo implements ProjectTaskRepository {
  projects = new Map<string, ProjectRecord>();
  members = new Map<string, { projectId: string; userId: string; role: ProjectRole }>();
  columns = new Map<string, BoardColumnRecord>();
  tags = new Map<string, TagRecord>();
  tasks = new Map<string, StoredTask>();
  deps = new Map<string, { id: string; projectId: string; taskId: string; dependsOnTaskId: string }>();
  comments = new Map<string, CommentRecord & { projectId: string; deletedAt: Date | null }>();
  attachments = new Map<string, AttachmentRecord & { projectId: string }>();
  private seq = 0;

  constructor(private readonly users: Map<string, { id: string; email: string; name: string }>) {}

  private nextId(p: string) {
    this.seq += 1;
    return `${p}_${this.seq}`;
  }

  private buildSummary(t: StoredTask): TaskSummaryRecord {
    const proj = this.projects.get(t.projectId)!;
    const col = this.columns.get(t.columnId)!;
    const subs = [...this.tasks.values()].filter((s) => s.parentId === t.id && !s.deletedAt);
    const completedSubs = subs.filter(
      (s) => this.columns.get(s.columnId)?.category === "DONE" || s.completedAt !== null,
    );
    const blockerKeys: string[] = [];
    for (const d of this.deps.values()) {
      if (d.taskId === t.id) {
        const pre = this.tasks.get(d.dependsOnTaskId);
        if (pre && !pre.deletedAt && this.columns.get(pre.columnId)?.category !== "DONE") {
          blockerKeys.push(`${proj.key}-${pre.number}`);
        }
      }
    }
    const assignee = t.assigneeId ? (this.users.get(t.assigneeId) ?? null) : null;
    const reporter = this.users.get(t.reporterId)!;

    return {
      id: t.id,
      orgId: t.orgId,
      projectId: t.projectId,
      projectKey: proj.key,
      columnId: t.columnId,
      columnCategory: col.category,
      parentId: t.parentId,
      number: t.number,
      key: `${proj.key}-${t.number}`,
      title: t.title,
      description: t.description,
      priority: t.priority,
      position: t.position,
      version: t.version,
      assignee,
      reporter,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      tags: t.tagIds.map((id) => this.tags.get(id)!).filter(Boolean),
      subtaskCount: subs.length,
      completedSubtaskCount: completedSubs.length,
      commentCount: [...this.comments.values()].filter((c) => c.taskId === t.id && !c.deletedAt)
        .length,
      attachmentCount: [...this.attachments.values()].filter((a) => a.taskId === t.id).length,
      incompleteBlockerKeys: blockerKeys,
    };
  }

  private buildDetail(t: StoredTask): TaskDetailRecord {
    const base = this.buildSummary(t);
    const proj = this.projects.get(t.projectId)!;
    const subs = [...this.tasks.values()]
      .filter((s) => s.parentId === t.id && !s.deletedAt)
      .map((s) => ({
        id: s.id,
        number: s.number,
        key: `${proj.key}-${s.number}`,
        title: s.title,
        columnId: s.columnId,
        columnCategory: this.columns.get(s.columnId)!.category,
        priority: s.priority,
        assignee: s.assigneeId
          ? { id: s.assigneeId, name: this.users.get(s.assigneeId)!.name }
          : null,
        completedAt: s.completedAt,
        version: s.version,
      }));

    const blockedBy = [...this.deps.values()]
      .filter((d) => d.taskId === t.id)
      .map((d) => {
        const pre = this.tasks.get(d.dependsOnTaskId)!;
        return {
          dependencyId: d.id,
          taskId: pre.id,
          key: `${proj.key}-${pre.number}`,
          title: pre.title,
          category: this.columns.get(pre.columnId)!.category,
        };
      });

    const blocks = [...this.deps.values()]
      .filter((d) => d.dependsOnTaskId === t.id)
      .map((d) => {
        const dep = this.tasks.get(d.taskId)!;
        return {
          dependencyId: d.id,
          taskId: dep.id,
          key: `${proj.key}-${dep.number}`,
          title: dep.title,
          category: this.columns.get(dep.columnId)!.category,
        };
      });

    const atts = [...this.attachments.values()].filter((a) => a.taskId === t.id);
    return { ...base, subtasks: subs, blockedBy, blocks, attachments: atts };
  }

  async listProjectsForOrg(orgId: string, restrictToUserId?: string) {
    return [...this.projects.values()].filter(
      (p) =>
        p.orgId === orgId &&
        !p.deletedAt &&
        (!restrictToUserId || this.members.has(`${p.id}:${restrictToUserId}`)),
    );
  }

  async listProjectsForWorkspace(workspaceId: string, restrictToUserId?: string) {
    return [...this.projects.values()].filter(
      (p) =>
        p.workspaceId === workspaceId &&
        !p.deletedAt &&
        (!restrictToUserId || this.members.has(`${p.id}:${restrictToUserId}`)),
    );
  }

  async findProjectById(projectId: string) {
    return this.projects.get(projectId) ?? null;
  }

  async findProjectByKey(orgId: string, key: string) {
    for (const p of this.projects.values()) {
      if (p.orgId === orgId && p.key === key) return { id: p.id };
    }
    return null;
  }

  async findProjectMembership(projectId: string, userId: string) {
    const m = this.members.get(`${projectId}:${userId}`);
    return m ? { role: m.role } : null;
  }

  async createProjectWithDefaults(params: {
    orgId: string;
    workspaceId: string;
    key: string;
    name: string;
    description?: string;
    creatorId: string;
  }) {
    const now = new Date();
    const project: ProjectRecord = {
      id: this.nextId("proj"),
      orgId: params.orgId,
      workspaceId: params.workspaceId,
      workspaceName: "General",
      key: params.key,
      name: params.name,
      description: params.description ?? null,
      taskCounter: 0,
      createdById: params.creatorId,
      archivedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      taskCount: 0,
      memberCount: 1,
    };
    this.projects.set(project.id, project);
    this.members.set(`${project.id}:${params.creatorId}`, {
      projectId: project.id,
      userId: params.creatorId,
      role: "PROJECT_MANAGER",
    });

    const pos = generateInitialPositions(4);
    const defs: Array<[string, ColumnCategory, string]> = [
      ["To Do", "TODO", pos[0]!],
      ["In Progress", "IN_PROGRESS", pos[1]!],
      ["In Review", "IN_PROGRESS", pos[2]!],
      ["Done", "DONE", pos[3]!],
    ];
    const columns: BoardColumnRecord[] = defs.map(([name, category, position]) => {
      const col: BoardColumnRecord = {
        id: this.nextId("col"),
        projectId: project.id,
        name,
        category,
        position,
        wipLimit: null,
      };
      this.columns.set(col.id, col);
      return col;
    });

    const tagRow: TagRecord = {
      id: this.nextId("tag"),
      projectId: project.id,
      name: "Feature",
      color: "#2563eb",
    };
    this.tags.set(tagRow.id, tagRow);

    return { project, columns, tags: [tagRow] };
  }

  async updateProject(
    projectId: string,
    data: { name?: string; description?: string | null; archivedAt?: Date | null },
  ) {
    const p = this.projects.get(projectId)!;
    if (data.name !== undefined) p.name = data.name;
    if (data.description !== undefined) p.description = data.description;
    if (data.archivedAt !== undefined) p.archivedAt = data.archivedAt;
    return p;
  }

  async listProjectMembers(projectId: string): Promise<ProjectMemberDetail[]> {
    const out: ProjectMemberDetail[] = [];
    for (const m of this.members.values()) {
      if (m.projectId !== projectId) continue;
      const u = this.users.get(m.userId)!;
      out.push({
        userId: u.id,
        email: u.email,
        name: u.name,
        role: m.role,
        joinedAt: new Date(),
      });
    }
    return out;
  }

  async upsertProjectMember(projectId: string, userId: string, role: ProjectRole) {
    this.members.set(`${projectId}:${userId}`, { projectId, userId, role });
  }

  async removeProjectMember(projectId: string, userId: string) {
    this.members.delete(`${projectId}:${userId}`);
  }

  async listColumns(projectId: string) {
    return [...this.columns.values()]
      .filter((c) => c.projectId === projectId)
      .sort((a, b) => a.position.localeCompare(b.position));
  }

  async findColumnById(columnId: string) {
    return this.columns.get(columnId) ?? null;
  }

  async createColumn(params: {
    projectId: string;
    name: string;
    category: ColumnCategory;
    position: string;
    wipLimit?: number | null;
  }) {
    const col: BoardColumnRecord = {
      id: this.nextId("col"),
      projectId: params.projectId,
      name: params.name,
      category: params.category,
      position: params.position,
      wipLimit: params.wipLimit ?? null,
    };
    this.columns.set(col.id, col);
    return col;
  }

  async updateColumn(
    columnId: string,
    data: { name?: string; category?: ColumnCategory; wipLimit?: number | null },
  ) {
    const col = this.columns.get(columnId)!;
    if (data.name !== undefined) col.name = data.name;
    if (data.category !== undefined) col.category = data.category;
    if (data.wipLimit !== undefined) col.wipLimit = data.wipLimit;
    return col;
  }

  async countTasksInColumn(columnId: string) {
    return [...this.tasks.values()].filter((t) => t.columnId === columnId && !t.deletedAt).length;
  }

  async deleteColumn(columnId: string) {
    this.columns.delete(columnId);
  }

  async listTags(projectId: string) {
    return [...this.tags.values()].filter((t) => t.projectId === projectId);
  }

  async createTag(projectId: string, name: string, color: string) {
    const t: TagRecord = { id: this.nextId("tag"), projectId, name, color };
    this.tags.set(t.id, t);
    return t;
  }

  async deleteTag(_projectId: string, tagId: string) {
    this.tags.delete(tagId);
  }

  async findLastTaskPositionInColumn(columnId: string) {
    const list = [...this.tasks.values()]
      .filter((t) => t.columnId === columnId && !t.deletedAt)
      .sort((a, b) => comparePositions(a.position, b.position));
    return list.at(-1)?.position ?? null;
  }

  async findTaskPositionInColumn(taskId: string, columnId: string) {
    const t = this.tasks.get(taskId);
    if (!t || t.columnId !== columnId || t.deletedAt) return null;
    return t.position;
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
  }) {
    const proj = this.projects.get(params.projectId)!;
    proj.taskCounter += 1;
    const now = new Date();
    const row: StoredTask = {
      id: this.nextId("tsk"),
      orgId: params.orgId,
      projectId: params.projectId,
      columnId: params.columnId,
      parentId: params.parentId ?? null,
      number: proj.taskCounter,
      title: params.title,
      description: params.description ?? null,
      priority: params.priority,
      position: params.position,
      version: 1,
      assigneeId: params.assigneeId ?? null,
      reporterId: params.reporterId,
      dueDate: params.dueDate ?? null,
      completedAt: params.completedAt ?? null,
      deletedAt: null,
      tagIds: params.tagIds ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(row.id, row);
    return this.buildDetail(row);
  }

  async findTaskDetailById(taskId: string) {
    const t = this.tasks.get(taskId);
    return t && !t.deletedAt ? this.buildDetail(t) : null;
  }

  async queryTasks(params: QueryTasksParams) {
    let list = [...this.tasks.values()].filter(
      (t) =>
        t.projectId === params.projectId &&
        t.orgId === params.orgId &&
        !t.deletedAt &&
        (params.includeSubtasks || t.parentId === null),
    );

    if (params.columnId) list = list.filter((t) => t.columnId === params.columnId);
    if (params.priorities?.length) {
      list = list.filter((t) => params.priorities!.includes(t.priority));
    }
    if (params.assigneeId) {
      list = list.filter((t) =>
        params.assigneeId === "unassigned" ? !t.assigneeId : t.assigneeId === params.assigneeId,
      );
    }
    if (params.q) {
      const q = params.q.toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q),
      );
    }

    list.sort((a, b) => comparePositions(a.position, b.position));

    if (params.cursor) {
      const idx = list.findIndex((t) => t.id === params.cursor);
      if (idx >= 0) list = list.slice(idx + 1);
    }

    const hasMore = list.length > params.limit;
    const sliced = hasMore ? list.slice(0, params.limit) : list;
    return {
      items: sliced.map((t) => this.buildSummary(t)),
      nextCursor: hasMore ? (sliced.at(-1)?.id ?? null) : null,
      hasMore,
    };
  }

  async updateTaskWithVersion(params: {
    taskId: string;
    orgId: string;
    expectedVersion?: number;
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
  }): Promise<{ ok: true; task: TaskDetailRecord } | { ok: false; currentVersion: number }> {
    const t = this.tasks.get(params.taskId);
    if (!t || t.orgId !== params.orgId || t.deletedAt) {
      return { ok: false, currentVersion: 0 };
    }
    if (params.expectedVersion !== undefined && t.version !== params.expectedVersion) {
      return { ok: false, currentVersion: t.version };
    }

    if (params.patch.title !== undefined) t.title = params.patch.title;
    if (params.patch.description !== undefined) t.description = params.patch.description;
    if (params.patch.columnId !== undefined) t.columnId = params.patch.columnId;
    if (params.patch.position !== undefined) t.position = params.patch.position;
    if (params.patch.priority !== undefined) t.priority = params.patch.priority;
    if (params.patch.assigneeId !== undefined) t.assigneeId = params.patch.assigneeId;
    if (params.patch.dueDate !== undefined) t.dueDate = params.patch.dueDate;
    if (params.patch.completedAt !== undefined) t.completedAt = params.patch.completedAt;
    if (params.patch.tagIds !== undefined) t.tagIds = params.patch.tagIds;
    t.version += 1;
    t.updatedAt = new Date();

    return { ok: true, task: this.buildDetail(t) };
  }

  async softDeleteTask(taskId: string, orgId: string) {
    const now = new Date();
    for (const t of this.tasks.values()) {
      if (t.orgId === orgId && (t.id === taskId || t.parentId === taskId)) {
        t.deletedAt = now;
      }
    }
  }

  async listProjectDependencyEdges(projectId: string) {
    return [...this.deps.values()]
      .filter((d) => d.projectId === projectId)
      .map((d) => ({ taskId: d.taskId, dependsOnTaskId: d.dependsOnTaskId }));
  }

  async findIncompleteBlockers(taskId: string) {
    const out = [];
    for (const d of this.deps.values()) {
      if (d.taskId !== taskId) continue;
      const pre = this.tasks.get(d.dependsOnTaskId);
      if (!pre || pre.deletedAt) continue;
      const col = this.columns.get(pre.columnId)!;
      if (col.category !== "DONE") {
        const proj = this.projects.get(pre.projectId)!;
        out.push({ id: pre.id, key: `${proj.key}-${pre.number}`, title: pre.title });
      }
    }
    return out;
  }

  async addDependency(params: {
    projectId: string;
    taskId: string;
    dependsOnTaskId: string;
  }) {
    const id = this.nextId("dep");
    this.deps.set(id, {
      id,
      projectId: params.projectId,
      taskId: params.taskId,
      dependsOnTaskId: params.dependsOnTaskId,
    });
    return { id };
  }

  async removeDependency(_projectId: string, _taskId: string, depId: string) {
    return this.deps.delete(depId);
  }

  async listComments(taskId: string) {
    const items = [...this.comments.values()].filter((c) => c.taskId === taskId && !c.deletedAt);
    return { items, nextCursor: null, hasMore: false };
  }

  async findCommentById(commentId: string) {
    const c = this.comments.get(commentId);
    if (!c || c.deletedAt) return null;
    return {
      id: c.id,
      orgId: c.orgId,
      taskId: c.taskId,
      projectId: c.projectId,
      authorId: c.author.id,
    };
  }

  async createComment(params: {
    orgId: string;
    projectId: string;
    taskId: string;
    authorId: string;
    body: string;
  }) {
    const author = this.users.get(params.authorId)!;
    const row = {
      id: this.nextId("cmt"),
      orgId: params.orgId,
      projectId: params.projectId,
      taskId: params.taskId,
      author,
      body: params.body,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date(),
    };
    this.comments.set(row.id, row);
    return row;
  }

  async updateComment(commentId: string, body: string) {
    const row = this.comments.get(commentId)!;
    row.body = body;
    row.editedAt = new Date();
    return row;
  }

  async softDeleteComment(commentId: string) {
    const row = this.comments.get(commentId);
    if (row) row.deletedAt = new Date();
  }

  async createAttachment(params: {
    orgId: string;
    taskId: string;
    uploaderId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string;
  }) {
    const task = this.tasks.get(params.taskId)!;
    const uploader = this.users.get(params.uploaderId)!;
    const row = {
      id: this.nextId("att"),
      projectId: task.projectId,
      orgId: params.orgId,
      taskId: params.taskId,
      uploaderId: params.uploaderId,
      uploaderName: uploader.name,
      fileName: params.fileName,
      mimeType: params.mimeType,
      sizeBytes: params.sizeBytes,
      storageKey: params.storageKey,
      createdAt: new Date(),
    };
    this.attachments.set(row.id, row);
    return row;
  }

  async findAttachmentById(attachmentId: string) {
    return this.attachments.get(attachmentId) ?? null;
  }

  async deleteAttachment(attachmentId: string) {
    this.attachments.delete(attachmentId);
  }
}

describe("Phase 4 — Project, Kanban, Dependency, Filter & Collaboration Engine (WS-401..WS-406)", () => {
  let tmpDir = "";
  let tenancyRepo: MemTenancyRepo;
  let projRepo: MemProjectTaskRepo;
  let service: ProjectTaskService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-p4-"));
    tenancyRepo = new MemTenancyRepo();
    tenancyRepo.seed({
      users: [
        { id: "u_owner", email: "owner@acme.io", name: "Alice Owner" },
        { id: "u_dev1", email: "dev1@acme.io", name: "Bob Dev" },
        { id: "u_dev2", email: "dev2@acme.io", name: "Cara Dev" },
        { id: "u_viewer", email: "viewer@acme.io", name: "Dan Viewer" },
        { id: "u_outsider", email: "out@other.io", name: "Eve Outsider" },
      ],
      orgs: [
        { id: "org_acme", name: "Acme", slug: "acme", ownerId: "u_owner" },
        { id: "org_other", name: "Other", slug: "other", ownerId: "u_outsider" },
      ],
      workspaces: [
        {
          id: "ws_eng",
          orgId: "org_acme",
          name: "Engineering",
          slug: "eng",
          creatorId: "u_owner",
        },
      ],
    });
    tenancyRepo.addOrgMember("org_acme", "u_dev1", "MEMBER");
    tenancyRepo.addOrgMember("org_acme", "u_dev2", "MEMBER");
    tenancyRepo.addOrgMember("org_acme", "u_viewer", "MEMBER");

    projRepo = new MemProjectTaskRepo(tenancyRepo.users);
    const tenancySvc = new TenancyService(tenancyRepo, noopMailer);
    service = new ProjectTaskService(
      projRepo,
      tenancySvc,
      new LocalDiskStorageAdapter(tmpDir),
    );
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("WS-401 & WS-402: enforces cross-tenant 404, project RBAC, ownership deletion, archive read-only, and optimistic locking", async () => {
    const { project, columns } = await service.createProject("u_owner", "ws_eng", {
      key: "ENG",
      name: "Core Platform",
    });
    expect(columns).toHaveLength(4);

    await service.upsertProjectMember("u_owner", project.id, "u_dev1", "MEMBER");
    await service.upsertProjectMember("u_owner", project.id, "u_dev2", "MEMBER");
    await service.upsertProjectMember("u_owner", project.id, "u_viewer", "VIEWER");

    // คนต่างองค์กรต้องได้ 404
    await expect(service.getProjectOverview("u_outsider", project.id)).rejects.toMatchObject({
      status: 404,
    });

    // VIEWER สร้างงานไม่ได้ (403) แต่คอมเมนต์ได้
    await expect(
      service.createTask("u_viewer", project.id, { title: "Blocked", priority: "LOW" }),
    ).rejects.toMatchObject({ status: 403 });

    const t1 = await service.createTask("u_dev1", project.id, {
      title: "Implement token service",
      priority: "HIGH",
    });
    expect(t1.key).toBe("ENG-1");

    // MEMBER คนอื่นลบงานของ u_dev1 ไม่ได้ (403) แต่เจ้าของลบงานตัวเองได้
    await expect(service.deleteTask("u_dev2", t1.id)).rejects.toMatchObject({ status: 403 });

    // Optimistic Locking: แก้ไขด้วย version เก่าต้องได้ 409 VERSION_CONFLICT
    const updated = await service.updateTask("u_dev1", t1.id, {
      title: "Implement token rotation",
      version: 1,
    });
    expect(updated.version).toBe(2);

    await expect(
      service.updateTask("u_dev2", t1.id, { title: "Stale overwrite", version: 1 }),
    ).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });

    // Archive project -> กลายเป็น read-only ทันที
    await service.updateProject("u_owner", project.id, { archived: true });
    await expect(
      service.createTask("u_dev1", project.id, { title: "In archive", priority: "MEDIUM" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("WS-403 & WS-404: persists Kanban ordering across reloads and enforces DAG cycle & completion dependency rules", async () => {
    const { project, columns } = await service.createProject("u_owner", "ws_eng", {
      key: "ENG",
      name: "Core Platform",
    });
    const todoCol = columns.find((c) => c.category === "TODO")!;
    const doneCol = columns.find((c) => c.category === "DONE")!;

    const t1 = await service.createTask("u_owner", project.id, {
      title: "Task One",
      priority: "HIGH",
      columnId: todoCol.id,
    });
    const t2 = await service.createTask("u_owner", project.id, {
      title: "Task Two",
      priority: "MEDIUM",
      columnId: todoCol.id,
    });
    const t3 = await service.createTask("u_owner", project.id, {
      title: "Task Three",
      priority: "LOW",
      columnId: todoCol.id,
    });

    // ลาก t3 มาแทรกระหว่าง t1 และ t2 แล้วโหลดใหม่ ลำดับต้องคงเป็น [ENG-1, ENG-3, ENG-2]
    await service.moveTask("u_owner", t3.id, {
      columnId: todoCol.id,
      beforeTaskId: t1.id,
      afterTaskId: t2.id,
    });

    const reloaded = await service.queryTasks("u_owner", project.id, {
      includeSubtasks: "0",
      sort: "position:asc",
      limit: 50,
    });
    expect(reloaded.items.map((i) => i.key)).toEqual(["ENG-1", "ENG-3", "ENG-2"]);

    // ผูก Dependency: ENG-2 ต้องรอ ENG-1 และ ENG-3 ต้องรอ ENG-2
    await service.addDependency("u_owner", t2.id, t1.id);
    await service.addDependency("u_owner", t3.id, t2.id);

    // พยายามผูก ENG-1 ต้องรอ ENG-3 (เกิดวงจรปิด 3 ต่อ) -> ต้องถูกบล็อกด้วย 409 DEPENDENCY_CYCLE
    await expect(service.addDependency("u_owner", t1.id, t3.id)).rejects.toMatchObject({
      status: 409,
      code: "DEPENDENCY_CYCLE",
    });

    // พยายามย้าย ENG-2 ไปคอลัมน์ DONE ทั้งที่ ENG-1 ยังไม่เสร็จ -> บล็อกด้วย 409 DEPENDENCY_INCOMPLETE
    await expect(
      service.moveTask("u_owner", t2.id, { columnId: doneCol.id }),
    ).rejects.toMatchObject({
      status: 409,
      code: "DEPENDENCY_INCOMPLETE",
    });

    // เมื่อย้าย ENG-1 ไป DONE ก่อน จึงจะย้าย ENG-2 ไป DONE ได้สำเร็จ
    await service.moveTask("u_owner", t1.id, { columnId: doneCol.id });
    const completedT2 = await service.moveTask("u_owner", t2.id, { columnId: doneCol.id });
    expect(completedT2.completedAt).not.toBeNull();
  });

  it("WS-405 & WS-406: supports search, cursor pagination, comments, and file attachments", async () => {
    const { project } = await service.createProject("u_owner", "ws_eng", {
      key: "WS",
      name: "WorkSphere App",
    });
    await service.upsertProjectMember("u_owner", project.id, "u_dev1", "MEMBER");

    const a = await service.createTask("u_owner", project.id, {
      title: "Alpha API",
      priority: "HIGH",
    });
    await service.createTask("u_owner", project.id, { title: "Beta Board", priority: "HIGH" });
    await service.createTask("u_owner", project.id, { title: "Gamma Cache", priority: "LOW" });

    // Cursor pagination หน้าละ 2 รายการ
    const page1 = await service.queryTasks("u_owner", project.id, {
      includeSubtasks: "0",
      sort: "position:asc",
      limit: 2,
    });
    expect(page1.items.map((x) => x.key)).toEqual(["WS-1", "WS-2"]);
    expect(page1.hasMore).toBe(true);

    const page2 = await service.queryTasks("u_owner", project.id, {
      includeSubtasks: "0",
      sort: "position:asc",
      cursor: page1.nextCursor ?? undefined,
      limit: 2,
    });
    expect(page2.items.map((x) => x.key)).toEqual(["WS-3"]);
    expect(page2.hasMore).toBe(false);

    // Comments: เจ้าของแก้ไขได้ คนอื่นแก้ไขคอมเมนต์ของเพื่อนไม่ได้ (403)
    const cmt = await service.createComment("u_dev1", a.id, "Working on endpoint");
    await expect(service.updateComment("u_owner", cmt.id, "Hijack")).rejects.toMatchObject({
      status: 403,
    });
    const edited = await service.updateComment("u_dev1", cmt.id, "Endpoint ready for review");
    expect(edited.body).toBe("Endpoint ready for review");

    // Attachments: upload + download + delete
    const uploaded = await service.uploadAttachment("u_dev1", a.id, {
      fileName: "spec.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("API contract v1"),
    });
    const downloaded = await service.downloadAttachment("u_owner", uploaded.id);
    expect(downloaded.bytes.toString("utf8")).toBe("API contract v1");

    await service.deleteAttachment("u_dev1", uploaded.id);
    await expect(service.downloadAttachment("u_owner", uploaded.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});
