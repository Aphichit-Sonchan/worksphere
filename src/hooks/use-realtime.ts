"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { PresenceUser } from "@/realtime/events";

let sharedSocket: Socket | null = null;
let socketSubscribers = 0;

function acquireSocket(): Socket {
  socketSubscribers += 1;
  if (!sharedSocket) {
    const realtimeUrl =
      process.env.NEXT_PUBLIC_REALTIME_URL || "http://localhost:3001";
    sharedSocket = io(realtimeUrl, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnectionAttempts: 3,
      reconnectionDelay: 2000,
      timeout: 3000,
    });
  }
  return sharedSocket;
}

function releaseSocket() {
  socketSubscribers = Math.max(0, socketSubscribers - 1);
  if (socketSubscribers === 0 && sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
  }
}

export interface NotificationDto {
  id: string;
  orgId: string;
  type: "TASK_ASSIGNED" | "MENTIONED" | "STATUS_CHANGED" | "INVITED";
  title: string;
  linkUrl: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export function useNotifications(enabled = true, unreadOnly = false) {
  const queryClient = useQueryClient();

  const query = useQuery<{
    data: NotificationDto[];
    meta: { unreadCount: number; nextCursor: string | null; hasMore: boolean };
  }>({
    queryKey: ["notifications", unreadOnly ? "unread" : "all"],
    enabled,
    refetchInterval: 25_000,
    queryFn: async () => {
      const qs = unreadOnly ? "?unreadOnly=1" : "";
      const res = await fetch(`/api/v1/notifications${qs}`, { credentials: "include" });
      if (!res.ok) {
        return { data: [], meta: { unreadCount: 0, nextCursor: null, hasMore: false } };
      }
      return res.json();
    },
  });

  useEffect(() => {
    if (!enabled) return;
    const socket = acquireSocket();
    const onNewNotification = () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    };
    socket.on("notification.created", onNewNotification);
    return () => {
      socket.off("notification.created", onNewNotification);
      releaseSocket();
    };
  }, [enabled, queryClient]);

  async function markRead(id: string) {
    await fetch(`/api/v1/notifications/${id}/read`, { method: "PATCH" });
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  async function markAllRead() {
    await fetch("/api/v1/notifications/read-all", { method: "POST" });
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  return {
    ...query,
    notifications: query.data?.data ?? [],
    unreadCount: query.data?.meta.unreadCount ?? 0,
    markRead,
    markAllRead,
  };
}

export function useProjectRealtime(projectId: string, enabled = true) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    if (!enabled || !projectId) return;
    const socket = acquireSocket();

    function joinRoom() {
      setConnected(true);
      socket.emit(
        "project:join",
        { projectId },
        (ack?: { ok: boolean; onlineUsers?: PresenceUser[] }) => {
          if (ack?.ok && Array.isArray(ack.onlineUsers)) {
            setOnlineUsers(ack.onlineUsers);
          }
        },
      );
    }

    function onDisconnect() {
      setConnected(false);
    }

    function onPresence(payload: { projectId: string; onlineUsers: PresenceUser[] }) {
      if (payload.projectId === projectId) {
        setOnlineUsers(payload.onlineUsers);
      }
    }

    function onBoardMutation() {
      void queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["task-detail"] });
    }

    function onCommentMutation(payload?: { taskId?: string }) {
      if (payload?.taskId) {
        void queryClient.invalidateQueries({ queryKey: ["task-comments", payload.taskId] });
        void queryClient.invalidateQueries({ queryKey: ["task-detail", payload.taskId] });
      }
      void queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] });
    }

    if (socket.connected) {
      joinRoom();
    }
    socket.on("connect", joinRoom);
    socket.on("disconnect", onDisconnect);
    socket.on("presence.updated", onPresence);
    socket.on("task.created", onBoardMutation);
    socket.on("task.updated", onBoardMutation);
    socket.on("task.moved", onBoardMutation);
    socket.on("task.deleted", onBoardMutation);
    socket.on("comment.created", onCommentMutation);
    socket.on("comment.updated", onCommentMutation);
    socket.on("comment.deleted", onCommentMutation);

    return () => {
      socket.emit("project:leave", { projectId });
      socket.off("connect", joinRoom);
      socket.off("disconnect", onDisconnect);
      socket.off("presence.updated", onPresence);
      socket.off("task.created", onBoardMutation);
      socket.off("task.updated", onBoardMutation);
      socket.off("task.moved", onBoardMutation);
      socket.off("task.deleted", onBoardMutation);
      socket.off("comment.created", onCommentMutation);
      socket.off("comment.updated", onCommentMutation);
      socket.off("comment.deleted", onCommentMutation);
      releaseSocket();
    };
  }, [projectId, enabled, queryClient]);

  return { connected, onlineUsers };
}
