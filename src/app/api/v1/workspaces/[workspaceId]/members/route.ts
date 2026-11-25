import { addWorkspaceMemberSchema } from "@/lib/validation/tenancy";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { tenancyService } from "@/server/modules/organization/tenancy.service";

interface WorkspaceParams {
  params: Promise<{ workspaceId: string }>;
}

export const GET = route<WorkspaceParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { workspaceId } = await params;
  const members = await tenancyService.listWorkspaceMembers(actor.userId, workspaceId);
  return ok(members);
});

export const POST = route<WorkspaceParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { workspaceId } = await params;
  const input = await parseJson(request, addWorkspaceMemberSchema);
  await tenancyService.addWorkspaceMember(actor.userId, workspaceId, input);
  return ok({ added: true }, { status: 201 });
});
