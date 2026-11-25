import { updateTaskSchema } from "@/lib/validation/project-task";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface TaskParams {
  params: Promise<{ taskId: string }>;
}

export const GET = route<TaskParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { taskId } = await params;
  const task = await projectTaskService.getTask(actor.userId, taskId);
  return ok(task);
});

export const PATCH = route<TaskParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { taskId } = await params;
  const input = await parseJson(request, updateTaskSchema);
  const updated = await projectTaskService.updateTask(actor.userId, taskId, input);
  return ok(updated);
});

export const DELETE = route<TaskParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { taskId } = await params;
  await projectTaskService.deleteTask(actor.userId, taskId);
  return ok({ deleted: true });
});
