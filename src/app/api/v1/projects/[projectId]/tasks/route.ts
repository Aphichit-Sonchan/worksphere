import { createTaskSchema, taskQuerySchema } from "@/lib/validation/project-task";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface ProjectParams {
  params: Promise<{ projectId: string }>;
}

export const GET = route<ProjectParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { projectId } = await params;
  const rawQuery = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsedQuery = taskQuerySchema.parse(rawQuery);
  const result = await projectTaskService.queryTasks(actor.userId, projectId, parsedQuery);
  return ok(result.items, {
    meta: { nextCursor: result.nextCursor, hasMore: result.hasMore },
  });
});

export const POST = route<ProjectParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { projectId } = await params;
  const input = await parseJson(request, createTaskSchema);
  const created = await projectTaskService.createTask(actor.userId, projectId, input);
  return ok(created, { status: 201 });
});
