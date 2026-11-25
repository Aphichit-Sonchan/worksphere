/**
 * RBAC Permission Matrix — ตรงตาม docs/requirements.md §2 (WS-001, WS-103)
 * Pure module (ไม่แตะ DB) สำหรับใช้ใน Domain Services และทดสอบได้ 100%
 */
import type {
  OrgRole,
  ProjectRole,
  SystemRole,
  WorkspaceRole,
} from "@/generated/prisma/enums";

export type { OrgRole, ProjectRole, SystemRole, WorkspaceRole };

export const PLATFORM_PERMISSIONS = ["platform:read", "platform:manage"] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export const ORG_PERMISSIONS = [
  "org:read",
  "org:update",
  "org:delete",
  "org:manage_members",
  "org:read_audit",
  "workspace:create",
  "workspace:manage_all",
] as const;
export type OrgPermission = (typeof ORG_PERMISSIONS)[number];

export const WORKSPACE_PERMISSIONS = [
  "workspace:read",
  "workspace:update",
  "workspace:manage_members",
  "project:create",
] as const;
export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

export const PROJECT_PERMISSION_GRANTS = [
  "project:read",
  "project:update",
  "project:archive",
  "project:manage_members",
  "board:manage_columns",
  "tag:manage",
  "task:create",
  "task:update",
  "task:move",
  "task:delete",
  "task:delete:own",
  "task:manage_dependencies",
  "comment:create",
  "comment:update:own",
  "comment:delete",
  "comment:delete:own",
  "attachment:upload",
  "attachment:delete",
  "attachment:delete:own",
  "analytics:read",
] as const;
export type ProjectPermissionGrant = (typeof PROJECT_PERMISSION_GRANTS)[number];
export type ProjectPermission =
  | Exclude<ProjectPermissionGrant, `${string}:own`>
  | "comment:update";

const ORG_ROLE_GRANTS: Record<OrgRole, readonly OrgPermission[]> = {
  ORG_OWNER: ORG_PERMISSIONS,
  ORG_ADMIN: [
    "org:read",
    "org:update",
    "org:manage_members",
    "org:read_audit",
    "workspace:create",
    "workspace:manage_all",
  ],
  MEMBER: ["org:read"],
};

const WORKSPACE_ROLE_GRANTS: Record<WorkspaceRole, readonly WorkspacePermission[]> = {
  WORKSPACE_ADMIN: WORKSPACE_PERMISSIONS,
  MEMBER: ["workspace:read"],
};

const PROJECT_ROLE_GRANTS: Record<ProjectRole, readonly ProjectPermissionGrant[]> = {
  PROJECT_MANAGER: [
    "project:read",
    "project:update",
    "project:archive",
    "project:manage_members",
    "board:manage_columns",
    "tag:manage",
    "task:create",
    "task:update",
    "task:move",
    "task:delete",
    "task:manage_dependencies",
    "comment:create",
    "comment:update:own",
    "comment:delete",
    "attachment:upload",
    "attachment:delete",
    "analytics:read",
  ],
  MEMBER: [
    "project:read",
    "tag:manage",
    "task:create",
    "task:update",
    "task:move",
    "task:delete:own",
    "task:manage_dependencies",
    "comment:create",
    "comment:update:own",
    "comment:delete:own",
    "attachment:upload",
    "attachment:delete:own",
    "analytics:read",
  ],
  VIEWER: [
    "project:read",
    "comment:create",
    "comment:update:own",
    "comment:delete:own",
    "analytics:read",
  ],
};

export function systemRoleHas(role: SystemRole, permission: PlatformPermission): boolean {
  return role === "SYSTEM_ADMIN" && PLATFORM_PERMISSIONS.includes(permission);
}

export function orgRoleHas(role: OrgRole, permission: OrgPermission): boolean {
  return ORG_ROLE_GRANTS[role].includes(permission);
}

export function effectiveWorkspaceRole(
  orgRole: OrgRole,
  workspaceRole: WorkspaceRole | null,
): WorkspaceRole | null {
  if (orgRole === "ORG_OWNER" || orgRole === "ORG_ADMIN") return "WORKSPACE_ADMIN";
  return workspaceRole;
}

export function workspaceRoleHas(
  role: WorkspaceRole,
  permission: WorkspacePermission,
): boolean {
  return WORKSPACE_ROLE_GRANTS[role].includes(permission);
}

/**
 * ORG_OWNER / ORG_ADMIN มีสิทธิ์ระดับ PROJECT_MANAGER ในทุกโปรเจกต์ขององค์กรตัวเอง
 * ส่วน System Admin ไม่ได้สิทธิ์เข้าดูโปรเจกต์ของลูกค้าโดยอัตโนมัติ (Privacy-by-design)
 */
export function effectiveProjectRole(
  orgRole: OrgRole,
  projectRole: ProjectRole | null,
): ProjectRole | null {
  if (orgRole === "ORG_OWNER" || orgRole === "ORG_ADMIN") return "PROJECT_MANAGER";
  return projectRole;
}

export function projectRoleHas(
  role: ProjectRole,
  permission: ProjectPermission,
  ownership?: { ownerId: string; userId: string },
): boolean {
  const grants = PROJECT_ROLE_GRANTS[role];
  if ((grants as readonly string[]).includes(permission)) return true;
  const ownGrant = `${permission}:own`;
  return (
    (grants as readonly string[]).includes(ownGrant) &&
    ownership !== undefined &&
    ownership.ownerId === ownership.userId
  );
}

export function canManageOrgMember(
  actorRole: OrgRole,
  targetRole: OrgRole,
  newRole?: OrgRole,
): boolean {
  if (actorRole === "ORG_OWNER") return true;
  if (actorRole === "ORG_ADMIN") {
    if (targetRole === "ORG_OWNER") return false;
    if (newRole === "ORG_OWNER") return false;
    return true;
  }
  return false;
}
