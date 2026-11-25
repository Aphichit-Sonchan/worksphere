import type { OrgRole, WorkspaceRole } from "@/generated/prisma/enums";
import { db } from "@/server/db";

export interface OrgRecord {
  id: string;
  name: string;
  slug: string;
  createdById: string;
  suspendedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgMemberDetail {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: OrgRole;
  joinedAt: Date;
}

export interface InvitationRecord {
  id: string;
  orgId: string;
  orgName: string;
  workspaceId: string | null;
  email: string;
  role: OrgRole;
  tokenHash: string;
  invitedById: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface WorkspaceRecord {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description: string | null;
  createdById: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number;
  projectCount: number;
}

export interface WorkspaceMemberDetail {
  userId: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  joinedAt: Date;
}

export interface AdminOrgSummary {
  id: string;
  name: string;
  slug: string;
  suspendedAt: Date | null;
  createdAt: Date;
  memberCount: number;
  workspaceCount: number;
}

export interface TenancyRepository {
  findUserBasicById(userId: string): Promise<{ id: string; email: string; name: string } | null>;
  listOrganizationsForUser(
    userId: string,
  ): Promise<Array<{ org: OrgRecord; role: OrgRole; workspaceCount: number; memberCount: number }>>;
  findOrgBySlug(slug: string): Promise<OrgRecord | null>;
  findOrgById(orgId: string): Promise<OrgRecord | null>;
  findOrgMembership(orgId: string, userId: string): Promise<{ role: OrgRole } | null>;
  countOrgOwners(orgId: string): Promise<number>;
  createOrganizationWithDefaultWorkspace(params: {
    name: string;
    slug: string;
    creatorId: string;
  }): Promise<{ org: OrgRecord; defaultWorkspace: WorkspaceRecord }>;
  updateOrganization(orgId: string, data: { name: string }): Promise<OrgRecord>;
  softDeleteOrganization(orgId: string, actorId: string): Promise<void>;

  listOrgMembers(orgId: string): Promise<OrgMemberDetail[]>;
  updateOrgMemberRole(orgId: string, userId: string, role: OrgRole, actorId: string): Promise<void>;
  removeOrgMember(orgId: string, userId: string, actorId: string): Promise<void>;

  listPendingInvitations(orgId: string): Promise<InvitationRecord[]>;
  createInvitation(params: {
    orgId: string;
    workspaceId?: string;
    email: string;
    role: OrgRole;
    tokenHash: string;
    invitedById: string;
    expiresAt: Date;
  }): Promise<InvitationRecord>;
  findInvitationById(invitationId: string): Promise<InvitationRecord | null>;
  findInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | null>;
  revokeInvitation(invitationId: string): Promise<void>;
  acceptInvitation(params: {
    invitationId: string;
    orgId: string;
    workspaceId: string | null;
    userId: string;
    role: OrgRole;
    now: Date;
  }): Promise<boolean>;

  listWorkspaces(orgId: string, filterForUserId?: string): Promise<WorkspaceRecord[]>;
  findWorkspaceBySlug(orgId: string, slug: string): Promise<WorkspaceRecord | null>;
  findWorkspaceById(workspaceId: string): Promise<WorkspaceRecord | null>;
  findWorkspaceMembership(
    workspaceId: string,
    userId: string,
  ): Promise<{ role: WorkspaceRole } | null>;
  createWorkspace(params: {
    orgId: string;
    name: string;
    slug: string;
    description?: string;
    creatorId: string;
  }): Promise<WorkspaceRecord>;
  updateWorkspace(
    workspaceId: string,
    data: { name?: string; description?: string | null; archivedAt?: Date | null },
  ): Promise<WorkspaceRecord>;
  listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberDetail[]>;
  upsertWorkspaceMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<void>;
  removeWorkspaceMember(workspaceId: string, userId: string): Promise<void>;

  listAllOrganizationsForAdmin(): Promise<AdminOrgSummary[]>;
  setOrganizationSuspended(orgId: string, suspendedAt: Date | null): Promise<OrgRecord>;
}

function mapWorkspace(w: {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description: string | null;
  createdById: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { members: number; projects: number };
}): WorkspaceRecord {
  return {
    id: w.id,
    orgId: w.orgId,
    name: w.name,
    slug: w.slug,
    description: w.description,
    createdById: w.createdById,
    archivedAt: w.archivedAt,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    memberCount: w._count.members,
    projectCount: w._count.projects,
  };
}

export class PrismaTenancyRepository implements TenancyRepository {
  async findUserBasicById(userId: string) {
    return db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
  }

  async listOrganizationsForUser(userId: string) {
    const rows = await db.organizationMember.findMany({
      where: {
        userId,
        org: { deletedAt: null, suspendedAt: null },
      },
      include: {
        org: {
          include: {
            _count: { select: { workspaces: true, members: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((r) => ({
      org: {
        id: r.org.id,
        name: r.org.name,
        slug: r.org.slug,
        createdById: r.org.createdById,
        suspendedAt: r.org.suspendedAt,
        deletedAt: r.org.deletedAt,
        createdAt: r.org.createdAt,
        updatedAt: r.org.updatedAt,
      },
      role: r.role,
      workspaceCount: r.org._count.workspaces,
      memberCount: r.org._count.members,
    }));
  }

  async findOrgBySlug(slug: string) {
    return db.organization.findUnique({ where: { slug } });
  }

  async findOrgById(orgId: string) {
    return db.organization.findUnique({ where: { id: orgId } });
  }

  async findOrgMembership(orgId: string, userId: string) {
    return db.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: { role: true },
    });
  }

  async countOrgOwners(orgId: string) {
    return db.organizationMember.count({
      where: { orgId, role: "ORG_OWNER" },
    });
  }

  async createOrganizationWithDefaultWorkspace(params: {
    name: string;
    slug: string;
    creatorId: string;
  }) {
    return db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: params.name,
          slug: params.slug,
          createdById: params.creatorId,
        },
      });

      await tx.organizationMember.create({
        data: {
          orgId: org.id,
          userId: params.creatorId,
          role: "ORG_OWNER",
        },
      });

      const ws = await tx.workspace.create({
        data: {
          orgId: org.id,
          name: "General",
          slug: "general",
          description: "Default organization workspace",
          createdById: params.creatorId,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: ws.id,
          userId: params.creatorId,
          role: "WORKSPACE_ADMIN",
        },
      });

      await tx.activityLog.create({
        data: {
          orgId: org.id,
          workspaceId: ws.id,
          actorId: params.creatorId,
          action: "organization.created",
          metadata: { name: org.name, slug: org.slug },
        },
      });

      return {
        org,
        defaultWorkspace: {
          ...ws,
          memberCount: 1,
          projectCount: 0,
        },
      };
    });
  }

  async updateOrganization(orgId: string, data: { name: string }) {
    return db.organization.update({
      where: { id: orgId },
      data: { name: data.name },
    });
  }

  async softDeleteOrganization(orgId: string, actorId: string) {
    await db.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: orgId },
        data: { deletedAt: new Date() },
      });
      await tx.activityLog.create({
        data: {
          orgId,
          actorId,
          action: "organization.deleted",
        },
      });
    });
  }

  async listOrgMembers(orgId: string): Promise<OrgMemberDetail[]> {
    const rows = await db.organizationMember.findMany({
      where: { orgId },
      include: {
        user: { select: { id: true, email: true, name: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((r) => ({
      userId: r.user.id,
      email: r.user.email,
      name: r.user.name,
      avatarUrl: r.user.avatarUrl,
      role: r.role,
      joinedAt: r.createdAt,
    }));
  }

  async updateOrgMemberRole(orgId: string, userId: string, role: OrgRole, actorId: string) {
    await db.$transaction(async (tx) => {
      await tx.organizationMember.update({
        where: { orgId_userId: { orgId, userId } },
        data: { role },
      });
      await tx.activityLog.create({
        data: {
          orgId,
          actorId,
          action: "member.role_updated",
          metadata: { targetUserId: userId, newRole: role },
        },
      });
    });
  }

  async removeOrgMember(orgId: string, userId: string, actorId: string) {
    await db.$transaction(async (tx) => {
      await tx.projectMember.deleteMany({
        where: { userId, project: { orgId } },
      });
      await tx.workspaceMember.deleteMany({
        where: { userId, workspace: { orgId } },
      });
      await tx.organizationMember.delete({
        where: { orgId_userId: { orgId, userId } },
      });
      await tx.activityLog.create({
        data: {
          orgId,
          actorId,
          action: "member.removed",
          metadata: { targetUserId: userId },
        },
      });
    });
  }

  async listPendingInvitations(orgId: string): Promise<InvitationRecord[]> {
    const rows = await db.invitation.findMany({
      where: {
        orgId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { org: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((r) => ({ ...r, orgName: r.org.name }));
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
    const created = await db.invitation.create({
      data: {
        orgId: params.orgId,
        workspaceId: params.workspaceId ?? null,
        email: params.email,
        role: params.role,
        tokenHash: params.tokenHash,
        invitedById: params.invitedById,
        expiresAt: params.expiresAt,
      },
      include: { org: { select: { name: true } } },
    });
    return { ...created, orgName: created.org.name };
  }

  async findInvitationById(invitationId: string): Promise<InvitationRecord | null> {
    const row = await db.invitation.findUnique({
      where: { id: invitationId },
      include: { org: { select: { name: true } } },
    });
    return row ? { ...row, orgName: row.org.name } : null;
  }

  async findInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    const row = await db.invitation.findUnique({
      where: { tokenHash },
      include: { org: { select: { name: true } } },
    });
    return row ? { ...row, orgName: row.org.name } : null;
  }

  async revokeInvitation(invitationId: string) {
    await db.invitation.update({
      where: { id: invitationId },
      data: { revokedAt: new Date() },
    });
  }

  async acceptInvitation(params: {
    invitationId: string;
    orgId: string;
    workspaceId: string | null;
    userId: string;
    role: OrgRole;
    now: Date;
  }): Promise<boolean> {
    return db.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: {
          id: params.invitationId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: params.now },
        },
        data: { acceptedAt: params.now },
      });
      if (claimed.count === 0) return false;

      await tx.organizationMember.upsert({
        where: { orgId_userId: { orgId: params.orgId, userId: params.userId } },
        create: {
          orgId: params.orgId,
          userId: params.userId,
          role: params.role,
        },
        update: {}, // หากเป็นสมาชิกอยู่แล้ว ไม่ลดสิทธิ์เดิม
      });

      if (params.workspaceId) {
        await tx.workspaceMember.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: params.workspaceId,
              userId: params.userId,
            },
          },
          create: {
            workspaceId: params.workspaceId,
            userId: params.userId,
            role: "MEMBER",
          },
          update: {},
        });
      }

      await tx.activityLog.create({
        data: {
          orgId: params.orgId,
          workspaceId: params.workspaceId,
          actorId: params.userId,
          action: "member.invitation_accepted",
        },
      });

      return true;
    });
  }

  async listWorkspaces(orgId: string, filterForUserId?: string): Promise<WorkspaceRecord[]> {
    const rows = await db.workspace.findMany({
      where: {
        orgId,
        ...(filterForUserId
          ? { members: { some: { userId: filterForUserId } } }
          : {}),
      },
      include: {
        _count: { select: { members: true, projects: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(mapWorkspace);
  }

  async findWorkspaceBySlug(orgId: string, slug: string): Promise<WorkspaceRecord | null> {
    const row = await db.workspace.findUnique({
      where: { orgId_slug: { orgId, slug } },
      include: { _count: { select: { members: true, projects: true } } },
    });
    return row ? mapWorkspace(row) : null;
  }

  async findWorkspaceById(workspaceId: string): Promise<WorkspaceRecord | null> {
    const row = await db.workspace.findUnique({
      where: { id: workspaceId },
      include: { _count: { select: { members: true, projects: true } } },
    });
    return row ? mapWorkspace(row) : null;
  }

  async findWorkspaceMembership(workspaceId: string, userId: string) {
    return db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
  }

  async createWorkspace(params: {
    orgId: string;
    name: string;
    slug: string;
    description?: string;
    creatorId: string;
  }): Promise<WorkspaceRecord> {
    return db.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          orgId: params.orgId,
          name: params.name,
          slug: params.slug,
          description: params.description ?? null,
          createdById: params.creatorId,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: ws.id,
          userId: params.creatorId,
          role: "WORKSPACE_ADMIN",
        },
      });

      await tx.activityLog.create({
        data: {
          orgId: params.orgId,
          workspaceId: ws.id,
          actorId: params.creatorId,
          action: "workspace.created",
          metadata: { name: ws.name, slug: ws.slug },
        },
      });

      return {
        ...ws,
        memberCount: 1,
        projectCount: 0,
      };
    });
  }

  async updateWorkspace(
    workspaceId: string,
    data: { name?: string; description?: string | null; archivedAt?: Date | null },
  ): Promise<WorkspaceRecord> {
    const ws = await db.workspace.update({
      where: { id: workspaceId },
      data,
      include: { _count: { select: { members: true, projects: true } } },
    });
    return mapWorkspace(ws);
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberDetail[]> {
    const rows = await db.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
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

  async upsertWorkspaceMember(workspaceId: string, userId: string, role: WorkspaceRole) {
    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: { workspaceId, userId, role },
      update: { role },
    });
  }

  async removeWorkspaceMember(workspaceId: string, userId: string) {
    await db.workspaceMember.deleteMany({
      where: { workspaceId, userId },
    });
  }

  async listAllOrganizationsForAdmin(): Promise<AdminOrgSummary[]> {
    const rows = await db.organization.findMany({
      where: { deletedAt: null },
      include: {
        _count: { select: { members: true, workspaces: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      suspendedAt: r.suspendedAt,
      createdAt: r.createdAt,
      memberCount: r._count.members,
      workspaceCount: r._count.workspaces,
    }));
  }

  async setOrganizationSuspended(orgId: string, suspendedAt: Date | null) {
    return db.organization.update({
      where: { id: orgId },
      data: { suspendedAt },
    });
  }
}

export const prismaTenancyRepository = new PrismaTenancyRepository();
