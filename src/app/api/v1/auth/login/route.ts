import { loginSchema } from "@/lib/validation/auth";
import { ok, parseJson, route } from "@/server/http/route";
import { enforceRateLimit, getClientIp } from "@/server/infra/rate-limit";
import { authService } from "@/server/modules/auth/auth.service";
import { appendSetCookies, buildAuthSetCookies } from "@/server/modules/auth/cookies";

export const POST = route(async (request: Request) => {
  const input = await parseJson(request, loginSchema);
  await enforceRateLimit(
    request,
    { bucket: "auth:login", limit: 8, windowSeconds: 60 },
    input.email,
  );

  const result = await authService.login(input, {
    ipAddress: getClientIp(request),
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  const res = ok({ user: result.user });
  return appendSetCookies(res, buildAuthSetCookies(result));
});
