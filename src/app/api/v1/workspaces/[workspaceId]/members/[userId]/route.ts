import { ok, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { tenancyService } from "@/server/modules/organization/tenancy.service";

interface WsMemberParams {
  params: Promise<{ workspaceId: string; userId: string }>;
}

export const DELETE = route<WsMemberParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { workspaceId, userId } = await params;
  await tenancyService.removeWorkspaceMember(actor.userId, workspaceId, userId);
  return ok({ removed: true });
});
