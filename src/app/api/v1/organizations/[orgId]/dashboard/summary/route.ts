import { ok, route } from "@/server/http/route";
import { analyticsService } from "@/server/modules/analytics/analytics.service";
import { authenticateRequest } from "@/server/modules/auth/guard";

interface OrgParams {
  params: Promise<{ orgId: string }>;
}

export const GET = route<OrgParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { orgId } = await params;
  const summary = await analyticsService.getOrganizationDashboardSummary(actor.userId, orgId);
  return ok(summary);
});
