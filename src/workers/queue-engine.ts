import { Queue, Worker } from "bullmq";
import { logger } from "@/server/infra/logger";
import { getRedis } from "@/server/infra/redis";

export interface EnqueueOptions {
  /** กำหนด jobId คงที่เพื่อป้องกันการทำงานซ้ำ (Idempotency) */
  jobId: string;
  attempts?: number;
  baseDelayMs?: number;
}

export interface JobRecord<T = unknown> {
  jobId: string;
  name: string;
  payload: T;
  attemptsMade: number;
  status: "completed" | "failed";
  lastError?: string;
}

export type JobHandler<T = unknown> = (payload: T, attempt: number) => Promise<void>;

/**
 * Queue Runner ที่รองรับทั้ง BullMQ (เมื่อต่อ Redis) และ In-Memory Retry Engine
 * ที่มี Exponential Backoff, Retry Policy และ Idempotency เหมือนกันทุกประการสำหรับการทดสอบและ Local Dev
 */
export class ResilientJobQueue {
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private readonly completedJobIds = new Set<string>();
  private readonly inFlightJobIds = new Set<string>();
  private readonly history = new Map<string, JobRecord>();
  private bullQueue: Queue | null = null;
  private bullWorker: Worker | null = null;

  constructor(
    public readonly queueName: string,
    private readonly options: { forceMemory?: boolean } = {},
  ) {}

  register<T>(jobName: string, handler: JobHandler<T>): void {
    this.handlers.set(jobName, handler as JobHandler<unknown>);
  }

  private ensureBullQueue(): Queue | null {
    if (this.options.forceMemory) return null;
    const connection = getRedis();
    if (!connection) return null;
    if (!this.bullQueue) {
      this.bullQueue = new Queue(this.queueName, {
        connection,
        defaultJobOptions: {
          attempts: 4,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: 200,
          removeOnFail: 500,
        },
      });
    }
    return this.bullQueue;
  }

  startBullWorker(): Worker | null {
    if (this.options.forceMemory) return null;
    const connection = getRedis();
    if (!connection) return null;
    if (this.bullWorker) return this.bullWorker;

    this.bullWorker = new Worker(
      this.queueName,
      async (job) => {
        const handler = this.handlers.get(job.name);
        if (!handler) {
          throw new Error(`No handler registered for job "${job.name}"`);
        }
        await handler(job.data, job.attemptsMade + 1);
      },
      { connection },
    );

    this.bullWorker.on("failed", (job, err) => {
      logger.error("bullmq job failed", {
        queue: this.queueName,
        jobId: job?.id,
        name: job?.name,
        attemptsMade: job?.attemptsMade,
        error: err.message,
      });
    });

    return this.bullWorker;
  }

  async enqueue<T>(
    jobName: string,
    payload: T,
    opts: EnqueueOptions,
  ): Promise<{ deduplicated: boolean; jobId: string }> {
    const bull = this.ensureBullQueue();
    if (bull) {
      await bull.add(jobName, payload, {
        jobId: opts.jobId,
        attempts: opts.attempts ?? 4,
        backoff: { type: "exponential", delay: opts.baseDelayMs ?? 2000 },
      });
      return { deduplicated: false, jobId: opts.jobId };
    }

    // Idempotency check: หากสำเร็จไปแล้วหรือกำลังรันอยู่ ไม่ต้องรันซ้ำ
    if (this.completedJobIds.has(opts.jobId) || this.inFlightJobIds.has(opts.jobId)) {
      return { deduplicated: true, jobId: opts.jobId };
    }

    const handler = this.handlers.get(jobName);
    if (!handler) {
      throw new Error(`No handler registered for job "${jobName}"`);
    }

    this.inFlightJobIds.add(opts.jobId);
    const maxAttempts = opts.attempts ?? 4;
    const baseDelay = opts.baseDelayMs ?? 20;

    let attempt = 0;
    let lastError = "";

    try {
      while (attempt < maxAttempts) {
        attempt += 1;
        try {
          await handler(payload, attempt);
          this.completedJobIds.add(opts.jobId);
          this.history.set(opts.jobId, {
            jobId: opts.jobId,
            name: jobName,
            payload,
            attemptsMade: attempt,
            status: "completed",
          });
          return { deduplicated: false, jobId: opts.jobId };
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          logger.warn("background job attempt failed", {
            queue: this.queueName,
            jobId: opts.jobId,
            name: jobName,
            attempt,
            maxAttempts,
            error: lastError,
          });
          if (attempt < maxAttempts) {
            const backoffMs = baseDelay * 2 ** (attempt - 1);
            await new Promise((r) => setTimeout(r, backoffMs));
          }
        }
      }

      this.history.set(opts.jobId, {
        jobId: opts.jobId,
        name: jobName,
        payload,
        attemptsMade: attempt,
        status: "failed",
        lastError,
      });
      throw new Error(`Job "${opts.jobId}" exhausted all ${maxAttempts} attempts: ${lastError}`);
    } finally {
      this.inFlightJobIds.delete(opts.jobId);
    }
  }

  getJobRecord(jobId: string): JobRecord | undefined {
    return this.history.get(jobId);
  }
}
