import type {
  AddWorkspaceMemberInput,
  CreateInvitationInput,
  CreateOrganizationInput,
  CreateWorkspaceInput,
  UpdateOrganizationInput,
  UpdateWorkspaceInput,
} from "@/lib/validation/tenancy";
import { getEnv } from "@/server/env";
import { badRequest, conflict, forbidden, notFound } from "@/server/http/errors";
import {
  CACHE_TTL,
  cache,
  CacheKeys,
  MemoryCacheAdapter,
  rememberCached,
  type CacheAdapter,
} from "@/server/infra/cache";
import { mailer, type MailAdapter } from "@/server/infra/mailer";
import { generateOpaqueToken, sha256Hex } from "@/server/modules/auth/crypto";
import { assertSystemPermission, type AuthActor } from "@/server/modules/auth/guard";
import {
  canManageOrgMember,
  effectiveWorkspaceRole,
  orgRoleHas,
  workspaceRoleHas,
  type OrgPermission,
  type OrgRole,
  type WorkspacePermission,
  type WorkspaceRole,
} from "@/server/permissions/roles";
import {
  prismaTenancyRepository,
  type OrgRecord,
  type TenancyRepository,
  type WorkspaceRecord,
} from "./tenancy.repository";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 วัน

export interface OrgContext {
  org: OrgRecord;
  actorId: string;
  orgRole: OrgRole;
}

export interface WorkspaceContext extends OrgContext {
  workspace: WorkspaceRecord;
  workspaceRole: WorkspaceRole;
}

export interface InviteNotifier {
  notifyInvitedEmailIfRegistered(params: {
    orgId: string;
    orgName: string;
    email: string;
    invitePath: string;
  }): Promise<void>;
}

export class TenancyService {
  private readonly cacheStore: CacheAdapter;

  constructor(
    private readonly repo: TenancyRepository = prismaTenancyRepository,
    private readonly mail: MailAdapter = mailer,
    private readonly inviteNotifier?: InviteNotifier | null,
    cacheStore?: CacheAdapter,
  ) {
    this.cacheStore =
      cacheStore ?? (repo === prismaTenancyRepository ? cache : new MemoryCacheAdapter());
  }

  /**
   * หัวใจของ Multi-tenant Isolation:
   * - หากองค์กรไม่มีอยู่ ถูกระงับ ถูกลบ หรือผู้เรียกไม่ได้เป็นสมาชิก -> ตอบ 404 NOT_FOUND เสมอ
   * - หากเป็นสมาชิกแต่สิทธิ์ไม่ถึง -> ตอบ 403 FORBIDDEN
   */
  async resolveOrgContext(
    actorId: string,
    orgId: string,
    requiredPermission: OrgPermission = "org:read",
  ): Promise<OrgContext> {
    const org = await this.repo.findOrgById(orgId);
    if (!org || org.deletedAt || org.suspendedAt) {
      throw notFound("Organization not found");
    }

    const membership = await this.repo.findOrgMembership(orgId, actorId);
    if (!membership) {
      throw notFound("Organization not found");
    }

    if (!orgRoleHas(membership.role, requiredPermission)) {
      throw forbidden("Insufficient organization permissions");
    }

    return { org, actorId, orgRole: membership.role };
  }

  async resolveWorkspaceContext(
    actorId: string,
    workspaceId: string,
    requiredPermission: WorkspacePermission = "workspace:read",
  ): Promise<WorkspaceContext> {
    const workspace = await this.repo.findWorkspaceById(workspaceId);
    if (!workspace) {
      throw notFound("Workspace not found");
    }

    // ตรวจการเป็นสมาชิกในองค์กรเจ้าของ Workspace ก่อนเสมอ (กั้นข้าม Tenant)
    const orgCtx = await this.resolveOrgContext(actorId, workspace.orgId, "org:read");
    const explicitWs = await this.repo.findWorkspaceMembership(workspaceId, actorId);
    const wsRole = effectiveWorkspaceRole(orgCtx.orgRole, explicitWs?.role ?? null);

    if (!wsRole) {
      throw notFound("Workspace not found");
    }

    if (!workspaceRoleHas(wsRole, requiredPermission)) {
      throw forbidden("Insufficient workspace permissions");
    }

    return { ...orgCtx, workspace, workspaceRole: wsRole };
  }

  // ───────────── Organizations (WS-301) ─────────────

  async listMyOrganizations(actorId: string) {
    const rows = await this.repo.listOrganizationsForUser(actorId);
    return rows.map((r) => ({
      id: r.org.id,
      name: r.org.name,
      slug: r.org.slug,
      role: r.role,
      workspaceCount: r.workspaceCount,
      memberCount: r.memberCount,
      createdAt: r.org.createdAt.toISOString(),
    }));
  }

  async createOrganization(actorId: string, input: CreateOrganizationInput) {
    const existing = await this.repo.findOrgBySlug(input.slug);
    if (existing) {
      throw conflict("Organization slug is already taken");
    }

    const { org, defaultWorkspace } = await this.repo.createOrganizationWithDefaultWorkspace({
      name: input.name,
      slug: input.slug,
      creatorId: actorId,
    });

    return {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        role: "ORG_OWNER" as const,
        createdAt: org.createdAt.toISOString(),
      },
      defaultWorkspace,
    };
  }

  async getOrganization(actorId: string, orgId: string) {
    const ctx = await this.resolveOrgContext(actorId, orgId, "org:read");
    return {
      id: ctx.org.id,
      name: ctx.org.name,
      slug: ctx.org.slug,
      myRole: ctx.orgRole,
      createdAt: ctx.org.createdAt.toISOString(),
    };
  }

  async updateOrganization(actorId: string, orgId: string, input: UpdateOrganizationInput) {
    await this.resolveOrgContext(actorId, orgId, "org:update");
    const updated = await this.repo.updateOrganization(orgId, { name: input.name });
    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
    };
  }

  async deleteOrganization(actorId: string, orgId: string) {
    await this.resolveOrgContext(actorId, orgId, "org:delete");
    await this.repo.softDeleteOrganization(orgId, actorId);
    await this.cacheStore.delByPrefix(`org:${orgId}:`);
  }

  // ───────────── Members & Invitations (WS-303) ─────────────

  async listMembers(actorId: string, orgId: string) {
    await this.resolveOrgContext(actorId, orgId, "org:read");
    return rememberCached(
      CacheKeys.orgMembers(orgId),
      CACHE_TTL.ORG_MEMBERS,
      () => this.repo.listOrgMembers(orgId),
      this.cacheStore,
    );
  }

  async updateMemberRole(
    actorId: string,
    orgId: string,
    targetUserId: string,
    newRole: OrgRole,
  ) {
    const ctx = await this.resolveOrgContext(actorId, orgId, "org:manage_members");
    const target = await this.repo.findOrgMembership(orgId, targetUserId);
    if (!target) {
      throw notFound("Member not found in this organization");
    }

    if (!canManageOrgMember(ctx.orgRole, target.role, newRole)) {
      throw forbidden("You cannot modify an Organization Owner or promote to Owner");
    }

    if (target.role === "ORG_OWNER" && newRole !== "ORG_OWNER") {
      const owners = await this.repo.countOrgOwners(orgId);
      if (owners <= 1) {
        throw conflict("Organization must retain at least one Owner");
      }
    }

    await this.repo.updateOrgMemberRole(orgId, targetUserId, newRole, actorId);
    await this.cacheStore.del(CacheKeys.orgMembers(orgId));
  }

  async removeMember(actorId: string, orgId: string, targetUserId: string) {
    const ctx = await this.resolveOrgContext(actorId, orgId, "org:manage_members");
    const target = await this.repo.findOrgMembership(orgId, targetUserId);
    if (!target) {
      throw notFound("Member not found in this organization");
    }

    if (!canManageOrgMember(ctx.orgRole, target.role)) {
      throw forbidden("You cannot remove an Organization Owner");
    }

    if (target.role === "ORG_OWNER") {
      const owners = await this.repo.countOrgOwners(orgId);
      if (owners <= 1) {
        throw conflict("Cannot remove the last Organization Owner");
      }
    }

    await this.repo.removeOrgMember(orgId, targetUserId, actorId);
    await this.cacheStore.del(CacheKeys.orgMembers(orgId));
  }

  async listInvitations(actorId: string, orgId: string) {
    await this.resolveOrgContext(actorId, orgId, "org:manage_members");
    const rows = await this.repo.listPendingInvitations(orgId);
    return rows.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      workspaceId: inv.workspaceId,
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
    }));
  }

  async createInvitation(actorId: string, orgId: string, input: CreateInvitationInput) {
    const ctx = await this.resolveOrgContext(actorId, orgId, "org:manage_members");

    if (input.role === "ORG_OWNER" && ctx.orgRole !== "ORG_OWNER") {
      throw forbidden("Only an Organization Owner can invite another Owner");
    }

    if (input.workspaceId) {
      const ws = await this.repo.findWorkspaceById(input.workspaceId);
      if (!ws || ws.orgId !== orgId) {
        throw badRequest("Target workspace does not belong to this organization");
      }
    }

    const rawToken = generateOpaqueToken(32);
    const inv = await this.repo.createInvitation({
      orgId,
      workspaceId: input.workspaceId,
      email: input.email,
      role: input.role,
      tokenHash: sha256Hex(rawToken),
      invitedById: actorId,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    });

    const invitePath = `/invitations/${encodeURIComponent(rawToken)}`;
    const inviteUrl = `${getEnv().APP_URL}/th${invitePath}`;
    await this.mail.send({
      to: inv.email,
      subject: `You've been invited to join ${ctx.org.name} on WorkSphere`,
      text: `Join ${ctx.org.name} (${inv.role}) on WorkSphere: ${inviteUrl}`,
    });

    if (this.inviteNotifier) {
      await this.inviteNotifier.notifyInvitedEmailIfRegistered({
        orgId,
        orgName: ctx.org.name,
        email: inv.email,
        invitePath,
      });
    } else if (this.inviteNotifier === undefined && this.repo === prismaTenancyRepository) {
      const { notificationService } = await import(
        "@/server/modules/notification/notification.service"
      );
      await notificationService.notifyInvitedEmailIfRegistered({
        orgId,
        orgName: ctx.org.name,
        email: inv.email,
        invitePath,
      });
    }

    return {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      expiresAt: inv.expiresAt.toISOString(),
      // คืนลิงก์คำเชิญให้เจ้าขององค์กรคัดลอกส่งต่อได้สะดวกในโหมดพัฒนา
      inviteUrl,
    };
  }

  async revokeInvitation(actorId: string, orgId: string, invitationId: string) {
    await this.resolveOrgContext(actorId, orgId, "org:manage_members");
    const inv = await this.repo.findInvitationById(invitationId);
    if (!inv || inv.orgId !== orgId || inv.acceptedAt || inv.revokedAt) {
      throw notFound("Pending invitation not found");
    }
    await this.repo.revokeInvitation(invitationId);
  }

  async acceptInvitation(actorId: string, rawToken: string) {
    const user = await this.repo.findUserBasicById(actorId);
    if (!user) throw notFound("User not found");

    const inv = await this.repo.findInvitationByTokenHash(sha256Hex(rawToken));
    if (!inv || inv.revokedAt || inv.acceptedAt) {
      throw badRequest("Invitation is invalid or has already been used");
    }

    const now = new Date();
    if (inv.expiresAt <= now) {
      throw badRequest("Invitation has expired");
    }

    const org = await this.repo.findOrgById(inv.orgId);
    if (!org || org.deletedAt || org.suspendedAt) {
      throw notFound("Organization is no longer available");
    }

    if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
      throw forbidden("This invitation was sent to a different email address");
    }

    const accepted = await this.repo.acceptInvitation({
      invitationId: inv.id,
      orgId: inv.orgId,
      workspaceId: inv.workspaceId,
      userId: actorId,
      role: inv.role,
      now,
    });

    if (!accepted) {
      throw conflict("Invitation could not be accepted");
    }

    await this.cacheStore.del(CacheKeys.orgMembers(inv.orgId));

    return {
      orgId: org.id,
      orgName: org.name,
      orgSlug: org.slug,
      role: inv.role,
    };
  }

  // ───────────── Workspaces (WS-302) ─────────────

  async listWorkspaces(actorId: string, orgId: string) {
    const ctx = await this.resolveOrgContext(actorId, orgId, "org:read");
    const canSeeAll = orgRoleHas(ctx.orgRole, "workspace:manage_all");
    return this.repo.listWorkspaces(orgId, canSeeAll ? undefined : actorId);
  }

  async createWorkspace(actorId: string, orgId: string, input: CreateWorkspaceInput) {
    await this.resolveOrgContext(actorId, orgId, "workspace:create");

    const duplicate = await this.repo.findWorkspaceBySlug(orgId, input.slug);
    if (duplicate) {
      throw conflict("Workspace slug already exists in this organization");
    }

    return this.repo.createWorkspace({
      orgId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      creatorId: actorId,
    });
  }

  async getWorkspace(actorId: string, workspaceId: string) {
    const ctx = await this.resolveWorkspaceContext(actorId, workspaceId, "workspace:read");
    return {
      ...ctx.workspace,
      myWorkspaceRole: ctx.workspaceRole,
    };
  }

  async updateWorkspace(
    actorId: string,
    workspaceId: string,
    input: UpdateWorkspaceInput,
  ) {
    const ctx = await this.resolveWorkspaceContext(actorId, workspaceId, "workspace:update");
    const archivedAt =
      input.archived === undefined
        ? ctx.workspace.archivedAt
        : input.archived
          ? (ctx.workspace.archivedAt ?? new Date())
          : null;

    return this.repo.updateWorkspace(workspaceId, {
      name: input.name,
      description: input.description,
      archivedAt,
    });
  }

  async listWorkspaceMembers(actorId: string, workspaceId: string) {
    await this.resolveWorkspaceContext(actorId, workspaceId, "workspace:read");
    return this.repo.listWorkspaceMembers(workspaceId);
  }

  async addWorkspaceMember(
    actorId: string,
    workspaceId: string,
    input: AddWorkspaceMemberInput,
  ) {
    const ctx = await this.resolveWorkspaceContext(
      actorId,
      workspaceId,
      "workspace:manage_members",
    );

    // บังคับว่าคนที่จะถูกเพิ่มเข้า Workspace ต้องเป็นสมาชิกของ Organization เดียวกันก่อนเสมอ!
    const inOrg = await this.repo.findOrgMembership(ctx.org.id, input.userId);
    if (!inOrg) {
      throw badRequest("User must be a member of the organization first");
    }

    await this.repo.upsertWorkspaceMember(workspaceId, input.userId, input.role);
  }

  async removeWorkspaceMember(actorId: string, workspaceId: string, targetUserId: string) {
    await this.resolveWorkspaceContext(actorId, workspaceId, "workspace:manage_members");
    await this.repo.removeWorkspaceMember(workspaceId, targetUserId);
  }

  // ───────────── System Admin (Platform Level) ─────────────

  async adminListOrganizations(actor: AuthActor) {
    assertSystemPermission(actor, "platform:read");
    return this.repo.listAllOrganizationsForAdmin();
  }

  async adminSetOrganizationSuspended(actor: AuthActor, orgId: string, suspended: boolean) {
    assertSystemPermission(actor, "platform:manage");
    const org = await this.repo.findOrgById(orgId);
    if (!org || org.deletedAt) throw notFound("Organization not found");

    const updated = await this.repo.setOrganizationSuspended(
      orgId,
      suspended ? new Date() : null,
    );
    await cache.delByPrefix(`org:${orgId}:`);
    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      suspended: updated.suspendedAt !== null,
    };
  }
}

export const tenancyService = new TenancyService();
