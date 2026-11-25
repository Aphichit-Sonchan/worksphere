import { AppError } from "@/server/http/errors";
import { ok, route } from "@/server/http/route";
import { enforceRateLimit, getClientIp } from "@/server/infra/rate-limit";
import { authService } from "@/server/modules/auth/auth.service";
import {
  appendSetCookies,
  buildAuthSetCookies,
  buildClearAuthCookies,
  extractRefreshToken,
} from "@/server/modules/auth/cookies";

export const POST = route(async (request: Request) => {
  await enforceRateLimit(request, { bucket: "auth:refresh", limit: 30, windowSeconds: 60 });
  const refreshToken = extractRefreshToken(request);

  try {
    const result = await authService.refreshSession(refreshToken, {
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    const res = ok({ user: result.user });
    return appendSetCookies(res, buildAuthSetCookies(result));
  } catch (err) {
    if (err instanceof AppError && err.code === "UNAUTHENTICATED") {
      const clearRes = Response.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status },
      );
      return appendSetCookies(clearRes, buildClearAuthCookies());
    }
    throw err;
  }
});
