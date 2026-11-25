import { updateOrgMemberRoleSchema } from "@/lib/validation/tenancy";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { tenancyService } from "@/server/modules/organization/tenancy.service";

interface MemberParams {
  params: Promise<{ orgId: string; userId: string }>;
}

export const PATCH = route<MemberParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { orgId, userId } = await params;
  const { role } = await parseJson(request, updateOrgMemberRoleSchema);
  await tenancyService.updateMemberRole(actor.userId, orgId, userId, role);
  return ok({ updated: true, role });
});

export const DELETE = route<MemberParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { orgId, userId } = await params;
  await tenancyService.removeMember(actor.userId, orgId, userId);
  return ok({ removed: true });
});
