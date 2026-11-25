import { ok, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface TagParams {
  params: Promise<{ projectId: string; tagId: string }>;
}

export const DELETE = route<TagParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { projectId, tagId } = await params;
  await projectTaskService.deleteTag(actor.userId, projectId, tagId);
  return ok({ deleted: true });
});
