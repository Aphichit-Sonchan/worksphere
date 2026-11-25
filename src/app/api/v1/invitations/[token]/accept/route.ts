import { ok, route } from "@/server/http/route";
import { enforceRateLimit } from "@/server/infra/rate-limit";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { tenancyService } from "@/server/modules/organization/tenancy.service";

interface TokenParams {
  params: Promise<{ token: string }>;
}

export const POST = route<TokenParams>(async (request, { params }) => {
  await enforceRateLimit(request, { bucket: "org:accept-invite", limit: 15, windowSeconds: 60 });
  const actor = await authenticateRequest(request);
  const { token } = await params;
  const joined = await tenancyService.acceptInvitation(actor.userId, token);
  return ok(joined);
});
