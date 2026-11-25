import { route } from "@/server/http/route";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

interface ExportParams {
  params: Promise<{ projectId: string; exportId: string }>;
}

export const GET = route<ExportParams>(async (request, { params }) => {
  const actor = await authenticateRequest(request);
  const { projectId, exportId } = await params;
  const rawFormat = new URL(request.url).searchParams.get("format");
  const format = rawFormat === "json" ? "json" : "csv";

  const { bytes, fileName, mimeType } = await projectTaskService.readTasksExport(
    actor.userId,
    projectId,
    exportId,
    format,
  );

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
});
