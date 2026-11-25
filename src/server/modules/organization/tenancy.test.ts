import { beforeEach, describe, expect, it } from "vitest";
import type { OrgRole, WorkspaceRole } from "@/generated/prisma/enums";
import type { MailAdapter, MailMessage } from "@/server/infra/mailer";
import type {
  AdminOrgSummary,
  InvitationRecord,
  OrgMemberDetail,
  OrgRecord,
  TenancyRepository,
  WorkspaceMemberDetail,
  WorkspaceRecord,
} from "./tenancy.repository";
import { TenancyService } from "./tenancy.service";

class InMemoryTenancyRepository implements TenancyRepository {
  users = new Map<string, { id: string; email: string; name: string }>();
  orgs = new Map<string, OrgRecord>();
  orgMembers = new Map<string, { orgId: string; userId: string; role: OrgRole; createdAt: Date }>();
  invitations = new Map<string, InvitationRecord>();
  workspaces = new Map<string, Omit<WorkspaceRecord, "memberCount" | "projectCount">>();
  wsMembers = new Map<
    string,
    { workspaceId: string; userId: string; role: WorkspaceRole; createdAt: Date }
  >();
  private seq = 0;

  seedUser(id: string, email: string, name: string) {
    this.users.set(id, { id, email, name });
  }

  private nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  private hydrateWorkspace(
    raw: Omit<WorkspaceRecord, "memberCount" | "projectCount">,
  ): WorkspaceRecord {
    let memberCount = 0;
    for (const m of this.wsMembers.values()) {
      if (m.workspaceId === raw.id) memberCount += 1;
    }
    return { ...raw, memberCount, projectCount: 0 };
  }

  async findUserBasicById(userId: string) {
    return this.users.get(userId) ?? null;
  }

  async listOrganizationsForUser(userId: string) {
    const out: Array<{
      org: OrgRecord;
      role: OrgRole;
      workspaceCount: number;
      memberCount: number;
    }> = [];
    for (const m of this.orgMembers.values()) {
      if (m.userId !== userId) continue;
      const org = this.orgs.get(m.orgId);
      if (!org || org.deletedAt || org.suspendedAt) continue;
      const workspaceCount = [...this.workspaces.values()].filter((w) => w.orgId === org.id).length;
      const memberCount = [...this.orgMembers.values()].filter((om) => om.orgId === org.id).length;
      out.push({ org, role: m.role, workspaceCount, memberCount });
    }
    return out;
  }

  async findOrgBySlug(slug: string) {
    for (const o of this.orgs.values()) {
      if (o.slug === slug) return o;
    }
    return null;
  }

  async findOrgById(orgId: string) {
    return this.orgs.get(orgId) ?? null;
  }

  async findOrgMembership(orgId: string, userId: string) {
    const row = this.orgMembers.get(`${orgId}:${userId}`);
    return row ? { role: row.role } : null;
  }

  async countOrgOwners(orgId: string) {
    let n = 0;
    for (const m of this.orgMembers.values()) {
      if (m.orgId === orgId && m.role === "ORG_OWNER") n += 1;
    }
    return n;
  }

  async createOrganizationWithDefaultWorkspace(params: {
    name: string;
    slug: string;
    creatorId: string;
  }) {
    const now = new Date();
    const org: OrgRecord = {
      id: this.nextId("org"),
      name: params.name,
      slug: params.slug,
      createdById: params.creatorId,
      suspendedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.orgs.set(org.id, org);
    this.orgMembers.set(`${org.id}:${params.creatorId}`, {
      orgId: org.id,
      userId: params.creatorId,
      role: "ORG_OWNER",
      createdAt: now,
    });

    const wsId = this.nextId("ws");
    const wsRaw = {
      id: wsId,
      orgId: org.id,
      name: "General",
      slug: "general",
      description: "Default organization workspace",
      createdById: params.creatorId,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.workspaces.set(wsId, wsRaw);
    this.wsMembers.set(`${wsId}:${params.creatorId}`, {
      workspaceId: wsId,
      userId: params.creatorId,
      role: "WORKSPACE_ADMIN",
      createdAt: now,
    });

    return { org, defaultWorkspace: this.hydrateWorkspace(wsRaw) };
  }

  async updateOrganization(orgId: string, data: { name: string }) {
    const org = this.orgs.get(orgId)!;
    org.name = data.name;
    org.updatedAt = new Date();
    return org;
  }

  async softDeleteOrganization(orgId: string) {
    const org = this.orgs.get(orgId);
    if (org) org.deletedAt = new Date();
  }

  async listOrgMembers(orgId: string): Promise<OrgMemberDetail[]> {
    const res: OrgMemberDetail[] = [];
    for (const m of this.orgMembers.values()) {
      if (m.orgId !== orgId) continue;
      const u = this.users.get(m.userId)!;
      res.push({
        userId: u.id,
        email: u.email,
        name: u.name,
        avatarUrl: null,
        role: m.role,
        joinedAt: m.createdAt,
      });
    }
    return res;
  }

  async updateOrgMemberRole(orgId: string, userId: string, role: OrgRole) {
    const row = this.orgMembers.get(`${orgId}:${userId}`);
    if (row) row.role = role;
  }

  async removeOrgMember(orgId: string, userId: string) {
    this.orgMembers.delete(`${orgId}:${userId}`);
    for (const [k, wm] of this.wsMembers.entries()) {
      const ws = this.workspaces.get(wm.workspaceId);
      if (wm.userId === userId && ws?.orgId === orgId) {
        this.wsMembers.delete(k);
      }
    }
  }

  async listPendingInvitations(orgId: string) {
    const now = new Date();
    return [...this.invitations.values()].filter(
      (i) => i.orgId === orgId && !i.acceptedAt && !i.revokedAt && i.expiresAt > now,
    );
  }

  async createInvitation(params: {
    orgId: string;
    workspaceId?: string;
    email: string;
    role: OrgRole;
    tokenHash: string;
    invitedById: string;
    expiresAt: Date;
  }): Promise<InvitationRecord> {
    const org = this.orgs.get(params.orgId)!;
    const inv: InvitationRecord = {
      id: this.nextId("inv"),
      orgId: params.orgId,
      orgName: org.name,
      workspaceId: params.workspaceId ?? null,
      email: params.email,
      role: params.role,
      tokenHash: params.tokenHash,
      invitedById: params.invitedById,
      expiresAt: params.expiresAt,
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.invitations.set(inv.id, inv);
    return inv;
  }

  async findInvitationById(invitationId: string) {
    return this.invitations.get(invitationId) ?? null;
  }

  async findInvitationByTokenHash(tokenHash: string) {
    for (const inv of this.invitations.values()) {
      if (inv.tokenHash === tokenHash) return inv;
    }
    return null;
  }

  async revokeInvitation(invitationId: string) {
    const inv = this.invitations.get(invitationId);
    if (inv) inv.revokedAt = new Date();
  }

  async acceptInvitation(params: {
    invitationId: string;
    orgId: string;
    workspaceId: string | null;
    userId: string;
    role: OrgRole;
    now: Date;
  }) {
    const inv = this.invitations.get(params.invitationId);
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= params.now) return false;
    inv.acceptedAt = params.now;

    const key = `${params.orgId}:${params.userId}`;
    if (!this.orgMembers.has(key)) {
      this.orgMembers.set(key, {
        orgId: params.orgId,
        userId: params.userId,
        role: params.role,
        createdAt: params.now,
      });
    }
    if (params.workspaceId) {
      const wk = `${params.workspaceId}:${params.userId}`;
      if (!this.wsMembers.has(wk)) {
        this.wsMembers.set(wk, {
          workspaceId: params.workspaceId,
          userId: params.userId,
          role: "MEMBER",
          createdAt: params.now,
        });
      }
    }
    return true;
  }

  async listWorkspaces(orgId: string, filterForUserId?: string) {
    return [...this.workspaces.values()]
      .filter((w) => {
        if (w.orgId !== orgId) return false;
        if (!filterForUserId) return true;
        return this.wsMembers.has(`${w.id}:${filterForUserId}`);
      })
      .map((w) => this.hydrateWorkspace(w));
  }

  async findWorkspaceBySlug(orgId: string, slug: string) {
    for (const w of this.workspaces.values()) {
      if (w.orgId === orgId && w.slug === slug) return this.hydrateWorkspace(w);
    }
    return null;
  }

  async findWorkspaceById(workspaceId: string) {
    const w = this.workspaces.get(workspaceId);
    return w ? this.hydrateWorkspace(w) : null;
  }

  async findWorkspaceMembership(workspaceId: string, userId: string) {
    const m = this.wsMembers.get(`${workspaceId}:${userId}`);
    return m ? { role: m.role } : null;
  }

  async createWorkspace(params: {
    orgId: string;
    name: string;
    slug: string;
    description?: string;
    creatorId: string;
  }) {
    const now = new Date();
    const id = this.nextId("ws");
    const raw = {
      id,
      orgId: params.orgId,
      name: params.name,
      slug: params.slug,
      description: params.description ?? null,
      createdById: params.creatorId,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.workspaces.set(id, raw);
    this.wsMembers.set(`${id}:${params.creatorId}`, {
      workspaceId: id,
      userId: params.creatorId,
      role: "WORKSPACE_ADMIN",
      createdAt: now,
    });
    return this.hydrateWorkspace(raw);
  }

  async updateWorkspace(
    workspaceId: string,
    data: { name?: string; description?: string | null; archivedAt?: Date | null },
  ) {
    const w = this.workspaces.get(workspaceId)!;
    if (data.name !== undefined) w.name = data.name;
    if (data.description !== undefined) w.description = data.description;
    if (data.archivedAt !== undefined) w.archivedAt = data.archivedAt;
    w.updatedAt = new Date();
    return this.hydrateWorkspace(w);
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberDetail[]> {
    const out: WorkspaceMemberDetail[] = [];
    for (const m of this.wsMembers.values()) {
      if (m.workspaceId !== workspaceId) continue;
      const u = this.users.get(m.userId)!;
      out.push({
        userId: u.id,
        email: u.email,
        name: u.name,
        role: m.role,
        joinedAt: m.createdAt,
      });
    }
    return out;
  }

  async upsertWorkspaceMember(workspaceId: string, userId: string, role: WorkspaceRole) {
    this.wsMembers.set(`${workspaceId}:${userId}`, {
      workspaceId,
      userId,
      role,
      createdAt: new Date(),
    });
  }

  async removeWorkspaceMember(workspaceId: string, userId: string) {
    this.wsMembers.delete(`${workspaceId}:${userId}`);
  }

  async listAllOrganizationsForAdmin(): Promise<AdminOrgSummary[]> {
    return [...this.orgs.values()]
      .filter((o) => !o.deletedAt)
      .map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        suspendedAt: o.suspendedAt,
        createdAt: o.createdAt,
        memberCount: [...this.orgMembers.values()].filter((m) => m.orgId === o.id).length,
        workspaceCount: [...this.workspaces.values()].filter((w) => w.orgId === o.id).length,
      }));
  }

  async setOrganizationSuspended(orgId: string, suspendedAt: Date | null) {
    const org = this.orgs.get(orgId)!;
    org.suspendedAt = suspendedAt;
    return org;
  }
}

class CaptureMailer implements MailAdapter {
  messages: MailMessage[] = [];
  async send(msg: MailMessage) {
    this.messages.push(msg);
  }
  extractInviteToken(): string {
    const last = this.messages.at(-1)?.text ?? "";
    const match = last.match(/\/invitations\/([^\s]+)/);
    return match ? decodeURIComponent(match[1]!) : "";
  }
}

describe("Phase 3 — Multi-Tenant Isolation, Invitations & RBAC (WS-301..WS-305)", () => {
  let repo: InMemoryTenancyRepository;
  let mail: CaptureMailer;
  let service: TenancyService;

  beforeEach(() => {
    repo = new InMemoryTenancyRepository();
    mail = new CaptureMailer();
    service = new TenancyService(repo, mail);

    repo.seedUser("u_alice", "alice@alpha.io", "Alice");
    repo.seedUser("u_bob", "bob@beta.io", "Bob");
    repo.seedUser("u_charlie", "charlie@alpha.io", "Charlie");
    repo.seedUser("u_eve", "eve@intruder.io", "Eve");
  });

  it("WS-305: blocks every cross-tenant read and mutation between Organization A and Organization B with 404", async () => {
    const alpha = await service.createOrganization("u_alice", {
      name: "Alpha Corp",
      slug: "alpha-corp",
    });
    const beta = await service.createOrganization("u_bob", {
      name: "Beta Labs",
      slug: "beta-labs",
    });

    const orgB = beta.organization.id;
    const wsB = beta.defaultWorkspace.id;

    // Alice (Owner of Alpha) ต้องเข้าถึง Beta ไม่ได้ทุกช่องทาง (ตอบ 404 เพื่อซ่อน ID)
    await expect(service.getOrganization("u_alice", orgB)).rejects.toMatchObject({ status: 404 });
    await expect(
      service.updateOrganization("u_alice", orgB, { name: "Hacked" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.deleteOrganization("u_alice", orgB)).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.listMembers("u_alice", orgB)).rejects.toMatchObject({ status: 404 });
    await expect(
      service.createInvitation("u_alice", orgB, { email: "x@y.com", role: "MEMBER" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.listWorkspaces("u_alice", orgB)).rejects.toMatchObject({ status: 404 });
    await expect(service.getWorkspace("u_alice", wsB)).rejects.toMatchObject({ status: 404 });
    await expect(
      service.addWorkspaceMember("u_alice", wsB, { userId: "u_alice", role: "WORKSPACE_ADMIN" }),
    ).rejects.toMatchObject({ status: 404 });

    // ห้ามดึงคนนอกองค์กรเข้า Workspace ของตัวเองโดยไม่ผ่านการเป็นสมาชิกองค์กร
    await expect(
      service.addWorkspaceMember("u_alice", alpha.defaultWorkspace.id, {
        userId: "u_bob",
        role: "MEMBER",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("enforces invitation email binding, single-use acceptance, revocation, and workspace scoping", async () => {
    const { organization, defaultWorkspace } = await service.createOrganization("u_alice", {
      name: "Alpha Corp",
      slug: "alpha-corp",
    });
    const secretWs = await service.createWorkspace("u_alice", organization.id, {
      name: "R&D Secret",
      slug: "rnd-secret",
    });

    // เชิญ Charlie เข้าเป็น MEMBER พร้อมผูกเข้า defaultWorkspace
    await service.createInvitation("u_alice", organization.id, {
      email: "charlie@alpha.io",
      role: "MEMBER",
      workspaceId: defaultWorkspace.id,
    });
    const token = mail.extractInviteToken();

    // Eve นำลิงก์ของ Charlie ไปกดรับเอง -> ต้องถูกปฏิเสธด้วย 403
    await expect(service.acceptInvitation("u_eve", token)).rejects.toMatchObject({ status: 403 });

    // Charlie กดรับสำเร็จ และใช้ซ้ำรอบสองไม่ได้
    const joined = await service.acceptInvitation("u_charlie", token);
    expect(joined.orgId).toBe(organization.id);
    await expect(service.acceptInvitation("u_charlie", token)).rejects.toMatchObject({
      status: 400,
    });

    // Charlie เป็น MEMBER เห็นเฉพาะ defaultWorkspace ที่ตนสังกัด มองไม่เห็น secretWs
    const charlieWorkspaces = await service.listWorkspaces("u_charlie", organization.id);
    expect(charlieWorkspaces.map((w) => w.id)).toEqual([defaultWorkspace.id]);
    await expect(service.getWorkspace("u_charlie", secretWs.id)).rejects.toMatchObject({
      status: 404,
    });

    // Charlie (MEMBER) ไม่มีสิทธิ์เชิญคน สร้าง Workspace หรือลบองค์กร (403 FORBIDDEN)
    await expect(
      service.createWorkspace("u_charlie", organization.id, { name: "Ops", slug: "ops" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.createInvitation("u_charlie", organization.id, {
        email: "new@alpha.io",
        role: "MEMBER",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.deleteOrganization("u_charlie", organization.id)).rejects.toMatchObject({
      status: 403,
    });

    // ทดสอบการยกเลิกคำเชิญ (Revoke)
    const inv2 = await service.createInvitation("u_alice", organization.id, {
      email: "eve@intruder.io",
      role: "MEMBER",
    });
    const token2 = mail.extractInviteToken();
    await service.revokeInvitation("u_alice", organization.id, inv2.id);
    await expect(service.acceptInvitation("u_eve", token2)).rejects.toMatchObject({ status: 400 });
  });

  it("protects the last ORG_OWNER and restricts ORG_ADMIN from modifying Owners", async () => {
    const { organization } = await service.createOrganization("u_alice", {
      name: "Alpha Corp",
      slug: "alpha-corp",
    });

    // Owner คนเดียวห้ามลดขั้นหรือลบตัวเอง
    await expect(
      service.updateMemberRole("u_alice", organization.id, "u_alice", "ORG_ADMIN"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.removeMember("u_alice", organization.id, "u_alice"),
    ).rejects.toMatchObject({ status: 409 });

    // เชิญ Charlie เป็น ORG_ADMIN
    await service.createInvitation("u_alice", organization.id, {
      email: "charlie@alpha.io",
      role: "ORG_ADMIN",
    });
    await service.acceptInvitation("u_charlie", mail.extractInviteToken());

    // ORG_ADMIN ห้ามแตะ ORG_OWNER และห้ามลบองค์กร
    await expect(
      service.updateMemberRole("u_charlie", organization.id, "u_alice", "MEMBER"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.removeMember("u_charlie", organization.id, "u_alice"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.deleteOrganization("u_charlie", organization.id)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("restricts platform tenant suspension strictly to SYSTEM_ADMIN", async () => {
    const { organization } = await service.createOrganization("u_alice", {
      name: "Alpha Corp",
      slug: "alpha-corp",
    });

    await expect(
      service.adminSetOrganizationSuspended(
        { userId: "u_alice", sessionId: "s1", systemRole: "USER" },
        organization.id,
        true,
      ),
    ).rejects.toMatchObject({ status: 403 });

    await service.adminSetOrganizationSuspended(
      { userId: "u_sys", sessionId: "s2", systemRole: "SYSTEM_ADMIN" },
      organization.id,
      true,
    );

    // เมื่อองค์กรถูกระงับ สมาชิกจะเข้าใช้งานไม่ได้ชั่วคราว
    await expect(service.getOrganization("u_alice", organization.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});
