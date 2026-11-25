import { addDependencySchema } from "@/lib/validation/project-task";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface TaskParams {
  params: Promise<{ taskId: string }>;
}

export const POST = route<TaskParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { taskId } = await params;
  const { dependsOnTaskId } = await parseJson(request, addDependencySchema);
  const updated = await projectTaskService.addDependency(actor.userId, taskId, dependsOnTaskId);
  return ok(updated, { status: 201 });
});
