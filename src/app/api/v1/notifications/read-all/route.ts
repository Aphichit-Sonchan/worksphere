import { ok, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { notificationService } from "@/server/modules/notification/notification.service";

export const POST = route(async (request: Request) => {
  const actor = await authenticateRequest(request);
  const result = await notificationService.markAllRead(actor.userId);
  return ok(result);
});
