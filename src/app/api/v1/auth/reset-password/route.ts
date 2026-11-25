import { resetPasswordSchema } from "@/lib/validation/auth";
import { ok, parseJson, route } from "@/server/http/route";
import { enforceRateLimit } from "@/server/infra/rate-limit";
import { authService } from "@/server/modules/auth/auth.service";
import { appendSetCookies, buildClearAuthCookies } from "@/server/modules/auth/cookies";

export const POST = route(async (request: Request) => {
  await enforceRateLimit(request, { bucket: "auth:reset", limit: 5, windowSeconds: 60 });
  const input = await parseJson(request, resetPasswordSchema);
  await authService.resetPassword(input);
  return appendSetCookies(ok({ reset: true }), buildClearAuthCookies());
});
