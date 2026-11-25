import { createWorkspaceSchema } from "@/lib/validation/tenancy";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { tenancyService } from "@/server/modules/organization/tenancy.service";

interface OrgParams {
  params: Promise<{ orgId: string }>;
}

export const GET = route<OrgParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { orgId } = await params;
  const workspaces = await tenancyService.listWorkspaces(actor.userId, orgId);
  return ok(workspaces);
});

export const POST = route<OrgParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { orgId } = await params;
  const input = await parseJson(request, createWorkspaceSchema);
  const created = await tenancyService.createWorkspace(actor.userId, orgId, input);
  return ok(created, { status: 201 });
});
