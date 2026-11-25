import { updateProjectSchema } from "@/lib/validation/project-task";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface ProjectParams {
  params: Promise<{ projectId: string }>;
}

export const GET = route<ProjectParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { projectId } = await params;
  const overview = await projectTaskService.getProjectOverview(actor.userId, projectId);
  return ok(overview);
});

export const PATCH = route<ProjectParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { projectId } = await params;
  const input = await parseJson(request, updateProjectSchema);
  const updated = await projectTaskService.updateProject(actor.userId, projectId, input);
  return ok(updated);
});
