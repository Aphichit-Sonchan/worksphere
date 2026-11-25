import { ok, route } from "@/server/http/route";
import { analyticsService } from "@/server/modules/analytics/analytics.service";
import { authenticateRequest } from "@/server/modules/auth/guard";

interface ProjectParams {
  params: Promise<{ projectId: string }>;
}

export const GET = route<ProjectParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { projectId } = await params;
  const analytics = await analyticsService.getProjectAnalytics(actor.userId, projectId);
  return ok(analytics);
});
