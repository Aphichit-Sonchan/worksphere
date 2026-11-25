import type { SystemRole } from "@/generated/prisma/enums";
import { forbidden, unauthenticated } from "@/server/http/errors";
import { systemRoleHas, type PlatformPermission } from "@/server/permissions/roles";
import { prismaAuthRepository, type AuthRepository } from "./auth.repository";
import { extractAccessToken } from "./cookies";
import { verifyAccessToken } from "./crypto";

export interface AuthActor {
  userId: string;
  sessionId: string;
  systemRole: SystemRole;
}

export async function authenticateRequest(
  request: Request,
  repo: AuthRepository = prismaAuthRepository,
): Promise<AuthActor> {
  const token = extractAccessToken(request);
  if (!token) {
    throw unauthenticated("Authentication required");
  }

  const verified = verifyAccessToken(token);
  if (!verified.ok) {
    throw unauthenticated(
      verified.reason === "expired" ? "Access token expired" : "Invalid access token",
    );
  }

  // ตรวจซ้ำว่าเซสชันยังไม่ถูกเพิกถอน (เช่น กด logout all devices หรือเปลี่ยนรหัสผ่าน)
  const activeSession = await repo.findActiveSessionById(verified.payload.sid);
  if (!activeSession || activeSession.userId !== verified.payload.sub) {
    throw unauthenticated("Session is no longer active");
  }

  const user = await repo.findUserById(verified.payload.sub);
  if (!user || user.disabledAt) {
    throw unauthenticated("User account is disabled");
  }

  return {
    userId: user.id,
    sessionId: activeSession.id,
    systemRole: user.systemRole,
  };
}

export function assertSystemPermission(actor: AuthActor, permission: PlatformPermission): void {
  if (!systemRoleHas(actor.systemRole, permission)) {
    throw forbidden("System administrator privilege required");
  }
}
