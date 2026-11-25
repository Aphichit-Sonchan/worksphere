import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { Server as SocketIOServer } from "socket.io";
import { getEnv } from "@/server/env";
import { logger } from "@/server/infra/logger";
import { prismaAuthRepository, type AuthRepository } from "@/server/modules/auth/auth.repository";
import {
  projectTaskService,
  type ProjectTaskService,
} from "@/server/modules/project/project-task.service";
import {
  onLocalRealtimePublish,
  REALTIME_EVENTS,
  rooms,
  verifyInternalSignature,
  type InternalPublishPayload,
} from "./events";
import {
  authenticateSocketHandshake,
  authorizeProjectRoomJoin,
  PresenceTracker,
  type SocketActor,
} from "./room-guard";

export interface RealtimeServerDeps {
  authRepo?: AuthRepository;
  projService?: Pick<ProjectTaskService, "resolveProjectContext">;
  corsOrigin?: string;
  internalSecret?: string;
}

export function createRealtimeServer(deps: RealtimeServerDeps = {}) {
  const env = getEnv();
  const authRepo = deps.authRepo ?? prismaAuthRepository;
  const projService = deps.projService ?? projectTaskService;
  const internalSecret = deps.internalSecret ?? env.AUTH_SECRET;
  const presence = new PresenceTracker();

  let ioRef: SocketIOServer | null = null;

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "realtime" }));
      return;
    }

    if (req.method === "POST" && req.url === "/internal/publish") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const sig = req.headers["x-ws-signature"];
      const signature = Array.isArray(sig) ? sig[0] : sig;

      if (!verifyInternalSignature(rawBody, signature, internalSecret)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid internal signature" }));
        return;
      }

      try {
        const parsed = JSON.parse(rawBody) as InternalPublishPayload;
        ioRef?.to(parsed.room).emit(parsed.event, parsed.data);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ published: true }));
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Malformed payload" }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: deps.corsOrigin ?? env.APP_URL,
      credentials: true,
    },
  });
  ioRef = io;

  // ซิงก์กรณีโปรเซสเดียวกันเรียก publishRealtimeEvent
  const unsubscribeLocal = onLocalRealtimePublish((msg) => {
    io.to(msg.room).emit(msg.event, msg.data);
  });

  // WS-501: บังคับยืนยันตัวตนตั้งแต่ขั้นตอน Handshake
  io.use(async (socket, next) => {
    try {
      const actor = await authenticateSocketHandshake(
        {
          auth: socket.handshake.auth,
          headers: socket.handshake.headers as Record<string, string | string[] | undefined>,
        },
        authRepo,
      );
      if (!actor) {
        return next(new Error("UNAUTHENTICATED"));
      }
      socket.data.actor = actor;
      return next();
    } catch {
      return next(new Error("UNAUTHENTICATED"));
    }
  });

  io.on("connection", (socket) => {
    const actor = socket.data.actor as SocketActor;
    // เข้าห้องส่วนตัวสำหรับรับ Notification ทันที
    void socket.join(rooms.user(actor.userId));

    socket.on(
      "project:join",
      async (
        payload: { projectId?: string },
        ack?: (res: { ok: boolean; code?: string; onlineUsers?: unknown[] }) => void,
      ) => {
        const projectId = payload?.projectId ?? "";
        const allowed = await authorizeProjectRoomJoin(actor.userId, projectId, projService);

        if (!allowed) {
          logger.warn("unauthorized socket room join blocked", {
            userId: actor.userId,
            projectId,
          });
          ack?.({ ok: false, code: "FORBIDDEN" });
          return;
        }

        await socket.join(rooms.project(projectId));
        const onlineUsers = presence.join(projectId, socket.id, {
          userId: actor.userId,
          name: actor.name,
          email: actor.email,
        });

        io.to(rooms.project(projectId)).emit(REALTIME_EVENTS.PRESENCE_UPDATED, {
          projectId,
          onlineUsers,
        });
        ack?.({ ok: true, onlineUsers });
      },
    );

    socket.on("project:leave", async (payload: { projectId?: string }) => {
      const projectId = payload?.projectId ?? "";
      if (!projectId) return;
      await socket.leave(rooms.project(projectId));
      const onlineUsers = presence.leave(projectId, socket.id);
      io.to(rooms.project(projectId)).emit(REALTIME_EVENTS.PRESENCE_UPDATED, {
        projectId,
        onlineUsers,
      });
    });

    socket.on("disconnect", () => {
      const affected = presence.leaveAll(socket.id);
      for (const projectId of affected) {
        io.to(rooms.project(projectId)).emit(REALTIME_EVENTS.PRESENCE_UPDATED, {
          projectId,
          onlineUsers: presence.listOnlineUsers(projectId),
        });
      }
    });
  });

  return {
    httpServer,
    io,
    close: async () => {
      unsubscribeLocal();
      await io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();

if (isMain) {
  const port = getEnv().REALTIME_PORT;
  const { httpServer } = createRealtimeServer();
  httpServer.listen(port, () => {
    logger.info("realtime socket.io server listening", { port });
  });
}
