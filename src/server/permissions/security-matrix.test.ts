import { describe, expect, it } from "vitest";
import type { AuthRepository, AuthUserRecord } from "@/server/modules/auth/auth.repository";
import { buildAuthSetCookies, buildClearAuthCookies } from "@/server/modules/auth/cookies";
import { signAccessToken, verifyAccessToken } from "@/server/modules/auth/crypto";
import { assertSystemPermission, authenticateRequest } from "@/server/modules/auth/guard";
import {
  canManageOrgMember,
  effectiveProjectRole,
  effectiveWorkspaceRole,
  orgRoleHas,
  projectRoleHas,
  systemRoleHas,
  workspaceRoleHas,
} from "./roles";

function buildFakeAuthRepo(opts: {
  user: AuthUserRecord | null;
  activeSession: { id: string; userId: string } | null;
}): AuthRepository {
  return {
    findUserByEmail: async () => opts.user,
    findUserById: async () => opts.user,
    listUserOrganizations: async () => [],
    createUserWithSessionAndVerifyToken: async () => {
      throw new Error("unused");
    },
    createSession: async () => {
      throw new Error("unused");
    },
    findSessionByRefreshHash: async () => null,
    findActiveSessionById: async () => opts.activeSession,
    rotateSession: async () => null,
    revokeSessionFamily: async () => {},
    revokeSessionById: async () => {},
    revokeSessionByRefreshHash: async () => {},
    revokeAllUserSessions: async () => {},
    consumeEmailVerificationToken: async () => false,
    createPasswordResetToken: async () => {},
    consumePasswordResetAndUpdatePassword: async () => false,
  };
}

describe("4-Tier RBAC Permission Matrix & Token Abuse Security Suite (WS-704)", () => {
  it("enforces complete 4-tier RBAC boundaries across System, Org, Workspace, and Project roles", () => {
    // 1. System Tier
    expect(systemRoleHas("SYSTEM_ADMIN", "platform:manage")).toBe(true);
    expect(systemRoleHas("USER", "platform:manage")).toBe(false);

    // 2. Organization Tier (ORG_OWNER vs ORG_ADMIN vs MEMBER)
    expect(orgRoleHas("ORG_OWNER", "org:delete")).toBe(true);
    expect(orgRoleHas("ORG_OWNER", "org:read_audit")).toBe(true);

    expect(orgRoleHas("ORG_ADMIN", "org:manage_members")).toBe(true);
    expect(orgRoleHas("ORG_ADMIN", "workspace:create")).toBe(true);
    expect(orgRoleHas("ORG_ADMIN", "org:delete")).toBe(false); // Owner only!

    expect(orgRoleHas("MEMBER", "org:read")).toBe(true);
    expect(orgRoleHas("MEMBER", "org:manage_members")).toBe(false);
    expect(orgRoleHas("MEMBER", "workspace:create")).toBe(false);

    // Privilege Escalation Prevention: ORG_ADMIN cannot demote/remove ORG_OWNER or promote anyone to ORG_OWNER
    expect(canManageOrgMember("ORG_ADMIN", "ORG_OWNER", "MEMBER")).toBe(false);
    expect(canManageOrgMember("ORG_ADMIN", "MEMBER", "ORG_OWNER")).toBe(false);
    expect(canManageOrgMember("ORG_ADMIN", "MEMBER", "ORG_ADMIN")).toBe(true);
    expect(canManageOrgMember("ORG_OWNER", "ORG_ADMIN", "ORG_OWNER")).toBe(true);

    // 3. Workspace Tier & Inheritance
    expect(effectiveWorkspaceRole("ORG_OWNER", null)).toBe("WORKSPACE_ADMIN");
    expect(effectiveWorkspaceRole("ORG_ADMIN", null)).toBe("WORKSPACE_ADMIN");
    expect(effectiveWorkspaceRole("MEMBER", null)).toBeNull();
    expect(workspaceRoleHas("WORKSPACE_ADMIN", "project:create")).toBe(true);
    expect(workspaceRoleHas("MEMBER", "project:create")).toBe(false);

    // 4. Project Tier (PROJECT_MANAGER vs MEMBER vs VIEWER) + Ownership Checks
    expect(effectiveProjectRole("ORG_OWNER", null)).toBe("PROJECT_MANAGER");
    expect(effectiveProjectRole("MEMBER", null)).toBeNull();

    // VIEWER can read boards/analytics & leave own comments, but cannot mutate tasks/columns/files
    expect(projectRoleHas("VIEWER", "project:read")).toBe(true);
    expect(projectRoleHas("VIEWER", "analytics:read")).toBe(true);
    expect(projectRoleHas("VIEWER", "comment:create")).toBe(true);
    expect(
      projectRoleHas("VIEWER", "comment:delete", { ownerId: "u_v", userId: "u_other" }),
    ).toBe(false);
    expect(projectRoleHas("VIEWER", "task:create")).toBe(false);
    expect(projectRoleHas("VIEWER", "task:update")).toBe(false);
    expect(projectRoleHas("VIEWER", "task:move")).toBe(false);
    expect(projectRoleHas("VIEWER", "attachment:upload")).toBe(false);

    // MEMBER can collaborate & manage OWN items, but cannot delete others' tasks/comments or manage columns
    expect(projectRoleHas("MEMBER", "task:create")).toBe(true);
    expect(projectRoleHas("MEMBER", "task:move")).toBe(true);
    expect(projectRoleHas("MEMBER", "board:manage_columns")).toBe(false);
    expect(projectRoleHas("MEMBER", "project:archive")).toBe(false);
    expect(
      projectRoleHas("MEMBER", "task:delete", { ownerId: "u_alice", userId: "u_alice" }),
    ).toBe(true);
    expect(
      projectRoleHas("MEMBER", "task:delete", { ownerId: "u_alice", userId: "u_bob" }),
    ).toBe(false);
    expect(
      projectRoleHas("PROJECT_MANAGER", "task:delete", { ownerId: "u_alice", userId: "u_pm" }),
    ).toBe(true);
  });

  it("rejects forged, expired, revoked-session, and disabled-user tokens at the HTTP guard", async () => {
    const activeUser: AuthUserRecord = {
      id: "usr_sec",
      email: "sec@ws.io",
      name: "Sec User",
      passwordHash: "hash",
      avatarUrl: null,
      systemRole: "USER",
      locale: "th",
      emailVerifiedAt: new Date(),
      disabledAt: null,
      createdAt: new Date(),
    };

    const repo = buildFakeAuthRepo({
      user: activeUser,
      activeSession: { id: "ses_ok", userId: "usr_sec" },
    });

    // 1. Missing token -> 401
    await expect(
      authenticateRequest(new Request("http://localhost:3000/api/v1/auth/me"), repo),
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });

    // 2. Tampered HMAC payload or signature -> rejected
    const validToken = signAccessToken(
      { userId: "usr_sec", sessionId: "ses_ok", systemRole: "USER" },
      { ttlSeconds: 300 },
    );
    const [headerPart, payloadPart, sigPart] = validToken.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        sub: "usr_sec",
        sid: "ses_ok",
        sys: "SYSTEM_ADMIN",
        iat: 1700000000,
        exp: 9999999999,
      }),
    ).toString("base64url");
    expect(verifyAccessToken(`${headerPart}.${tamperedPayload}.${sigPart}`).ok).toBe(false);
    expect(verifyAccessToken(`${headerPart}.${payloadPart}.forgedSignature`).ok).toBe(false);

    // 3. Expired token -> 401
    const expiredToken = signAccessToken(
      { userId: "usr_sec", sessionId: "ses_ok", systemRole: "USER" },
      { ttlSeconds: -10 },
    );
    await expect(
      authenticateRequest(
        new Request("http://localhost:3000/api/v1/auth/me", {
          headers: { Authorization: `Bearer ${expiredToken}` },
        }),
        repo,
      ),
    ).rejects.toMatchObject({ status: 401, message: "Access token expired" });

    // 4. Valid HttpOnly cookie authenticates cleanly, while non-admin fails assertSystemPermission
    const cookies = buildAuthSetCookies({ accessToken: validToken, refreshToken: "raw_ref" });
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("SameSite=Lax");
    expect(buildClearAuthCookies()[0]).toContain("Max-Age=0");

    const cookieHeader = cookies.map((c: string) => c.split(";")[0]).join("; ");
    const actor = await authenticateRequest(
      new Request("http://localhost:3000/api/v1/auth/me", {
        headers: { Cookie: cookieHeader },
      }),
      repo,
    );
    expect(actor.userId).toBe("usr_sec");
    expect(() => assertSystemPermission(actor, "platform:read")).toThrow(/privilege/i);

    // 5. Revoked session (e.g. after Logout All Devices) -> 401 even if token exp is still valid
    const revokedRepo = buildFakeAuthRepo({
      user: activeUser,
      activeSession: null,
    });
    await expect(
      authenticateRequest(
        new Request("http://localhost:3000/api/v1/auth/me", {
          headers: { Cookie: cookieHeader },
        }),
        revokedRepo,
      ),
    ).rejects.toMatchObject({ status: 401, message: "Session is no longer active" });

    // 6. Disabled user -> 401
    const disabledRepo = buildFakeAuthRepo({
      user: { ...activeUser, disabledAt: new Date() },
      activeSession: { id: "ses_ok", userId: "usr_sec" },
    });
    await expect(
      authenticateRequest(
        new Request("http://localhost:3000/api/v1/auth/me", {
          headers: { Cookie: cookieHeader },
        }),
        disabledRepo,
      ),
    ).rejects.toMatchObject({ status: 401, message: "User account is disabled" });
  });
});
