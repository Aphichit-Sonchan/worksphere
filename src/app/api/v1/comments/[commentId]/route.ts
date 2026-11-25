import { updateCommentSchema } from "@/lib/validation/project-task";
import { ok, parseJson, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface CommentParams {
  params: Promise<{ commentId: string }>;
}

export const PATCH = route<CommentParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { commentId } = await params;
  const { body } = await parseJson(request, updateCommentSchema);
  const updated = await projectTaskService.updateComment(actor.userId, commentId, body);
  return ok(updated);
});

export const DELETE = route<CommentParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { commentId } = await params;
  await projectTaskService.deleteComment(actor.userId, commentId);
  return ok({ deleted: true });
});
