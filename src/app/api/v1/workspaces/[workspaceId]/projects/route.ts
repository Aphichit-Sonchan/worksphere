import { createProjectSchema } from "@/lib/validation/project-task";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface WorkspaceParams {
  params: Promise<{ workspaceId: string }>;
}

export const GET = route<WorkspaceParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { workspaceId } = await params;
  const projects = await projectTaskService.listWorkspaceProjects(actor.userId, workspaceId);
  return ok(projects);
});

export const POST = route<WorkspaceParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { workspaceId } = await params;
  const input = await parseJson(request, createProjectSchema);
  const created = await projectTaskService.createProject(actor.userId, workspaceId, input);
  return ok(created, { status: 201 });
});
