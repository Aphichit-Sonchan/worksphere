import "dotenv/config";
import { fileURLToPath } from "node:url";
import { logger } from "@/server/infra/logger";
import { mailer } from "@/server/infra/mailer";
import {
  JOB_NAMES,
  runDeadlineReminderSweep,
  runProjectExportJob,
  runWeeklyOrgSummaryJob,
} from "./processors";
import { ResilientJobQueue } from "./queue-engine";

export const worksphereQueue = new ResilientJobQueue("worksphere-jobs");

worksphereQueue.register<{ to: string; subject: string; text: string }>(
  JOB_NAMES.INVITATION_EMAIL,
  async (payload) => {
    await mailer.send(payload);
  },
);

worksphereQueue.register<{
  exportId: string;
  orgId: string;
  projectId: string;
  requestedByUserId: string;
  format: "csv" | "json";
}>(JOB_NAMES.PROJECT_EXPORT, async (payload) => {
  await runProjectExportJob(payload);
});

worksphereQueue.register<{ triggeredAt: string }>(JOB_NAMES.DEADLINE_REMINDER, async () => {
  await runDeadlineReminderSweep();
});

worksphereQueue.register<{ orgId: string }>(JOB_NAMES.WEEKLY_SUMMARY, async ({ orgId }) => {
  await runWeeklyOrgSummaryJob(orgId);
});

export function startWorkers() {
  const worker = worksphereQueue.startBullWorker();
  if (!worker) {
    logger.info("REDIS_URL not set; background jobs execute via in-process resilient retry queue");
    return [];
  }
  logger.info("BullMQ worker online", { queue: worksphereQueue.queueName });
  return [worker];
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();

if (isMain) {
  startWorkers();
}
