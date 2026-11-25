import { ok, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { tenancyService } from "@/server/modules/organization/tenancy.service";

interface OrgParams {
  params: Promise<{ orgId: string }>;
}

export const GET = route<OrgParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { orgId } = await params;
  const members = await tenancyService.listMembers(actor.userId, orgId);
  return ok(members);
});
