import { ok, route } from "@/server/http/route";
import { authService } from "@/server/modules/auth/auth.service";
import { authenticateRequest } from "@/server/modules/auth/guard";

export const GET = route(async (request: Request) => {
  const actor = await authenticateRequest(request);
  const data = await authService.getMe(actor.userId);
  return ok(data);
});
