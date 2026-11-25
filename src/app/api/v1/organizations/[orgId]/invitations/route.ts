import { createInvitationSchema } from "@/lib/validation/tenancy";
import { ok, parseJson, route } from "@/server/http/route";
import { enforceRateLimit } from "@/server/infra/rate-limit";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { tenancyService } from "@/server/modules/organization/tenancy.service";

interface OrgParams {
  params: Promise<{ orgId: string }>;
}

export const GET = route<OrgParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { orgId } = await params;
  const invitations = await tenancyService.listInvitations(actor.userId, orgId);
  return ok(invitations);
});

export const POST = route<OrgParams>(async (request, { params }) => {
  await enforceRateLimit(request, { bucket: "org:invite", limit: 20, windowSeconds: 60 });
  const actor = await authenticateRequest(request);
  const { orgId } = await params;
  const input = await parseJson(request, createInvitationSchema);
  const created = await tenancyService.createInvitation(actor.userId, orgId, input);
  return ok(created, { status: 201 });
});
