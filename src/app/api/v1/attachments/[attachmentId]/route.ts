import { ok, route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface AttachmentParams {
  params: Promise<{ attachmentId: string }>;
}

export const GET = route<AttachmentParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { attachmentId } = await params;
  const { attachment, bytes } = await projectTaskService.downloadAttachment(
    actor.userId,
    attachmentId,
  );

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.sizeBytes),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
    },
  });
});

export const DELETE = route<AttachmentParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { attachmentId } = await params;
  await projectTaskService.deleteAttachment(actor.userId, attachmentId);
  return ok({ deleted: true });
});
