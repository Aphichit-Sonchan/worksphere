"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  Archive,
  ArchiveRestore,
  BarChart3,
  Calendar,
  CheckSquare,
  Download,
  Kanban,
  ListFilter,
  Lock,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Settings,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type DragEvent, type FormEvent } from "react";
import {
  TaskDetailDrawer,
  type ColumnDto,
  type MemberOptionDto,
  type TagDto,
  type TaskSummaryDto,
} from "@/components/projects/task-detail-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useProjectRealtime } from "@/hooks/use-realtime";
import { Link } from "@/i18n/navigation";
import { comparePositions } from "@/lib/ordering/fractional-index";

interface ProjectOverviewDto {
  project: {
    id: string;
    orgId: string;
    workspaceId: string;
    workspaceName: string;
    key: string;
    name: string;
    description: string | null;
    archivedAt: string | null;
  };
  myProjectRole: "PROJECT_MANAGER" | "MEMBER" | "VIEWER";
  columns: ColumnDto[];
  tags: TagDto[];
  members: Array<{
    userId: string;
    name: string;
    email: string;
    role: "PROJECT_MANAGER" | "MEMBER" | "VIEWER";
  }>;
}

const PRIORITY_STYLE: Record<TaskSummaryDto["priority"], string> = {
  HIGHEST: "bg-rose-50 text-rose-700 ring-rose-600/20",
  HIGH: "bg-amber-50 text-amber-700 ring-amber-600/20",
  MEDIUM: "bg-blue-50 text-blue-700 ring-blue-600/20",
  LOW: "bg-slate-100 text-slate-600 ring-slate-500/15",
  LOWEST: "bg-slate-50 text-slate-500 ring-slate-400/15",
};

const CATEGORY_DOT: Record<ColumnDto["category"], string> = {
  TODO: "bg-slate-400",
  IN_PROGRESS: "bg-blue-600",
  DONE: "bg-emerald-600",
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default function ProjectWorkspacePage() {
  const t = useTranslations("Projects");
  const tr = useTranslations("Realtime");
  const ta = useTranslations("Analytics");
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [tab, setTab] = useState<"board" | "list" | "analytics" | "activity" | "settings">("board");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);

  // Create Task Modal/Panel
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newColId, setNewColId] = useState("");
  const [newPriority, setNewPriority] = useState<TaskSummaryDto["priority"]>("MEDIUM");
  const [newAssigneeId, setNewAssigneeId] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);

  // Drag state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  // List & Filter state (WS-405)
  const [q, setQ] = useState("");
  const [filterCol, setFilterCol] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [sortBy, setSortBy] = useState("position:asc");

  // Settings Tab state
  const [newColName, setNewColName] = useState("");
  const [newColCategory, setNewColCategory] = useState<ColumnDto["category"]>("IN_PROGRESS");
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#2563eb");
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<"PROJECT_MANAGER" | "MEMBER" | "VIEWER">("MEMBER");

  const { data: overview, isLoading } = useQuery<ProjectOverviewDto | null>({
    queryKey: ["project-overview", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/v1/projects/${projectId}`);
      if (!res.ok) return null;
      const json = (await res.json()) as { data: ProjectOverviewDto };
      return json.data;
    },
  });

  const orgId = overview?.project.orgId ?? "";

  const { data: orgMembers = [] } = useQuery<MemberOptionDto[]>({
    queryKey: ["org-members", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const res = await fetch(`/api/v1/organizations/${orgId}/members`);
      const json = (await res.json()) as { data: MemberOptionDto[] };
      return res.ok ? json.data : [];
    },
  });

  const queryParams = new URLSearchParams({ limit: "100", sort: sortBy });
  if (q.trim()) queryParams.set("q", q.trim());
  if (filterCol) queryParams.set("columnId", filterCol);
  if (filterPriority) queryParams.set("priority", filterPriority);
  if (filterAssignee) queryParams.set("assigneeId", filterAssignee);
  if (filterTag) queryParams.set("tagId", filterTag);

  const { data: taskResp } = useQuery<{
    data: TaskSummaryDto[];
    meta: { nextCursor: string | null; hasMore: boolean };
  }>({
    queryKey: ["project-tasks", projectId, queryParams.toString()],
    enabled: Boolean(overview),
    queryFn: async () => {
      const res = await fetch(`/api/v1/projects/${projectId}/tasks?${queryParams.toString()}`);
      return res.json();
    },
  });

  const tasks = taskResp?.data ?? [];
  const { connected: liveConnected, onlineUsers } = useProjectRealtime(
    projectId,
    Boolean(overview),
  );

  const { data: activityResp } = useQuery<{
    data: Array<{
      id: string;
      action: string;
      metadata: Record<string, unknown> | null;
      actor: { id: string; name: string; email: string };
      createdAt: string;
    }>;
  }>({
    queryKey: ["project-activity", projectId],
    enabled: Boolean(overview && tab === "activity"),
    queryFn: async () => {
      const res = await fetch(`/api/v1/projects/${projectId}/activity`);
      return res.json();
    },
  });
  const activities = activityResp?.data ?? [];

  const { data: analyticsResp } = useQuery<{
    data: {
      totals: {
        totalTasks: number;
        completedTasks: number;
        openTasks: number;
        overdueTasks: number;
        completionRate: number;
      };
      byStatus: Array<{
        columnId: string;
        name: string;
        category: "TODO" | "IN_PROGRESS" | "DONE";
        count: number;
        percentage: number;
      }>;
      byPriority: Array<{
        priority: TaskSummaryDto["priority"];
        count: number;
        percentage: number;
      }>;
      byAssignee: Array<{
        userId: string | null;
        name: string;
        total: number;
        completed: number;
        open: number;
      }>;
    };
  }>({
    queryKey: ["project-analytics", projectId],
    enabled: Boolean(overview && tab === "analytics"),
    queryFn: async () => {
      const res = await fetch(`/api/v1/projects/${projectId}/analytics`);
      return res.json();
    },
  });
  const analytics = analyticsResp?.data;

  async function refreshBoard() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["project-overview", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["project-analytics", projectId] }),
    ]);
  }

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-96 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        ))}
      </div>
    );
  }

  if (!overview || !user) {
    return (
      <Card className="py-10 text-center">
        <p className="text-slate-600">{t("projectNotFound")}</p>
      </Card>
    );
  }

  const { project, columns, tags, members, myProjectRole } = overview;
  const isArchived = Boolean(project.archivedAt);
  const canEdit = !isArchived && (myProjectRole === "PROJECT_MANAGER" || myProjectRole === "MEMBER");
  const isManager = myProjectRole === "PROJECT_MANAGER";

  async function handleCreateTask(e: FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreatingTask(true);
    setBannerError(null);

    try {
      const res = await fetch(`/api/v1/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          columnId: newColId || columns[0]?.id,
          priority: newPriority,
          assigneeId: newAssigneeId || null,
        }),
      });
      const json = (await res.json()) as { error?: { message: string } };
      if (!res.ok) {
        setBannerError(json.error?.message ?? t("errors.generic"));
        return;
      }
      setNewTitle("");
      setShowCreateTask(false);
      await refreshBoard();
    } finally {
      setCreatingTask(false);
    }
  }

  async function executeMove(
    taskId: string,
    targetColumnId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null,
  ) {
    setBannerError(null);
    const dragged = tasks.find((tItem) => tItem.id === taskId);
    if (!dragged) return;

    const res = await fetch(`/api/v1/tasks/${taskId}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        columnId: targetColumnId,
        beforeTaskId,
        afterTaskId,
        version: dragged.version,
      }),
    });

    if (!res.ok) {
      const json = (await res.json()) as { error?: { message: string } };
      setBannerError(json.error?.message ?? t("errors.generic"));
    }
    await refreshBoard();
  }

  function handleDropOnColumn(e: DragEvent, columnId: string) {
    e.preventDefault();
    setDragOverColId(null);
    const taskId = e.dataTransfer.getData("text/task-id") || draggingId;
    setDraggingId(null);
    if (!taskId || !canEdit) return;

    const colTasks = tasks
      .filter((x) => x.columnId === columnId && x.id !== taskId)
      .sort((a, b) => comparePositions(a.position, b.position));
    const lastInCol = colTasks.at(-1)?.id ?? null;
    void executeMove(taskId, columnId, lastInCol, null);
  }

  function handleDropBeforeCard(e: DragEvent, targetCard: TaskSummaryDto) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverColId(null);
    const taskId = e.dataTransfer.getData("text/task-id") || draggingId;
    setDraggingId(null);
    if (!taskId || taskId === targetCard.id || !canEdit) return;

    const colTasks = tasks
      .filter((x) => x.columnId === targetCard.columnId && x.id !== taskId)
      .sort((a, b) => comparePositions(a.position, b.position));
    const idx = colTasks.findIndex((x) => x.id === targetCard.id);
    const prevCard = idx > 0 ? colTasks[idx - 1]! : null;
    void executeMove(taskId, targetCard.columnId, prevCard?.id ?? null, targetCard.id);
  }

  async function handleAddColumn(e: FormEvent) {
    e.preventDefault();
    if (!newColName.trim()) return;
    await fetch(`/api/v1/projects/${projectId}/columns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newColName, category: newColCategory }),
    });
    setNewColName("");
    await refreshBoard();
  }

  async function handleAddTag(e: FormEvent) {
    e.preventDefault();
    if (!newTagName.trim()) return;
    await fetch(`/api/v1/projects/${projectId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTagName, color: newTagColor }),
    });
    setNewTagName("");
    await refreshBoard();
  }

  async function handleAddMember(e: FormEvent) {
    e.preventDefault();
    if (!memberUserId) return;
    await fetch(`/api/v1/projects/${projectId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: memberUserId, role: memberRole }),
    });
    setMemberUserId("");
    await refreshBoard();
  }

  async function handleToggleArchive() {
    await fetch(`/api/v1/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !isArchived }),
    });
    await refreshBoard();
  }

  return (
    <div className="space-y-5">
      {/* Project Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Link href="/app/projects" className="hover:text-blue-600 hover:underline">
              {t("directoryTitle")}
            </Link>
            <span>/</span>
            <span>{project.workspaceName}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <span className="rounded-lg bg-blue-600 px-2.5 py-1 font-mono text-xs font-bold text-white">
              {project.key}
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{project.name}</h1>
            <Badge variant={isArchived ? "warn" : "info"}>{myProjectRole}</Badge>
            {liveConnected && (
              <Badge variant="ok">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {tr("liveConnected")}
              </Badge>
            )}
            {onlineUsers.length > 0 && (
              <div className="flex items-center -space-x-1.5 pl-1">
                {onlineUsers.slice(0, 5).map((ou) => (
                  <span
                    key={ou.userId}
                    title={`${ou.name} (${tr("onlineNow")})`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-emerald-600 text-[10px] font-bold text-white shadow-2xs"
                  >
                    {initials(ou.name)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* View Tabs */}
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setTab("board")}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                tab === "board" ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Kanban className="h-3.5 w-3.5" />
              {t("tabs.board")}
            </button>
            <button
              type="button"
              onClick={() => setTab("list")}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                tab === "list" ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <ListFilter className="h-3.5 w-3.5" />
              {t("tabs.list")}
            </button>
            <button
              type="button"
              onClick={() => setTab("analytics")}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                tab === "analytics"
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              {ta("tab")}
            </button>
            <button
              type="button"
              onClick={() => setTab("activity")}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                tab === "activity"
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              {tr("activityTab")}
            </button>
            <button
              type="button"
              onClick={() => setTab("settings")}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                tab === "settings"
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Settings className="h-3.5 w-3.5" />
              {t("tabs.settings")}
            </button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              const res = await fetch(`/api/v1/projects/${projectId}/exports`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ format: "csv" }),
              });
              const json = (await res.json()) as { data?: { downloadUrl: string } };
              if (res.ok && json.data?.downloadUrl) {
                window.location.assign(json.data.downloadUrl);
              }
            }}
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>

          {canEdit && (
            <Button size="sm" onClick={() => setShowCreateTask((v) => !v)}>
              <Plus className="h-4 w-4" />
              {t("newTaskBtn")}
            </Button>
          )}
        </div>
      </div>

      {bannerError && (
        <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            {bannerError}
          </span>
          <button
            type="button"
            onClick={() => setBannerError(null)}
            className="text-xs font-semibold underline"
          >
            OK
          </button>
        </div>
      )}

      {/* Quick Create Task Panel */}
      {showCreateTask && canEdit && (
        <Card className="border-blue-200 p-5">
          <form onSubmit={handleCreateTask} className="grid gap-3 sm:grid-cols-12">
            <div className="sm:col-span-5">
              <Input
                placeholder={t("newTaskTitlePlaceholder")}
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <select
                value={newColId || columns[0]?.id || ""}
                onChange={(e) => setNewColId(e.target.value)}
                className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800"
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as TaskSummaryDto["priority"])}
                className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800"
              >
                {["LOWEST", "LOW", "MEDIUM", "HIGH", "HIGHEST"].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3 flex gap-2">
              <select
                value={newAssigneeId}
                onChange={(e) => setNewAssigneeId(e.target.value)}
                className="flex h-10 flex-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs text-slate-800"
              >
                <option value="">{t("unassigned")}</option>
                {orgMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
              <Button type="submit" size="default" disabled={creatingTask}>
                {t("addBtn")}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Search & Filter Toolbar (Shared by Board & List) */}
      {(tab === "board" || tab === "list") && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-slate-200/80 bg-white p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <Input
              placeholder={t("searchTasksPlaceholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 pl-9 text-xs"
            />
          </div>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700"
          >
            <option value="">{t("allPriorities")}</option>
            {["HIGHEST", "HIGH", "MEDIUM", "LOW", "LOWEST"].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={filterAssignee}
            onChange={(e) => setFilterAssignee(e.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700"
          >
            <option value="">{t("allAssignees")}</option>
            <option value="unassigned">{t("unassigned")}</option>
            {orgMembers.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
          {tags.length > 0 && (
            <select
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700"
            >
              <option value="">{t("allTags")}</option>
              {tags.map((tg) => (
                <option key={tg.id} value={tg.id}>
                  {tg.name}
                </option>
              ))}
            </select>
          )}
          {tab === "list" && (
            <>
              <select
                value={filterCol}
                onChange={(e) => setFilterCol(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700"
              >
                <option value="">{t("allStatuses")}</option>
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700"
              >
                <option value="position:asc">{t("sorts.board")}</option>
                <option value="createdAt:desc">{t("sorts.newest")}</option>
                <option value="dueDate:asc">{t("sorts.dueDate")}</option>
                <option value="priority:desc">{t("sorts.priority")}</option>
              </select>
            </>
          )}
        </div>
      )}

      {/* TAB 1: KANBAN BOARD */}
      {tab === "board" && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((col) => {
            const colTasks = tasks
              .filter((x) => x.columnId === col.id)
              .sort((a, b) => comparePositions(a.position, b.position));
            const isOver = dragOverColId === col.id;

            return (
              <div
                key={col.id}
                onDragOver={(e) => {
                  if (!canEdit) return;
                  e.preventDefault();
                  setDragOverColId(col.id);
                }}
                onDragLeave={() => setDragOverColId(null)}
                onDrop={(e) => handleDropOnColumn(e, col.id)}
                className={`flex min-h-[460px] w-80 shrink-0 flex-col rounded-2xl border p-3 transition ${
                  isOver
                    ? "border-blue-400 bg-blue-50/40 ring-2 ring-blue-500/15"
                    : "border-slate-200/90 bg-slate-100/70"
                }`}
              >
                <div className="mb-3 flex items-center justify-between px-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${CATEGORY_DOT[col.category]}`} />
                    <span className="text-sm font-semibold text-slate-800">{col.name}</span>
                  </div>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/80">
                    {colTasks.length}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-2.5">
                  {colTasks.map((card) => (
                    <div
                      key={card.id}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        setDraggingId(card.id);
                        e.dataTransfer.setData("text/task-id", card.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverColId(null);
                      }}
                      onDragOver={(e) => {
                        if (canEdit) e.preventDefault();
                      }}
                      onDrop={(e) => handleDropBeforeCard(e, card)}
                      onClick={() => setActiveTaskId(card.id)}
                      className={`group cursor-pointer rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-2xs transition hover:border-blue-300 hover:shadow-sm ${
                        draggingId === card.id ? "opacity-50" : ""
                      }`}
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-blue-600">
                          {card.key}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${PRIORITY_STYLE[card.priority]}`}
                        >
                          {card.priority}
                        </span>
                      </div>

                      <p className="text-sm font-semibold leading-snug text-slate-900">
                        {card.title}
                      </p>

                      {card.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {card.tags.map((tg) => (
                            <span
                              key={tg.id}
                              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                              style={{ backgroundColor: tg.color }}
                            >
                              {tg.name}
                            </span>
                          ))}
                        </div>
                      )}

                      {card.incompleteBlockerKeys.length > 0 && (
                        <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
                          <Lock className="h-3 w-3" />
                          <span>{card.incompleteBlockerKeys.join(", ")}</span>
                        </div>
                      )}

                      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
                        <div className="flex items-center gap-2.5">
                          {card.subtaskCount > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <CheckSquare className="h-3.5 w-3.5" />
                              {card.completedSubtaskCount}/{card.subtaskCount}
                            </span>
                          )}
                          {card.commentCount > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <MessageSquare className="h-3.5 w-3.5" />
                              {card.commentCount}
                            </span>
                          )}
                          {card.attachmentCount > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Paperclip className="h-3.5 w-3.5" />
                              {card.attachmentCount}
                            </span>
                          )}
                          {card.dueDate && (
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              {card.dueDate.slice(5, 10)}
                            </span>
                          )}
                        </div>

                        {card.assignee && (
                          <span
                            title={card.assignee.name}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white"
                          >
                            {initials(card.assignee.name)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 2: TASK LIST VIEW */}
      {tab === "list" && (
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-slate-100">
            {tasks.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">{t("noTasksMatch")}</div>
            ) : (
              tasks.map((row) => {
                const col = columns.find((c) => c.id === row.columnId);
                return (
                  <div
                    key={row.id}
                    onClick={() => setActiveTaskId(row.id)}
                    className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition hover:bg-slate-50"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="font-mono text-xs font-bold text-blue-600">{row.key}</span>
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {row.title}
                      </span>
                      {row.incompleteBlockerKeys.length > 0 && (
                        <Badge variant="error">
                          <Lock className="h-3 w-3" />
                          {row.incompleteBlockerKeys.join(", ")}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5 text-xs">
                      <Badge variant="neutral">{col?.name ?? "-"}</Badge>
                      <span
                        className={`rounded-full px-2.5 py-0.5 font-semibold ring-1 ring-inset ${PRIORITY_STYLE[row.priority]}`}
                      >
                        {row.priority}
                      </span>
                      <span className="text-slate-500">
                        {row.assignee?.name ?? t("unassigned")}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      )}

      {/* TAB 2.25: PROJECT ANALYTICS (WS-705) */}
      {tab === "analytics" && analytics && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-5">
              <span className="text-xs font-semibold text-slate-500">{ta("totalTasks")}</span>
              <div className="mt-2 text-3xl font-bold text-slate-900">
                {analytics.totals.totalTasks}
              </div>
            </Card>
            <Card className="p-5">
              <span className="text-xs font-semibold text-slate-500">{ta("completedTasks")}</span>
              <div className="mt-2 text-3xl font-bold text-emerald-700">
                {analytics.totals.completedTasks}
              </div>
            </Card>
            <Card className="p-5">
              <span className="text-xs font-semibold text-slate-500">{ta("overdueTasks")}</span>
              <div className="mt-2 text-3xl font-bold text-rose-600">
                {analytics.totals.overdueTasks}
              </div>
            </Card>
            <Card className="p-5">
              <span className="text-xs font-semibold text-slate-500">{ta("completionRate")}</span>
              <div className="mt-2 text-3xl font-bold text-blue-700">
                {analytics.totals.completionRate}%
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all"
                  style={{ width: `${analytics.totals.completionRate}%` }}
                />
              </div>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{ta("byStatusTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {analytics.byStatus.map((row) => (
                  <div key={row.columnId} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                      <span className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${CATEGORY_DOT[row.category]}`} />
                        {row.name}
                      </span>
                      <span>
                        {row.count} ({row.percentage}%)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-blue-600"
                        style={{ width: `${row.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{ta("byPriorityTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {analytics.byPriority.map((row) => (
                  <div key={row.priority} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                      <span>{row.priority}</span>
                      <span>
                        {row.count} ({row.percentage}%)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width: `${row.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-slate-200 px-6 py-4">
              <CardTitle>{ta("byAssigneeTitle")}</CardTitle>
            </div>
            <div className="divide-y divide-slate-100">
              {analytics.byAssignee.map((row) => (
                <div
                  key={row.userId ?? "unassigned"}
                  className="flex items-center justify-between px-6 py-3 text-sm"
                >
                  <span className="font-semibold text-slate-900">
                    {row.userId ? row.name : ta("unassigned")}
                  </span>
                  <div className="flex items-center gap-3 text-xs">
                    <Badge variant="ok">
                      {ta("completedTasks")}: {row.completed}
                    </Badge>
                    <Badge variant="neutral">
                      {ta("openTasks")}: {row.open}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* TAB 2.5: PROJECT ACTIVITY LOG (WS-503) */}
      {tab === "activity" && (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-slate-100">
            {activities.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">{tr("emptyActivity")}</div>
            ) : (
              activities.map((act) => (
                <div
                  key={act.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">
                      {initials(act.actor.name)}
                    </span>
                    <div>
                      <span className="font-semibold text-slate-900">{act.actor.name}</span>{" "}
                      <Badge variant="neutral" className="mx-1 font-mono text-[11px]">
                        {act.action}
                      </Badge>
                      {typeof act.metadata?.key === "string" && (
                        <span className="font-mono text-xs font-semibold text-blue-600">
                          {act.metadata.key}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-slate-400">
                    {new Date(act.createdAt).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      {/* TAB 3: PROJECT MEMBERS, COLUMNS, TAGS & ARCHIVE */}
      {tab === "settings" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{t("projectMembersTitle")}</CardTitle>
                <CardDescription>{t("projectMembersDesc")}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {isManager && (
                <form onSubmit={handleAddMember} className="flex flex-wrap gap-2">
                  <select
                    value={memberUserId}
                    onChange={(e) => setMemberUserId(e.target.value)}
                    className="flex h-9 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800"
                  >
                    <option value="">{t("chooseMemberPlaceholder")}</option>
                    {orgMembers.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name} ({m.email})
                      </option>
                    ))}
                  </select>
                  <select
                    value={memberRole}
                    onChange={(e) =>
                      setMemberRole(e.target.value as "PROJECT_MANAGER" | "MEMBER" | "VIEWER")
                    }
                    className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs"
                  >
                    <option value="MEMBER">MEMBER</option>
                    <option value="PROJECT_MANAGER">PROJECT_MANAGER</option>
                    <option value="VIEWER">VIEWER</option>
                  </select>
                  <Button type="submit" size="sm" disabled={!memberUserId}>
                    <UserPlus className="h-3.5 w-3.5" />
                    {t("addBtn")}
                  </Button>
                </form>
              )}

              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {members.map((m) => (
                  <div
                    key={m.userId}
                    className="flex items-center justify-between px-3.5 py-2.5 text-sm"
                  >
                    <div>
                      <span className="font-semibold text-slate-900">{m.name}</span>
                      <span className="ml-2 text-xs text-slate-400">{m.email}</span>
                    </div>
                    <Badge variant="info">{m.role}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            {isManager && (
              <Card>
                <CardHeader>
                  <CardTitle>{t("columnsAndTagsTitle")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form onSubmit={handleAddColumn} className="flex gap-2">
                    <Input
                      placeholder={t("newColumnPlaceholder")}
                      value={newColName}
                      onChange={(e) => setNewColName(e.target.value)}
                    />
                    <select
                      value={newColCategory}
                      onChange={(e) => setNewColCategory(e.target.value as ColumnDto["category"])}
                      className="h-10 rounded-xl border border-slate-200 bg-white px-2.5 text-xs"
                    >
                      <option value="TODO">TODO</option>
                      <option value="IN_PROGRESS">IN_PROGRESS</option>
                      <option value="DONE">DONE</option>
                    </select>
                    <Button type="submit" variant="outline" size="default">
                      {t("addBtn")}
                    </Button>
                  </form>

                  <form onSubmit={handleAddTag} className="flex gap-2">
                    <Input
                      placeholder={t("newTagPlaceholder")}
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                    />
                    <input
                      type="color"
                      value={newTagColor}
                      onChange={(e) => setNewTagColor(e.target.value)}
                      className="h-10 w-12 cursor-pointer rounded-xl border border-slate-200 bg-white p-1"
                    />
                    <Button type="submit" variant="outline" size="default">
                      {t("addBtn")}
                    </Button>
                  </form>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {tags.map((tg) => (
                      <span
                        key={tg.id}
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white"
                        style={{ backgroundColor: tg.color }}
                      >
                        {tg.name}
                        <button
                          type="button"
                          onClick={async () => {
                            await fetch(`/api/v1/projects/${projectId}/tags/${tg.id}`, {
                              method: "DELETE",
                            });
                            await refreshBoard();
                          }}
                        >
                          <Trash2 className="h-3 w-3 opacity-80 hover:opacity-100" />
                        </button>
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {isManager && (
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>{t("lifecycleTitle")}</CardTitle>
                    <CardDescription>{t("lifecycleDesc")}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" size="sm" onClick={handleToggleArchive}>
                    {isArchived ? (
                      <>
                        <ArchiveRestore className="h-4 w-4" />
                        {t("restoreProjectBtn")}
                      </>
                    ) : (
                      <>
                        <Archive className="h-4 w-4" />
                        {t("archiveProjectBtn")}
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Slide-over Task Drawer */}
      {activeTaskId && (
        <TaskDetailDrawer
          taskId={activeTaskId}
          projectId={projectId}
          columns={columns}
          tags={tags}
          orgMembers={orgMembers}
          allTasks={tasks}
          currentUserId={user.id}
          canEdit={canEdit}
          onClose={() => setActiveTaskId(null)}
          onMutated={refreshBoard}
        />
      )}
    </div>
  );
}
