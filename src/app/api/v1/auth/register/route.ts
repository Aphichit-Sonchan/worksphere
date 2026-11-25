import { registerSchema } from "@/lib/validation/auth";
import { ok, parseJson, route } from "@/server/http/route";
import { enforceRateLimit, getClientIp } from "@/server/infra/rate-limit";
import { authService } from "@/server/modules/auth/auth.service";
import { appendSetCookies, buildAuthSetCookies } from "@/server/modules/auth/cookies";

export const POST = route(async (request: Request) => {
  await enforceRateLimit(request, { bucket: "auth:register", limit: 10, windowSeconds: 60 });
  const input = await parseJson(request, registerSchema);

  const result = await authService.register(input, {
    ipAddress: getClientIp(request),
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  const res = ok({ user: result.user }, { status: 201 });
  return appendSetCookies(res, buildAuthSetCookies(result));
});
