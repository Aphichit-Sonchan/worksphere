import { ok, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { tenancyService } from "@/server/modules/organization/tenancy.service";

export const GET = route(async (request: Request) => {
  const actor = await authenticateRequest(request);
  const orgs = await tenancyService.adminListOrganizations(actor);
  return ok(orgs);
});
