import { ok, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { tenancyService } from "@/server/modules/organization/tenancy.service";

interface InvitationParams {
  params: Promise<{ orgId: string; invitationId: string }>;
}

export const DELETE = route<InvitationParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { orgId, invitationId } = await params;
  await tenancyService.revokeInvitation(actor.userId, orgId, invitationId);
  return ok({ revoked: true });
});
