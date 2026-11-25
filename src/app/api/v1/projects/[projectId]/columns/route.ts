import { createColumnSchema } from "@/lib/validation/project-task";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface ProjectParams {
  params: Promise<{ projectId: string }>;
}

export const POST = route<ProjectParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { projectId } = await params;
  const input = await parseJson(request, createColumnSchema);
  const column = await projectTaskService.createColumn(actor.userId, projectId, input);
  return ok(column, { status: 201 });
});
