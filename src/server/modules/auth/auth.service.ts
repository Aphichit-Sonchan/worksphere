import type {
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "@/lib/validation/auth";
import { getEnv } from "@/server/env";
import { badRequest, conflict, unauthenticated } from "@/server/http/errors";
import { logger } from "@/server/infra/logger";
import { mailer, type MailAdapter } from "@/server/infra/mailer";
import {
  prismaAuthRepository,
  type AuthRepository,
  type AuthUserRecord,
  type UserOrgSummary,
} from "./auth.repository";
import {
  EMAIL_VERIFY_TTL_SECONDS,
  generateOpaqueToken,
  hashPassword,
  PASSWORD_RESET_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  sha256Hex,
  signAccessToken,
  verifyDummyPassword,
  verifyPassword,
} from "./crypto";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  systemRole: AuthUserRecord["systemRole"];
  locale: AuthUserRecord["locale"];
  emailVerified: boolean;
  createdAt: string;
}

export interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

export function toPublicUser(u: AuthUserRecord): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    systemRole: u.systemRole,
    locale: u.locale,
    emailVerified: u.emailVerifiedAt !== null,
    createdAt: u.createdAt.toISOString(),
  };
}

export class AuthService {
  constructor(
    private readonly repo: AuthRepository = prismaAuthRepository,
    private readonly mail: MailAdapter = mailer,
  ) {}

  async register(
    input: RegisterInput,
    meta: RequestMetadata = {},
  ): Promise<{ user: PublicUser; accessToken: string; refreshToken: string }> {
    const existing = await this.repo.findUserByEmail(input.email);
    if (existing) {
      throw conflict("An account with this email already exists");
    }

    const passwordHash = await hashPassword(input.password);
    const refreshToken = generateOpaqueToken(32);
    const verifyToken = generateOpaqueToken(32);
    const familyId = generateOpaqueToken(16);
    const now = Date.now();

    const { user, sessionId } = await this.repo.createUserWithSessionAndVerifyToken({
      email: input.email,
      name: input.name,
      passwordHash,
      locale: input.locale ?? "th",
      familyId,
      refreshTokenHash: sha256Hex(refreshToken),
      sessionExpiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      verifyTokenHash: sha256Hex(verifyToken),
      verifyExpiresAt: new Date(now + EMAIL_VERIFY_TTL_SECONDS * 1000),
    });

    const appUrl = getEnv().APP_URL;
    const verifyLink = `${appUrl}/${user.locale}/verify-email?token=${encodeURIComponent(verifyToken)}`;
    await this.mail.send({
      to: user.email,
      subject: "Verify your WorkSphere email",
      text: `Welcome to WorkSphere, ${user.name}! Verify your email here: ${verifyLink}`,
    });

    const accessToken = signAccessToken({
      userId: user.id,
      sessionId,
      systemRole: user.systemRole,
    });

    return { user: toPublicUser(user), accessToken, refreshToken };
  }

  async login(
    input: LoginInput,
    meta: RequestMetadata = {},
  ): Promise<{ user: PublicUser; accessToken: string; refreshToken: string }> {
    const user = await this.repo.findUserByEmail(input.email);
    if (!user || user.disabledAt) {
      await verifyDummyPassword(input.password);
      throw unauthenticated("Invalid email or password");
    }

    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) {
      throw unauthenticated("Invalid email or password");
    }

    const refreshToken = generateOpaqueToken(32);
    const familyId = generateOpaqueToken(16);
    const session = await this.repo.createSession({
      userId: user.id,
      familyId,
      refreshTokenHash: sha256Hex(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const accessToken = signAccessToken({
      userId: user.id,
      sessionId: session.id,
      systemRole: user.systemRole,
    });

    return { user: toPublicUser(user), accessToken, refreshToken };
  }

  /**
   * Refresh Token Rotation พร้อมตรวจจับการนำ Token เก่ากลับมาใช้ซ้ำ (Reuse Detection)
   */
  async refreshSession(
    rawRefreshToken: string | null,
    meta: RequestMetadata = {},
  ): Promise<{ user: PublicUser; accessToken: string; refreshToken: string }> {
    if (!rawRefreshToken) {
      throw unauthenticated("Missing refresh token");
    }

    const tokenHash = sha256Hex(rawRefreshToken);
    const session = await this.repo.findSessionByRefreshHash(tokenHash);
    if (!session) {
      throw unauthenticated("Invalid refresh token");
    }

    // ตรวจจับการนำ Refresh Token ที่ถูกหมุนหรือเพิกถอนแล้วกลับมาใช้ซ้ำ
    if (session.replacedByTokenHash !== null || session.revokedAt !== null) {
      logger.warn("refresh token reuse detected — revoking session family", {
        userId: session.userId,
        familyId: session.familyId,
        sessionId: session.id,
      });
      await this.repo.revokeSessionFamily(session.familyId);
      throw unauthenticated("Session has been revoked due to suspicious token reuse");
    }

    if (session.expiresAt.getTime() <= Date.now() || session.user.disabledAt !== null) {
      await this.repo.revokeSessionById(session.id);
      throw unauthenticated("Refresh token expired");
    }

    const newRefreshToken = generateOpaqueToken(32);
    const newRefreshHash = sha256Hex(newRefreshToken);
    const rotated = await this.repo.rotateSession({
      oldSessionId: session.id,
      userId: session.userId,
      familyId: session.familyId,
      newRefreshTokenHash: newRefreshHash,
      newExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    if (!rotated) {
      await this.repo.revokeSessionFamily(session.familyId);
      throw unauthenticated("Concurrent token rotation rejected");
    }

    const accessToken = signAccessToken({
      userId: session.user.id,
      sessionId: rotated.newSessionId,
      systemRole: session.user.systemRole,
    });

    return {
      user: toPublicUser(session.user),
      accessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(params: {
    userId?: string;
    sessionId?: string;
    refreshToken?: string | null;
    allDevices?: boolean;
  }): Promise<void> {
    if (params.allDevices && params.userId) {
      await this.repo.revokeAllUserSessions(params.userId);
      return;
    }
    if (params.sessionId) {
      await this.repo.revokeSessionById(params.sessionId);
    }
    if (params.refreshToken) {
      await this.repo.revokeSessionByRefreshHash(sha256Hex(params.refreshToken));
    }
  }

  async getMe(userId: string): Promise<{
    user: PublicUser;
    organizations: UserOrgSummary[];
  }> {
    const user = await this.repo.findUserById(userId);
    if (!user || user.disabledAt) {
      throw unauthenticated("Account is not active");
    }
    const organizations = await this.repo.listUserOrganizations(userId);
    return { user: toPublicUser(user), organizations };
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const ok = await this.repo.consumeEmailVerificationToken(sha256Hex(rawToken), new Date());
    if (!ok) {
      throw badRequest("Invalid or expired verification token");
    }
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.repo.findUserByEmail(email);
    if (!user || user.disabledAt) {
      return; // ไม่เปิดเผยว่ามีอีเมลนี้ในระบบหรือไม่
    }

    const rawToken = generateOpaqueToken(32);
    await this.repo.createPasswordResetToken({
      userId: user.id,
      tokenHash: sha256Hex(rawToken),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000),
    });

    const resetLink = `${getEnv().APP_URL}/${user.locale}/reset-password?token=${encodeURIComponent(rawToken)}`;
    await this.mail.send({
      to: user.email,
      subject: "Reset your WorkSphere password",
      text: `Use this single-use link (valid for 1 hour) to reset your password: ${resetLink}`,
    });
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const newPasswordHash = await hashPassword(input.newPassword);
    const updated = await this.repo.consumePasswordResetAndUpdatePassword({
      tokenHash: sha256Hex(input.token),
      newPasswordHash,
      now: new Date(),
    });

    if (!updated) {
      throw badRequest("Invalid or expired password reset token");
    }
  }
}

export const authService = new AuthService();
