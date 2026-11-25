import crypto from "node:crypto";
import { getEnv } from "@/server/env";

export const REALTIME_EVENTS = {
  TASK_CREATED: "task.created",
  TASK_UPDATED: "task.updated",
  TASK_MOVED: "task.moved",
  TASK_DELETED: "task.deleted",
  COMMENT_CREATED: "comment.created",
  COMMENT_UPDATED: "comment.updated",
  COMMENT_DELETED: "comment.deleted",
  ACTIVITY_LOGGED: "activity.logged",
  NOTIFICATION_CREATED: "notification.created",
  PRESENCE_UPDATED: "presence.updated",
} as const;

export type RealtimeEventName = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

export const rooms = {
  user: (userId: string) => `user:${userId}`,
  project: (projectId: string) => `project:${projectId}`,
} as const;

export interface PresenceUser {
  userId: string;
  name: string;
  email: string;
}

export interface InternalPublishPayload {
  room: string;
  event: RealtimeEventName;
  data: unknown;
}

type LocalListener = (msg: InternalPublishPayload) => void;
const localListeners = new Set<LocalListener>();

export function onLocalRealtimePublish(listener: LocalListener): () => void {
  localListeners.add(listener);
  return () => localListeners.delete(listener);
}

export function signInternalPayload(rawBody: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export function verifyInternalSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = signInternalPayload(rawBody, secret);
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * ส่ง Event ไปยัง Socket.IO Server (ทั้งแบบ in-process และข้ามโปรเซสผ่าน HTTP Bridge)
 * ออกแบบแบบ Non-blocking: หากโปรเซสเสริม realtime ไม่ได้เปิดรันอยู่ จะไม่ทำให้ API หลักล้มเหลว
 */
export async function publishRealtimeEvent(
  room: string,
  event: RealtimeEventName,
  data: unknown,
): Promise<void> {
  const payload: InternalPublishPayload = { room, event, data };

  for (const listener of localListeners) {
    try {
      listener(payload);
    } catch {
      // ignore listener errors
    }
  }

  if (process.env.NODE_ENV === "test") return;

  const env = getEnv();
  const body = JSON.stringify(payload);
  const sig = signInternalPayload(body, env.AUTH_SECRET);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    await fetch(`http://127.0.0.1:${env.REALTIME_PORT}/internal/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ws-signature": sig,
      },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  } catch {
    // โหมดที่ผู้ใช้รันเฉพาะ next dev โดยไม่ได้เปิดโปรเซส realtime แยก
  }
}
