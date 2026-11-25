import { badRequest } from "@/server/http/errors";
import { ok, route } from "@/server/http/route";
import { enforceRateLimit } from "@/server/infra/rate-limit";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface TaskParams {
  params: Promise<{ taskId: string }>;
}

export const POST = route<TaskParams>(async (request, { params }) => {
  await enforceRateLimit(request, { bucket: "task:upload", limit: 20, windowSeconds: 60 });
  const actor = await authenticateRequest(request);
  const { taskId } = await params;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw badRequest("Expected multipart/form-data file upload");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw badRequest("Missing file field in upload");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const saved = await projectTaskService.uploadAttachment(actor.userId, taskId, {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    bytes,
  });

  return ok(saved, { status: 201 });
});
