import { ok, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface ProjectParams {
  params: Promise<{ projectId: string }>;
}

export const GET = route<ProjectParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { projectId } = await params;
  const sp = new URL(request.url).searchParams;
  const cursor = sp.get("cursor") ?? undefined;
  const result = await projectTaskService.listProjectActivity(actor.userId, projectId, cursor);
  return ok(result.items, {
    meta: { nextCursor: result.nextCursor, hasMore: result.hasMore },
  });
});
