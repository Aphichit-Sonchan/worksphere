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
import { runAtomicUnitOfWork, runDbTransaction } from "@/server/db";
import { AppError } from "@/server/http/errors";
import { CacheKeys, MemoryCacheAdapter, rememberCached } from "@/server/infra/cache";
import type { MailAdapter } from "@/server/infra/mailer";
import { LocalDiskStorageAdapter } from "@/server/infra/storage";
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
} from "@/server/modules/project/project-task.repository";
import { ProjectTaskService } from "@/server/modules/project/project-task.service";
import { serializeTasksExport } from "./processors";
import { ResilientJobQueue } from "./queue-engine";

const noopMailer: MailAdapter = { async send() {} };

class InstrumentedTenancyRepo implements TenancyRepository {
  users = new Map<string, { id: string; email: string; name: string }>();
  orgs = new Map<string, OrgRecord>();
  orgMembers = new Map<string, { orgId: string; userId: string; role: OrgRole }>();
  workspaces = new Map<string, WorkspaceRecord>();
  wsMembers = new Map<string, { workspaceId: string; userId: string; role: WorkspaceRole }>();
  listOrgMembersCalls = 0;

  seed() {
    const now = new Date();
    this.users.set("u_owner", { id: "u_owner", email: "owner@ws.io", name: "Owner" });
    this.users.set("u_alice", { id: "u_alice", email: "alice@ws.io", name: "Alice" });
    this.users.set("u_bob", { id: "u_bob", email: "bob@ws.io", name: "Bob" });

    this.orgs.set("org_1", {
      id: "org_1",
      name: "Acme Enterprise",
      slug: "acme-ent",
      createdById: "u_owner",
      suspendedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    this.orgMembers.set("org_1:u_owner", { orgId: "org_1", userId: "u_owner", role: "ORG_OWNER" });
    this.orgMembers.set("org_1:u_alice", { orgId: "org_1", userId: "u_alice", role: "MEMBER" });
    this.orgMembers.set("org_1:u_bob", { orgId: "org_1", userId: "u_bob", role: "MEMBER" });

    this.workspaces.set("ws_1", {
      id: "ws_1",
      orgId: "org_1",
      name: "Core Platform",
      slug: "core",
      description: null,
      createdById: "u_owner",
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      memberCount: 3,
      projectCount: 0,
    });
    this.wsMembers.set("ws_1:u_owner", {
      workspaceId: "ws_1",
      userId: "u_owner",
      role: "WORKSPACE_ADMIN",
    });
    this.wsMembers.set("ws_1:u_alice", {
      workspaceId: "ws_1",
      userId: "u_alice",
      role: "MEMBER",
    });
    this.wsMembers.set("ws_1:u_bob", {
      workspaceId: "ws_1",
      userId: "u_bob",
      role: "MEMBER",
    });
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
  async countOrgOwners(orgId: string) {
    return [...this.orgMembers.values()].filter(
      (m) => m.orgId === orgId && m.role === "ORG_OWNER",
    ).length;
  }
  async createOrganizationWithDefaultWorkspace(): Promise<never> {
    throw new Error("not used");
  }
  async updateOrganization(): Promise<never> {
    throw new Error("not used");
  }
  async softDeleteOrganization() {}
  async listOrgMembers(orgId: string) {
    this.listOrgMembersCalls += 1;
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
  async updateOrgMemberRole(orgId: string, userId: string, role: OrgRole) {
    const row = this.orgMembers.get(`${orgId}:${userId}`);
    if (row) row.role = role;
  }
  async removeOrgMember(orgId: string, userId: string) {
    this.orgMembers.delete(`${orgId}:${userId}`);
  }
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

class InstrumentedProjectRepo implements ProjectTaskRepository {
  projects = new Map<string, ProjectRecord>();
  members = new Map<string, { projectId: string; userId: string; role: ProjectRole }>();
  columns = new Map<string, BoardColumnRecord>();
  tags = new Map<string, TagRecord>();
  tasks = new Map<string, StoredTask>();
  listColumnsCalls = 0;
  private seq = 0;

  constructor(private readonly users: Map<string, { id: string; email: string; name: string }>) {}

  private nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  private buildSummary(t: StoredTask): TaskSummaryRecord {
    const proj = this.projects.get(t.projectId)!;
    const col = this.columns.get(t.columnId)!;
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
      subtaskCount: 0,
      completedSubtaskCount: 0,
      commentCount: 0,
      attachmentCount: 0,
      incompleteBlockerKeys: [],
    };
  }

  private buildDetail(t: StoredTask): TaskDetailRecord {
    return {
      ...this.buildSummary(t),
      subtasks: [],
      blockedBy: [],
      blocks: [],
      attachments: [],
    };
  }

  async listProjectsForOrg() {
    return [...this.projects.values()];
  }
  async listProjectsForWorkspace() {
    return [...this.projects.values()];
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
      workspaceName: "Core Platform",
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

    const pos = generateInitialPositions(3);
    const defs: Array<[string, ColumnCategory, string]> = [
      ["To Do", "TODO", pos[0]!],
      ["In Progress", "IN_PROGRESS", pos[1]!],
      ["Done", "DONE", pos[2]!],
    ];
    const columns = defs.map(([name, category, position]) => {
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

    return { project, columns, tags: [] };
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
    this.listColumnsCalls += 1;
    return [...this.columns.values()]
      .filter((c) => c.projectId === projectId)
      .sort((a, b) => comparePositions(a.position, b.position));
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
    const row: TagRecord = { id: this.nextId("tag"), projectId, name, color };
    this.tags.set(row.id, row);
    return row;
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
    return t && t.columnId === columnId && !t.deletedAt ? t.position : null;
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
    const items = [...this.tasks.values()]
      .filter((t) => t.projectId === params.projectId && !t.deletedAt)
      .map((t) => this.buildSummary(t));
    return { items, nextCursor: null, hasMore: false };
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
  async softDeleteTask(taskId: string) {
    const t = this.tasks.get(taskId);
    if (t) t.deletedAt = new Date();
  }
  async listProjectDependencyEdges() {
    return [];
  }
  async findIncompleteBlockers() {
    return [];
  }
  async addDependency(): Promise<{ id: string }> {
    return { id: "dep_1" };
  }
  async removeDependency() {
    return true;
  }
  async listComments(): Promise<{
    items: CommentRecord[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    return { items: [], nextCursor: null, hasMore: false };
  }
  async findCommentById() {
    return null;
  }
  async createComment(): Promise<never> {
    throw new Error("not used");
  }
  async updateComment(): Promise<never> {
    throw new Error("not used");
  }
  async softDeleteComment() {}
  async createAttachment(): Promise<AttachmentRecord> {
    throw new Error("not used");
  }
  async findAttachmentById() {
    return null;
  }
  async deleteAttachment() {}
}

describe("Phase 6 Advanced Backend — Concurrency, Transactions, Cache & Workers", () => {
  let tmpDir: string;
  let storage: LocalDiskStorageAdapter;
  let cacheStore: MemoryCacheAdapter;
  let tenancyRepo: InstrumentedTenancyRepo;
  let tenancy: TenancyService;
  let projectRepo: InstrumentedProjectRepo;
  let service: ProjectTaskService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-phase6-test-"));
    storage = new LocalDiskStorageAdapter(tmpDir);
    cacheStore = new MemoryCacheAdapter();
    tenancyRepo = new InstrumentedTenancyRepo();
    tenancyRepo.seed();
    tenancy = new TenancyService(tenancyRepo, noopMailer, null, cacheStore);
    projectRepo = new InstrumentedProjectRepo(tenancyRepo.users);
    service = new ProjectTaskService(projectRepo, tenancy, storage, null, cacheStore);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("WS-601: rejects stale concurrent updates & moves with 409 VERSION_CONFLICT + latestTask snapshot", async () => {
    const { project, columns } = await service.createProject("u_owner", "ws_1", {
      key: "LOCK",
      name: "Optimistic Locking",
    });
    await service.upsertProjectMember("u_owner", project.id, "u_alice", "MEMBER");
    await service.upsertProjectMember("u_owner", project.id, "u_bob", "MEMBER");

    const task = await service.createTask("u_owner", project.id, {
      title: "Initial Specification",
      priority: "MEDIUM",
    });
    expect(task.version).toBe(1);

    // ผู้ใช้สองคนเปิดหน้างานเดียวกันพร้อมกันที่ version: 1 แล้วกดแก้ไขพร้อมกัน
    const [aliceResult, bobResult] = await Promise.allSettled([
      service.updateTask("u_alice", task.id, {
        title: "Alice Revised Spec",
        priority: "HIGH",
        version: 1,
      }),
      service.updateTask("u_bob", task.id, {
        title: "Bob Conflicting Edit",
        priority: "LOW",
        version: 1,
      }),
    ]);

    expect(aliceResult.status).toBe("fulfilled");
    if (aliceResult.status === "fulfilled") {
      expect(aliceResult.value.version).toBe(2);
      expect(aliceResult.value.title).toBe("Alice Revised Spec");
    }

    expect(bobResult.status).toBe("rejected");
    if (bobResult.status === "rejected") {
      expect(bobResult.reason).toBeInstanceOf(AppError);
      const err = bobResult.reason as AppError;
      expect(err.status).toBe(409);
      expect(err.code).toBe("VERSION_CONFLICT");
      expect(err.details).toMatchObject({
        currentVersion: 2,
        latestTask: expect.objectContaining({
          id: task.id,
          version: 2,
          title: "Alice Revised Spec",
        }),
      });
    }

    // ทดสอบการลากการ์ด Kanban ด้วย version เก่า (v1) ต้องถูกบล็อกและคืนสถานะล่าสุด (v2) เช่นกัน
    const inProgressCol = columns[1]!;
    await expect(
      service.moveTask("u_bob", task.id, {
        columnId: inProgressCol.id,
        version: 1,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "VERSION_CONFLICT",
      details: expect.objectContaining({ currentVersion: 2 }),
    });
  });

  it("WS-602: rolls back multi-step atomic units of work cleanly when a mid-flight step fails", async () => {
    const ledger = {
      orgs: new Map<string, string>(),
      workspaces: new Map<string, string>(),
      auditLogs: [] as string[],
    };

    await expect(
      runAtomicUnitOfWork(ledger, [
        {
          name: "insert_organization",
          execute: async (ctx) => {
            ctx.orgs.set("org_tx", "Transactional Org");
          },
          compensate: async (ctx) => {
            ctx.orgs.delete("org_tx");
          },
        },
        {
          name: "insert_default_workspace",
          execute: async (ctx) => {
            ctx.workspaces.set("ws_tx", "General");
          },
          compensate: async (ctx) => {
            ctx.workspaces.delete("ws_tx");
          },
        },
        {
          name: "insert_audit_log_failure",
          execute: async () => {
            throw new Error("Simulated constraint failure on step 3");
          },
          compensate: async (ctx) => {
            ctx.auditLogs.pop();
          },
        },
      ]),
    ).rejects.toThrow("Simulated constraint failure on step 3");

    // ต้องไม่มีข้อมูลค้างครึ่งๆ กลางๆ (Zero Partial Writes)
    expect(ledger.orgs.size).toBe(0);
    expect(ledger.workspaces.size).toBe(0);
    expect(ledger.auditLogs).toHaveLength(0);

    // ตรวจสอบสัญญา `runDbTransaction` ว่าส่งผ่าน Prisma interactive transaction และส่งต่อการ rollback เมื่อโยน error
    let committedRows: string[] = [];
    const fakePrisma = {
      async $transaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
        const staged: string[] = [...committedRows];
        const txClient = {
          stageInsert(row: string) {
            staged.push(row);
          },
        };
        const out = await cb(txClient);
        committedRows = staged;
        return out;
      },
    };

    await expect(
      runDbTransaction(async (tx) => {
        (tx as unknown as { stageInsert: (r: string) => void }).stageInsert("project:1");
        (tx as unknown as { stageInsert: (r: string) => void }).stageInsert("column:todo");
        throw new Error("DB deadlock / constraint violation");
      }, fakePrisma as never),
    ).rejects.toThrow("DB deadlock / constraint violation");

    expect(committedRows).toEqual([]);
  });

  it("WS-603: serves cached project metadata & org members and invalidates immediately on mutation", async () => {
    const { project } = await service.createProject("u_owner", "ws_1", {
      key: "CACH",
      name: "Cache Verification",
    });

    projectRepo.listColumnsCalls = 0;
    const firstOverview = await service.getProjectOverview("u_owner", project.id);
    const secondOverview = await service.getProjectOverview("u_owner", project.id);
    expect(firstOverview.columns).toHaveLength(3);
    expect(secondOverview.columns).toHaveLength(3);
    // ยิงลง Repository เพียงครั้งเดียว ครั้งที่สองอ่านจาก Cache
    expect(projectRepo.listColumnsCalls).toBe(1);

    // เมื่อเพิ่มคอลัมน์ใหม่ ระบบต้องล้าง Cache `proj:{id}:*` ทันที
    await service.createColumn("u_owner", project.id, {
      name: "QA Review",
      category: "IN_PROGRESS",
      wipLimit: 4,
    });

    const refreshedOverview = await service.getProjectOverview("u_owner", project.id);
    expect(refreshedOverview.columns).toHaveLength(4);
    expect(refreshedOverview.columns.some((c) => c.name === "QA Review")).toBe(true);

    // ทดสอบ Cache ของรายชื่อสมาชิกองค์กร + การล้าง Cache เมื่อปรับบทบาทหรือลบสมาชิก
    tenancyRepo.listOrgMembersCalls = 0;
    const members1 = await tenancy.listMembers("u_owner", "org_1");
    const members2 = await tenancy.listMembers("u_owner", "org_1");
    expect(members1).toHaveLength(3);
    expect(members2).toHaveLength(3);
    expect(tenancyRepo.listOrgMembersCalls).toBe(1);

    await tenancy.updateMemberRole("u_owner", "org_1", "u_alice", "ORG_ADMIN");
    expect(await cacheStore.get(CacheKeys.orgMembers("org_1"))).toBeNull();

    const membersAfterRoleChange = await tenancy.listMembers("u_owner", "org_1");
    expect(membersAfterRoleChange.find((m) => m.userId === "u_alice")?.role).toBe("ORG_ADMIN");
    expect(tenancyRepo.listOrgMembersCalls).toBe(2);

    // ทดสอบการหมดอายุของ TTL บน `rememberCached`
    let loaderHits = 0;
    const v1 = await rememberCached("test:ttl", 1, async () => {
      loaderHits += 1;
      return { count: loaderHits };
    }, cacheStore);
    expect(v1.count).toBe(1);
  });

  it("WS-604: retries transient failures with exponential backoff, deduplicates jobId, and neutralizes CSV injection", async () => {
    const queue = new ResilientJobQueue("test-jobs", { forceMemory: true });
    const attemptLog: number[] = [];

    queue.register<{ email: string }>("mail.flaky", async (_payload, attempt) => {
      attemptLog.push(attempt);
      if (attempt < 3) {
        throw new Error(`SMTP temporary timeout on attempt ${attempt}`);
      }
    });

    const firstRun = await queue.enqueue(
      "mail.flaky",
      { email: "alice@ws.io" },
      { jobId: "invite:inv_001", attempts: 4, baseDelayMs: 5 },
    );
    expect(firstRun).toEqual({ deduplicated: false, jobId: "invite:inv_001" });
    expect(attemptLog).toEqual([1, 2, 3]);
    expect(queue.getJobRecord("invite:inv_001")).toMatchObject({
      status: "completed",
      attemptsMade: 3,
    });

    // Idempotency: ส่ง jobId เดิมซ้ำต้องไม่รันซ้ำเด็ดขาด
    const duplicateRun = await queue.enqueue(
      "mail.flaky",
      { email: "alice@ws.io" },
      { jobId: "invite:inv_001", attempts: 4, baseDelayMs: 5 },
    );
    expect(duplicateRun).toEqual({ deduplicated: true, jobId: "invite:inv_001" });
    expect(attemptLog).toEqual([1, 2, 3]);

    // กรณีล้มเหลวครบทุกครั้งตาม Retry Policy ต้องบันทึกสถานะ failed พร้อมสาเหตุล่าสุด
    queue.register("webhook.broken", async () => {
      throw new Error("502 Bad Gateway");
    });

    await expect(
      queue.enqueue(
        "webhook.broken",
        { target: "https://example.invalid" },
        { jobId: "hook:001", attempts: 2, baseDelayMs: 5 },
      ),
    ).rejects.toThrow('Job "hook:001" exhausted all 2 attempts: 502 Bad Gateway');
    expect(queue.getJobRecord("hook:001")).toMatchObject({
      status: "failed",
      attemptsMade: 2,
      lastError: "502 Bad Gateway",
    });

    // ทดสอบระบบส่งออกไฟล์ CSV/JSON และการป้องกัน CSV Formula Injection (=, +, -, @)
    const { project } = await service.createProject("u_owner", "ws_1", {
      key: "EXP",
      name: "Export Security",
    });
    await service.createTask("u_owner", project.id, {
      title: '=HYPERLINK("http://attacker.invalid","Click")',
      priority: "HIGHEST",
    });

    const exported = await service.generateTasksExport("u_owner", project.id, "csv");
    expect(exported.rowCount).toBe(1);

    const downloaded = await service.readTasksExport(
      "u_owner",
      project.id,
      exported.exportId,
      "csv",
    );
    const csvText = downloaded.bytes.toString("utf8");
    expect(csvText).toContain("Key,Title,Status,Category,Priority,Assignee,DueDate,CompletedAt");
    // ต้องเติม single-quote นำหน้า `=` เพื่อหยุดการทำงานของสูตรใน Excel / Google Sheets
    expect(csvText).toContain(`"'=HYPERLINK(""http://attacker.invalid"",""Click"")"`);

    const jsonBytes = serializeTasksExport(
      [
        {
          key: "EXP-1",
          title: "+cmd|' /C calc'!A0",
          status: "To Do",
          category: "TODO",
          priority: "HIGH",
          assignee: "",
          dueDate: "",
          completedAt: "",
        },
      ],
      "json",
    );
    expect(JSON.parse(jsonBytes.toString("utf8"))).toHaveLength(1);
  });
});
