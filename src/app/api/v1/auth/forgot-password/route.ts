import { forgotPasswordSchema } from "@/lib/validation/auth";
import { ok, parseJson, route } from "@/server/http/route";
import { enforceRateLimit } from "@/server/infra/rate-limit";
import { authService } from "@/server/modules/auth/auth.service";

export const POST = route(async (request: Request) => {
  const input = await parseJson(request, forgotPasswordSchema);
  await enforceRateLimit(
    request,
    { bucket: "auth:forgot", limit: 5, windowSeconds: 60 },
    input.email,
  );
  await authService.requestPasswordReset(input.email);
  return ok({ sent: true });
});
