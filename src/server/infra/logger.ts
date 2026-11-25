import { getEnv, type ServerEnv } from "@/server/env";

type LogLevel = ServerEnv["LOG_LEVEL"];

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogContext {
  [key: string]: unknown;
}

export class Logger {
  constructor(private readonly bindings: LogContext = {}) {}

  child(extra: LogContext): Logger {
    return new Logger({ ...this.bindings, ...extra });
  }

  debug(msg: string, meta?: LogContext) {
    this.write("debug", msg, meta);
  }

  info(msg: string, meta?: LogContext) {
    this.write("info", msg, meta);
  }

  warn(msg: string, meta?: LogContext) {
    this.write("warn", msg, meta);
  }

  error(msg: string, meta?: LogContext) {
    this.write("error", msg, meta);
  }

  private write(level: LogLevel, msg: string, meta?: LogContext) {
    const env = getEnv();
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[env.LOG_LEVEL]) return;

    const entry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...this.bindings,
      ...meta,
    };

    const line =
      env.NODE_ENV === "production"
        ? JSON.stringify(entry)
        : `[${entry.ts}] ${level.toUpperCase()} ${msg}${
            Object.keys({ ...this.bindings, ...meta }).length > 0
              ? ` ${JSON.stringify({ ...this.bindings, ...meta })}`
              : ""
          }`;

    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}

export const logger = new Logger({ service: "worksphere" });
