import { moveTaskSchema } from "@/lib/validation/project-task";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface TaskParams {
  params: Promise<{ taskId: string }>;
}

export const PATCH = route<TaskParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { taskId } = await params;
  const input = await parseJson(request, moveTaskSchema);
  const moved = await projectTaskService.moveTask(actor.userId, taskId, input);
  return ok(moved);
});
