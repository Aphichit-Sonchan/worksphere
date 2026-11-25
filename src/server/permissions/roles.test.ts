import { describe, expect, it } from "vitest";
import {
  canManageOrgMember,
  effectiveProjectRole,
  effectiveWorkspaceRole,
  orgRoleHas,
  projectRoleHas,
  systemRoleHas,
  workspaceRoleHas,
} from "./roles";

describe("platform permissions", () => {
  it("grants platform management only to SYSTEM_ADMIN", () => {
    expect(systemRoleHas("SYSTEM_ADMIN", "platform:manage")).toBe(true);
    expect(systemRoleHas("USER", "platform:manage")).toBe(false);
  });
});

describe("organization & workspace permissions", () => {
  it("allows only ORG_OWNER to delete organization", () => {
    expect(orgRoleHas("ORG_OWNER", "org:delete")).toBe(true);
    expect(orgRoleHas("ORG_ADMIN", "org:delete")).toBe(false);
    expect(orgRoleHas("MEMBER", "org:delete")).toBe(false);
  });

  it("elevates ORG_OWNER and ORG_ADMIN to WORKSPACE_ADMIN", () => {
    expect(effectiveWorkspaceRole("ORG_OWNER", null)).toBe("WORKSPACE_ADMIN");
    expect(effectiveWorkspaceRole("ORG_ADMIN", "MEMBER")).toBe("WORKSPACE_ADMIN");
    expect(effectiveWorkspaceRole("MEMBER", null)).toBeNull();
    expect(workspaceRoleHas("WORKSPACE_ADMIN", "project:create")).toBe(true);
    expect(workspaceRoleHas("MEMBER", "project:create")).toBe(false);
  });

  it("prevents ORG_ADMIN from modifying or promoting ORG_OWNER", () => {
    expect(canManageOrgMember("ORG_ADMIN", "ORG_OWNER")).toBe(false);
    expect(canManageOrgMember("ORG_ADMIN", "MEMBER", "ORG_OWNER")).toBe(false);
    expect(canManageOrgMember("ORG_ADMIN", "MEMBER", "ORG_ADMIN")).toBe(true);
    expect(canManageOrgMember("ORG_OWNER", "ORG_OWNER", "ORG_ADMIN")).toBe(true);
  });
});

describe("project & task permissions", () => {
  const own = { ownerId: "u1", userId: "u1" };
  const other = { ownerId: "u2", userId: "u1" };

  it("elevates ORG_OWNER to PROJECT_MANAGER while requiring explicit membership for MEMBER", () => {
    expect(effectiveProjectRole("ORG_OWNER", null)).toBe("PROJECT_MANAGER");
    expect(effectiveProjectRole("MEMBER", null)).toBeNull();
    expect(effectiveProjectRole("MEMBER", "MEMBER")).toBe("MEMBER");
  });

  it("enforces task deletion ownership for MEMBER vs PROJECT_MANAGER", () => {
    expect(projectRoleHas("PROJECT_MANAGER", "task:delete", other)).toBe(true);
    expect(projectRoleHas("MEMBER", "task:delete", own)).toBe(true);
    expect(projectRoleHas("MEMBER", "task:delete", other)).toBe(false);
  });

  it("allows comment editing only by the comment author", () => {
    expect(projectRoleHas("PROJECT_MANAGER", "comment:update", other)).toBe(false);
    expect(projectRoleHas("PROJECT_MANAGER", "comment:delete", other)).toBe(true);
    expect(projectRoleHas("VIEWER", "comment:update", own)).toBe(true);
    expect(projectRoleHas("VIEWER", "task:move")).toBe(false);
  });
});
