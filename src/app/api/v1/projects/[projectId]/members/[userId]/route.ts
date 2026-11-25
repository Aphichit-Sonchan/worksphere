import { updateProjectMemberRoleSchema } from "@/lib/validation/project-task";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface ProjectMemberParams {
  params: Promise<{ projectId: string; userId: string }>;
}

export const PATCH = route<ProjectMemberParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { projectId, userId } = await params;
  const { role } = await parseJson(request, updateProjectMemberRoleSchema);
  await projectTaskService.upsertProjectMember(actor.userId, projectId, userId, role);
  return ok({ updated: true, role });
});

export const DELETE = route<ProjectMemberParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { projectId, userId } = await params;
  await projectTaskService.removeProjectMember(actor.userId, projectId, userId);
  return ok({ removed: true });
});
