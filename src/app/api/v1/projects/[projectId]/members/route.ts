import { upsertProjectMemberSchema } from "@/lib/validation/project-task";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface ProjectParams {
  params: Promise<{ projectId: string }>;
}

export const GET = route<ProjectParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { projectId } = await params;
  const members = await projectTaskService.listProjectMembers(actor.userId, projectId);
  return ok(members);
});

export const POST = route<ProjectParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { projectId } = await params;
  const { userId, role } = await parseJson(request, upsertProjectMemberSchema);
  await projectTaskService.upsertProjectMember(actor.userId, projectId, userId, role);
  return ok({ added: true }, { status: 201 });
});
