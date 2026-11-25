import { ok, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { notificationService } from "@/server/modules/notification/notification.service";

interface OrgParams {
  params: Promise<{ orgId: string }>;
}

export const GET = route<OrgParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { orgId } = await params;
  const sp = new URL(request.url).searchParams;
  const cursor = sp.get("cursor") ?? undefined;
  const result = await notificationService.listOrgAuditLogs(actor.userId, orgId, { cursor });
  return ok(result.items, {
    meta: { nextCursor: result.nextCursor, hasMore: result.hasMore },
  });
});
