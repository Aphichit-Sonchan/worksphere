import { ok, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { notificationService } from "@/server/modules/notification/notification.service";

export const GET = route(async (request: Request) => {
  const actor = await authenticateRequest(request);
  const sp = new URL(request.url).searchParams;
  const unreadOnly = sp.get("unreadOnly") === "1";
  const cursor = sp.get("cursor") ?? undefined;
  const limit = sp.get("limit") ? Number.parseInt(sp.get("limit")!, 10) : 30;

  const result = await notificationService.listMyNotifications(actor.userId, {
    unreadOnly,
    cursor,
    limit: Number.isNaN(limit) ? 30 : limit,
  });

  return ok(result.items, {
    meta: {
      unreadCount: result.unreadCount,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    },
  });
});
