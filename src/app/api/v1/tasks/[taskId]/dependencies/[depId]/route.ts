import { ok, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface DepParams {
  params: Promise<{ taskId: string; depId: string }>;
}

export const DELETE = route<DepParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { taskId, depId } = await params;
  await projectTaskService.removeDependency(actor.userId, taskId, depId);
  return ok({ removed: true });
});
