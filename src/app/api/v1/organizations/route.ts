import { createOrganizationSchema } from "@/lib/validation/tenancy";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { tenancyService } from "@/server/modules/organization/tenancy.service";

export const GET = route(async (request: Request) => {
  const actor = await authenticateRequest(request);
  const organizations = await tenancyService.listMyOrganizations(actor.userId);
  return ok(organizations);
});

export const POST = route(async (request: Request) => {
  const actor = await authenticateRequest(request);
  const input = await parseJson(request, createOrganizationSchema);
  const created = await tenancyService.createOrganization(actor.userId, input);
  return ok(created, { status: 201 });
});
