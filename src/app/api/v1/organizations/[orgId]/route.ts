import { updateOrganizationSchema } from "@/lib/validation/tenancy";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { tenancyService } from "@/server/modules/organization/tenancy.service";

interface OrgParams {
  params: Promise<{ orgId: string }>;
}

export const GET = route<OrgParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { orgId } = await params;
  const org = await tenancyService.getOrganization(actor.userId, orgId);
  return ok(org);
});

export const PATCH = route<OrgParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { orgId } = await params;
  const input = await parseJson(request, updateOrganizationSchema);
  const updated = await tenancyService.updateOrganization(actor.userId, orgId, input);
  return ok(updated);
});

export const DELETE = route<OrgParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { orgId } = await params;
  await tenancyService.deleteOrganization(actor.userId, orgId);
  return ok({ deleted: true });
});
