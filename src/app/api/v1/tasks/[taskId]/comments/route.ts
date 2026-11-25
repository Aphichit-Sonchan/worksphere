import { createCommentSchema } from "@/lib/validation/project-task";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface TaskParams {
  params: Promise<{ taskId: string }>;
}

export const GET = route<TaskParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { taskId } = await params;
  const sp = new URL(request.url).searchParams;
  const cursor = sp.get("cursor") ?? undefined;
  const result = await projectTaskService.listComments(actor.userId, taskId, cursor);
  return ok(result.items, {
    meta: { nextCursor: result.nextCursor, hasMore: result.hasMore },
  });
});

export const POST = route<TaskParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { taskId } = await params;
  const { body } = await parseJson(request, createCommentSchema);
  const created = await projectTaskService.createComment(actor.userId, taskId, body);
  return ok(created, { status: 201 });
});
