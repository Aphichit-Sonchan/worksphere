import { updateWorkspaceSchema } from "@/lib/validation/tenancy";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { tenancyService } from "@/server/modules/organization/tenancy.service";

interface WorkspaceParams {
  params: Promise<{ workspaceId: string }>;
}

export const GET = route<WorkspaceParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { workspaceId } = await params;
  const ws = await tenancyService.getWorkspace(actor.userId, workspaceId);
  return ok(ws);
});

export const PATCH = route<WorkspaceParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { workspaceId } = await params;
  const input = await parseJson(request, updateWorkspaceSchema);
  const updated = await tenancyService.updateWorkspace(actor.userId, workspaceId, input);
  return ok(updated);
});
