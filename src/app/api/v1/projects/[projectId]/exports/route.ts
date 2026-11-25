import { z } from "zod";
import { ok, parseJson, route } from "@/server/http/route";
import { enforceRateLimit } from "@/server/infra/rate-limit";
import { authenticateRequest } from "@/server/modules/auth/guard";
import { projectTaskService } from "@/server/modules/project/project-task.service";

const exportRequestSchema = z.object({
  format: z.enum(["csv", "json"]).optional().default("csv"),
});

interface ProjectParams {
  params: Promise<{ projectId: string }>;
}

export const POST = route<ProjectParams>(async (request, { params }) => {
  await enforceRateLimit(request, { bucket: "project:export", limit: 10, windowSeconds: 60 });
  const actor = await authenticateRequest(request);
  const { projectId } = await params;
  const { format } = await parseJson(request, exportRequestSchema);
  const result = await projectTaskService.generateTasksExport(actor.userId, projectId, format);
  return ok(result, { status: 202 });
});
