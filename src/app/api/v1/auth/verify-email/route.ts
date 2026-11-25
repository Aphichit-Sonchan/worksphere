import { verifyEmailSchema } from "@/lib/validation/auth";
import { ok, parseJson, route } from "@/server/http/route";
import { enforceRateLimit } from "@/server/infra/rate-limit";
import { authService } from "@/server/modules/auth/auth.service";

export const POST = route(async (request: Request) => {
  await enforceRateLimit(request, { bucket: "auth:verify", limit: 15, windowSeconds: 60 });
  const input = await parseJson(request, verifyEmailSchema);
  await authService.verifyEmail(input.token);
  return ok({ verified: true });
});
