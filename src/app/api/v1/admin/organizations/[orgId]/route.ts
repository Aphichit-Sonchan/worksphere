import { adminUpdateOrganizationSchema } from "@/lib/validation/tenancy";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { tenancyService } from "@/server/modules/organization/tenancy.service";

interface OrgParams {
  params: Promise<{ orgId: string }>;
}

export const PATCH = route<OrgParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { orgId } = await params;
  const { suspended } = await parseJson(request, adminUpdateOrganizationSchema);
  const updated = await tenancyService.adminSetOrganizationSuspended(actor, orgId, suspended);
  return ok(updated);
});
