import { beforeEach, describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "@/lib/validation/auth";
import type { AppError } from "@/server/http/errors";
import { ok, route } from "@/server/http/route";
import type { MailAdapter, MailMessage } from "@/server/infra/mailer";
import { enforceRateLimit, memoryRateLimiter } from "@/server/infra/rate-limit";
import type {
  AuthRepository,
  AuthSessionRecord,
  AuthUserRecord,
} from "./auth.repository";
import { AuthService } from "./auth.service";
import { signAccessToken, verifyAccessToken } from "./crypto";
import { authenticateRequest } from "./guard";

class InMemoryAuthRepository implements AuthRepository {
  users = new Map<string, AuthUserRecord>();
  sessions = new Map<string, Omit<AuthSessionRecord, "user">>();
  tokens = new Map<
    string,
    {
      id: string;
      userId: string;
      purpose: "EMAIL_VERIFY" | "PASSWORD_RESET";
      tokenHash: string;
      expiresAt: Date;
      consumedAt: Date | null;
    }
  >();
  private seq = 0;

  private nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    for (const u of this.users.values()) {
      if (u.email === email) return u;
    }
    return null;
  }

  async findUserById(id: string): Promise<AuthUserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async listUserOrganizations() {
    return [];
  }

  async createUserWithSessionAndVerifyToken(params: {
    email: string;
    name: string;
    passwordHash: string;
    locale: "th" | "en";
    familyId: string;
    refreshTokenHash: string;
    sessionExpiresAt: Date;
    verifyTokenHash: string;
    verifyExpiresAt: Date;
  }) {
    const user: AuthUserRecord = {
      id: this.nextId("usr"),
      email: params.email,
      name: params.name,
      avatarUrl: null,
      passwordHash: params.passwordHash,
      systemRole: "USER",
      locale: params.locale,
      emailVerifiedAt: null,
      disabledAt: null,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);

    const sessionId = this.nextId("ses");
    this.sessions.set(sessionId, {
      id: sessionId,
      userId: user.id,
      familyId: params.familyId,
      refreshTokenHash: params.refreshTokenHash,
      replacedByTokenHash: null,
      revokedAt: null,
      expiresAt: params.sessionExpiresAt,
    });

    const tokId = this.nextId("tok");
    this.tokens.set(params.verifyTokenHash, {
      id: tokId,
      userId: user.id,
      purpose: "EMAIL_VERIFY",
      tokenHash: params.verifyTokenHash,
      expiresAt: params.verifyExpiresAt,
      consumedAt: null,
    });

    return { user, sessionId };
  }

  async createSession(params: {
    userId: string;
    familyId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }) {
    const id = this.nextId("ses");
    this.sessions.set(id, {
      id,
      userId: params.userId,
      familyId: params.familyId,
      refreshTokenHash: params.refreshTokenHash,
      replacedByTokenHash: null,
      revokedAt: null,
      expiresAt: params.expiresAt,
    });
    return { id };
  }

  async findSessionByRefreshHash(refreshTokenHash: string): Promise<AuthSessionRecord | null> {
    for (const s of this.sessions.values()) {
      if (s.refreshTokenHash === refreshTokenHash) {
        const user = this.users.get(s.userId);
        if (!user) return null;
        return { ...s, user };
      }
    }
    return null;
  }

  async findActiveSessionById(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s || s.revokedAt || s.expiresAt <= new Date()) return null;
    return { id: s.id, userId: s.userId };
  }

  async rotateSession(params: {
    oldSessionId: string;
    userId: string;
    familyId: string;
    newRefreshTokenHash: string;
    newExpiresAt: Date;
  }) {
    const existing = this.sessions.get(params.oldSessionId);
    if (!existing || existing.revokedAt || existing.replacedByTokenHash) return null;
    existing.revokedAt = new Date();
    existing.replacedByTokenHash = params.newRefreshTokenHash;

    const newSessionId = this.nextId("ses");
    this.sessions.set(newSessionId, {
      id: newSessionId,
      userId: params.userId,
      familyId: params.familyId,
      refreshTokenHash: params.newRefreshTokenHash,
      replacedByTokenHash: null,
      revokedAt: null,
      expiresAt: params.newExpiresAt,
    });
    return { newSessionId };
  }

  async revokeSessionFamily(familyId: string) {
    const now = new Date();
    for (const s of this.sessions.values()) {
      if (s.familyId === familyId && !s.revokedAt) s.revokedAt = now;
    }
  }

  async revokeSessionById(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (s && !s.revokedAt) s.revokedAt = new Date();
  }

  async revokeSessionByRefreshHash(refreshTokenHash: string) {
    for (const s of this.sessions.values()) {
      if (s.refreshTokenHash === refreshTokenHash && !s.revokedAt) {
        s.revokedAt = new Date();
      }
    }
  }

  async revokeAllUserSessions(userId: string) {
    const now = new Date();
    for (const s of this.sessions.values()) {
      if (s.userId === userId && !s.revokedAt) s.revokedAt = now;
    }
  }

  async consumeEmailVerificationToken(tokenHash: string, now: Date) {
    const t = this.tokens.get(tokenHash);
    if (!t || t.purpose !== "EMAIL_VERIFY" || t.consumedAt || t.expiresAt <= now) return false;
    t.consumedAt = now;
    const u = this.users.get(t.userId);
    if (u) u.emailVerifiedAt = now;
    return true;
  }

  async createPasswordResetToken(params: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    const now = new Date();
    for (const t of this.tokens.values()) {
      if (t.userId === params.userId && t.purpose === "PASSWORD_RESET" && !t.consumedAt) {
        t.consumedAt = now;
      }
    }
    this.tokens.set(params.tokenHash, {
      id: this.nextId("tok"),
      userId: params.userId,
      purpose: "PASSWORD_RESET",
      tokenHash: params.tokenHash,
      expiresAt: params.expiresAt,
      consumedAt: null,
    });
  }

  async consumePasswordResetAndUpdatePassword(params: {
    tokenHash: string;
    newPasswordHash: string;
    now: Date;
  }) {
    const t = this.tokens.get(params.tokenHash);
    if (!t || t.purpose !== "PASSWORD_RESET" || t.consumedAt || t.expiresAt <= params.now) {
      return false;
    }
    t.consumedAt = params.now;
    const u = this.users.get(t.userId);
    if (!u) return false;
    u.passwordHash = params.newPasswordHash;
    await this.revokeAllUserSessions(u.id);
    return true;
  }
}

class SpyMailer implements MailAdapter {
  sent: MailMessage[] = [];
  async send(msg: MailMessage) {
    this.sent.push(msg);
  }
  extractLastToken(): string {
    const last = this.sent.at(-1);
    const match = last?.text.match(/token=([^\s&]+)/);
    return match ? decodeURIComponent(match[1]!) : "";
  }
}

describe("Access Token lifecycle & tamper protection", () => {
  const secret = "test-secret-with-at-least-32-characters!!";

  it("rejects expired and tampered access tokens", () => {
    const nowMs = 1_700_000_000_000;
    const token = signAccessToken(
      { userId: "u1", sessionId: "s1", systemRole: "USER" },
      { nowMs, ttlSeconds: 60, secret },
    );

    const valid = verifyAccessToken(token, { nowMs: nowMs + 30_000, secret });
    expect(valid.ok).toBe(true);

    const expired = verifyAccessToken(token, { nowMs: nowMs + 61_000, secret });
    expect(expired).toEqual({ ok: false, reason: "expired" });

    const tampered = `${token.slice(0, -2)}xx`;
    expect(verifyAccessToken(tampered, { nowMs, secret })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("AuthService security & token rotation flows", () => {
  let repo: InMemoryAuthRepository;
  let mail: SpyMailer;
  let service: AuthService;

  beforeEach(() => {
    repo = new InMemoryAuthRepository();
    mail = new SpyMailer();
    service = new AuthService(repo, mail);
    memoryRateLimiter.resetAll();
  });

  it("registers, normalizes email, blocks duplicates, and hides user existence on invalid login", async () => {
    const input = registerSchema.parse({
      name: "Somchai",
      email: "  SOMCHAI@Example.com ",
      password: "CorrectHorseBattery9!",
    });
    const reg = await service.register(input);
    expect(reg.user.email).toBe("somchai@example.com");
    expect(reg.user.emailVerified).toBe(false);

    await expect(service.register(input)).rejects.toMatchObject({ status: 409 });

    let wrongPassErr: AppError | null = null;
    let unknownEmailErr: AppError | null = null;
    try {
      await service.login(loginSchema.parse({ email: "somchai@example.com", password: "wrong" }));
    } catch (e) {
      wrongPassErr = e as AppError;
    }
    try {
      await service.login(loginSchema.parse({ email: "nobody@example.com", password: "wrong" }));
    } catch (e) {
      unknownEmailErr = e as AppError;
    }

    expect(wrongPassErr?.status).toBe(401);
    expect(unknownEmailErr?.status).toBe(401);
    expect(wrongPassErr?.message).toBe(unknownEmailErr?.message);
  });

  it("rotates refresh tokens and revokes the entire session family when reuse is detected", async () => {
    const first = await service.register({
      name: "Alice",
      email: "alice@example.com",
      password: "StrongPassword123!",
    });

    // หมุนรอบที่ 1 สำเร็จ ได้ token ชุดที่ 2
    const second = await service.refreshSession(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const reqBeforeReuse = new Request("http://localhost:3000/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${second.accessToken}` },
    });
    const actor = await authenticateRequest(reqBeforeReuse, repo);
    expect(actor.userId).toBe(first.user.id);

    // ผู้โจมตีนำ refreshToken แรกที่ถูกหมุนไปแล้วกลับมาใช้ซ้ำ -> ต้องปฏิเสธและเพิกถอนทั้งตระกูล!
    await expect(service.refreshSession(first.refreshToken)).rejects.toMatchObject({
      status: 401,
    });

    // แม้แต่ชุดที่ 2 ของผู้ใช้จริงในตระกูลเดียวกันก็ต้องถูกตัดสิทธิ์ทันทีเพื่อความปลอดภัย
    await expect(service.refreshSession(second.refreshToken)).rejects.toMatchObject({
      status: 401,
    });
    await expect(authenticateRequest(reqBeforeReuse, repo)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("verifies email single-use token and revokes active sessions upon password reset", async () => {
    const reg = await service.register({
      name: "Nida",
      email: "nida@example.com",
      password: "InitialPassword123!",
    });
    const verifyToken = mail.extractLastToken();

    await service.verifyEmail(verifyToken);
    const meVerified = await service.getMe(reg.user.id);
    expect(meVerified.user.emailVerified).toBe(true);

    // ใช้ซ้ำไม่ได้
    await expect(service.verifyEmail(verifyToken)).rejects.toMatchObject({ status: 400 });

    // ขอรีเซ็ตรหัสผ่าน
    await service.requestPasswordReset("nida@example.com");
    const resetToken = mail.extractLastToken();

    await service.resetPassword({
      token: resetToken,
      newPassword: "UpdatedPassword456!",
    });

    // เซสชันเดิมก่อนรีเซ็ตรหัสผ่านต้องใช้งานไม่ได้ทันที
    await expect(service.refreshSession(reg.refreshToken)).rejects.toMatchObject({ status: 401 });

    // ล็อกอินด้วยรหัสผ่านใหม่ได้สำเร็จ
    const relogin = await service.login({
      email: "nida@example.com",
      password: "UpdatedPassword456!",
    });
    expect(relogin.user.id).toBe(reg.user.id);
  });

  it("enforces brute-force rate limiting and blocks cross-origin CSRF mutations", async () => {
    const req = new Request("http://localhost:3000/api/v1/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });

    for (let i = 0; i < 3; i++) {
      await enforceRateLimit(req, { bucket: "test:login", limit: 3, windowSeconds: 60 });
    }
    await expect(
      enforceRateLimit(req, { bucket: "test:login", limit: 3, windowSeconds: 60 }),
    ).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });

    const protectedPost = route(async () => ok({ ok: true }));
    const evilReq = new Request("http://localhost:3000/api/v1/auth/logout", {
      method: "POST",
      headers: { Origin: "https://attacker.example.com" },
    });
    const evilRes = await protectedPost(evilReq, {});
    expect(evilRes.status).toBe(403);
    expect(evilRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
