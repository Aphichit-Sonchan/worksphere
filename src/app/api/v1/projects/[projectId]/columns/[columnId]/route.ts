import { updateColumnSchema } from "@/lib/validation/project-task";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface ColumnParams {
  params: Promise<{ projectId: string; columnId: string }>;
}

export const PATCH = route<ColumnParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { projectId, columnId } = await params;
  const input = await parseJson(request, updateColumnSchema);
  const updated = await projectTaskService.updateColumn(actor.userId, projectId, columnId, input);
  return ok(updated);
});

export const DELETE = route<ColumnParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { projectId, columnId } = await params;
  await projectTaskService.deleteColumn(actor.userId, projectId, columnId);
  return ok({ deleted: true });
});
