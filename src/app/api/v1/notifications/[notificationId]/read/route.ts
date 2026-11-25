import { ok, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { notificationService } from "@/server/modules/notification/notification.service";

interface NotificationParams {
  params: Promise<{ notificationId: string }>;
}

export const PATCH = route<NotificationParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { notificationId } = await params;
  const result = await notificationService.markRead(actor.userId, notificationId);
  return ok(result);
});
