import type {
  Locale,
  OrgRole,
  SystemRole,
  VerificationPurpose,
} from "@/generated/prisma/enums";
import { db } from "@/server/db";

export interface AuthUserRecord {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  passwordHash: string;
  systemRole: SystemRole;
  locale: Locale;
  emailVerifiedAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  familyId: string;
  refreshTokenHash: string;
  replacedByTokenHash: string | null;
  revokedAt: Date | null;
  expiresAt: Date;
  user: AuthUserRecord;
}

export interface UserOrgSummary {
  orgId: string;
  name: string;
  slug: string;
  role: OrgRole;
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  findUserById(id: string): Promise<AuthUserRecord | null>;
  listUserOrganizations(userId: string): Promise<UserOrgSummary[]>;
  createUserWithSessionAndVerifyToken(params: {
    email: string;
    name: string;
    passwordHash: string;
    locale: Locale;
    familyId: string;
    refreshTokenHash: string;
    sessionExpiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
    verifyTokenHash: string;
    verifyExpiresAt: Date;
  }): Promise<{ user: AuthUserRecord; sessionId: string }>;
  createSession(params: {
    userId: string;
    familyId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ id: string }>;
  findSessionByRefreshHash(refreshTokenHash: string): Promise<AuthSessionRecord | null>;
  findActiveSessionById(sessionId: string): Promise<{ id: string; userId: string } | null>;
  rotateSession(params: {
    oldSessionId: string;
    userId: string;
    familyId: string;
    newRefreshTokenHash: string;
    newExpiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ newSessionId: string } | null>;
  revokeSessionFamily(familyId: string): Promise<void>;
  revokeSessionById(sessionId: string): Promise<void>;
  revokeSessionByRefreshHash(refreshTokenHash: string): Promise<void>;
  revokeAllUserSessions(userId: string): Promise<void>;
  consumeEmailVerificationToken(tokenHash: string, now: Date): Promise<boolean>;
  createPasswordResetToken(params: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  consumePasswordResetAndUpdatePassword(params: {
    tokenHash: string;
    newPasswordHash: string;
    now: Date;
  }): Promise<boolean>;
}

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  passwordHash: true,
  systemRole: true,
  locale: true,
  emailVerifiedAt: true,
  disabledAt: true,
  createdAt: true,
} as const;

export class PrismaAuthRepository implements AuthRepository {
  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    return db.user.findUnique({ where: { email }, select: USER_SELECT });
  }

  async findUserById(id: string): Promise<AuthUserRecord | null> {
    return db.user.findUnique({ where: { id }, select: USER_SELECT });
  }

  async listUserOrganizations(userId: string): Promise<UserOrgSummary[]> {
    const rows = await db.organizationMember.findMany({
      where: {
        userId,
        org: { deletedAt: null, suspendedAt: null },
      },
      include: {
        org: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((r) => ({
      orgId: r.org.id,
      name: r.org.name,
      slug: r.org.slug,
      role: r.role,
    }));
  }

  async createUserWithSessionAndVerifyToken(params: {
    email: string;
    name: string;
    passwordHash: string;
    locale: Locale;
    familyId: string;
    refreshTokenHash: string;
    sessionExpiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
    verifyTokenHash: string;
    verifyExpiresAt: Date;
  }): Promise<{ user: AuthUserRecord; sessionId: string }> {
    return db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: params.email,
          name: params.name,
          passwordHash: params.passwordHash,
          locale: params.locale,
        },
        select: USER_SELECT,
      });

      const session = await tx.session.create({
        data: {
          userId: user.id,
          familyId: params.familyId,
          refreshTokenHash: params.refreshTokenHash,
          expiresAt: params.sessionExpiresAt,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        },
        select: { id: true },
      });

      await tx.verificationToken.create({
        data: {
          userId: user.id,
          purpose: "EMAIL_VERIFY" satisfies VerificationPurpose,
          tokenHash: params.verifyTokenHash,
          expiresAt: params.verifyExpiresAt,
        },
      });

      return { user, sessionId: session.id };
    });
  }

  async createSession(params: {
    userId: string;
    familyId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ id: string }> {
    return db.session.create({
      data: params,
      select: { id: true },
    });
  }

  async findSessionByRefreshHash(refreshTokenHash: string): Promise<AuthSessionRecord | null> {
    return db.session.findUnique({
      where: { refreshTokenHash },
      include: { user: { select: USER_SELECT } },
    });
  }

  async findActiveSessionById(sessionId: string): Promise<{ id: string; userId: string } | null> {
    return db.session.findFirst({
      where: {
        id: sessionId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, userId: true },
    });
  }

  async rotateSession(params: {
    oldSessionId: string;
    userId: string;
    familyId: string;
    newRefreshTokenHash: string;
    newExpiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ newSessionId: string } | null> {
    return db.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.session.updateMany({
        where: {
          id: params.oldSessionId,
          revokedAt: null,
          replacedByTokenHash: null,
        },
        data: {
          revokedAt: now,
          lastUsedAt: now,
          replacedByTokenHash: params.newRefreshTokenHash,
        },
      });

      if (claimed.count === 0) return null;

      const created = await tx.session.create({
        data: {
          userId: params.userId,
          familyId: params.familyId,
          refreshTokenHash: params.newRefreshTokenHash,
          expiresAt: params.newExpiresAt,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        },
        select: { id: true },
      });

      return { newSessionId: created.id };
    });
  }

  async revokeSessionFamily(familyId: string): Promise<void> {
    await db.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeSessionById(sessionId: string): Promise<void> {
    await db.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeSessionByRefreshHash(refreshTokenHash: string): Promise<void> {
    await db.session.updateMany({
      where: { refreshTokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async consumeEmailVerificationToken(tokenHash: string, now: Date): Promise<boolean> {
    return db.$transaction(async (tx) => {
      const token = await tx.verificationToken.findUnique({
        where: { tokenHash },
      });
      if (!token || token.purpose !== "EMAIL_VERIFY" || token.consumedAt || token.expiresAt <= now) {
        return false;
      }

      const updated = await tx.verificationToken.updateMany({
        where: { id: token.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (updated.count === 0) return false;

      await tx.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: now },
      });
      return true;
    });
  }

  async createPasswordResetToken(params: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await db.$transaction(async (tx) => {
      const now = new Date();
      await tx.verificationToken.updateMany({
        where: { userId: params.userId, purpose: "PASSWORD_RESET", consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.verificationToken.create({
        data: {
          userId: params.userId,
          purpose: "PASSWORD_RESET",
          tokenHash: params.tokenHash,
          expiresAt: params.expiresAt,
        },
      });
    });
  }

  async consumePasswordResetAndUpdatePassword(params: {
    tokenHash: string;
    newPasswordHash: string;
    now: Date;
  }): Promise<boolean> {
    return db.$transaction(async (tx) => {
      const token = await tx.verificationToken.findUnique({
        where: { tokenHash: params.tokenHash },
      });
      if (
        !token ||
        token.purpose !== "PASSWORD_RESET" ||
        token.consumedAt ||
        token.expiresAt <= params.now
      ) {
        return false;
      }

      const consumed = await tx.verificationToken.updateMany({
        where: { id: token.id, consumedAt: null },
        data: { consumedAt: params.now },
      });
      if (consumed.count === 0) return false;

      await tx.user.update({
        where: { id: token.userId },
        data: { passwordHash: params.newPasswordHash },
      });

      await tx.session.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: params.now },
      });

      return true;
    });
  }
}

export const prismaAuthRepository = new PrismaAuthRepository();
