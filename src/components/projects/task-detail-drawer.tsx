"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  GitBranch,
  Lock,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ColumnDto {
  id: string;
  name: string;
  category: "TODO" | "IN_PROGRESS" | "DONE";
  position: string;
}

export interface TagDto {
  id: string;
  name: string;
  color: string;
}

export interface MemberOptionDto {
  userId: string;
  name: string;
  email: string;
}

export interface TaskSummaryDto {
  id: string;
  key: string;
  number: number;
  columnId: string;
  columnCategory: "TODO" | "IN_PROGRESS" | "DONE";
  parentId: string | null;
  title: string;
  description: string | null;
  priority: "LOWEST" | "LOW" | "MEDIUM" | "HIGH" | "HIGHEST";
  position: string;
  version: number;
  assignee: { id: string; name: string; email: string } | null;
  reporter: { id: string; name: string; email: string };
  dueDate: string | null;
  completedAt: string | null;
  tags: TagDto[];
  subtaskCount: number;
  completedSubtaskCount: number;
  commentCount: number;
  attachmentCount: number;
  incompleteBlockerKeys: string[];
}

interface TaskDetailDto extends TaskSummaryDto {
  subtasks: Array<{
    id: string;
    key: string;
    title: string;
    columnId: string;
    columnCategory: "TODO" | "IN_PROGRESS" | "DONE";
    priority: TaskSummaryDto["priority"];
    version: number;
  }>;
  blockedBy: Array<{
    dependencyId: string;
    taskId: string;
    key: string;
    title: string;
    category: "TODO" | "IN_PROGRESS" | "DONE";
  }>;
  blocks: Array<{
    dependencyId: string;
    taskId: string;
    key: string;
    title: string;
    category: "TODO" | "IN_PROGRESS" | "DONE";
  }>;
  attachments: Array<{
    id: string;
    fileName: string;
    sizeBytes: number;
    uploaderName: string;
    createdAt: string;
  }>;
}

interface CommentDto {
  id: string;
  author: { id: string; name: string; email: string };
  body: string;
  editedAt: string | null;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TaskDetailDrawer({
  taskId,
  projectId,
  columns,
  tags,
  orgMembers,
  allTasks,
  currentUserId,
  canEdit,
  onClose,
  onMutated,
}: {
  taskId: string;
  projectId: string;
  columns: ColumnDto[];
  tags: TagDto[];
  orgMembers: MemberOptionDto[];
  allTasks: TaskSummaryDto[];
  currentUserId: string;
  canEdit: boolean;
  onClose: () => void;
  onMutated: () => Promise<void>;
}) {
  const t = useTranslations("Projects");
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [prereqTaskId, setPrereqTaskId] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [uploading, setUploading] = useState(false);

  const { data: task, isLoading } = useQuery<TaskDetailDto | null>({
    queryKey: ["task-detail", taskId],
    queryFn: async () => {
      const res = await fetch(`/api/v1/tasks/${taskId}`);
      if (!res.ok) return null;
      const json = (await res.json()) as { data: TaskDetailDto };
      return json.data;
    },
  });

  const { data: comments = [] } = useQuery<CommentDto[]>({
    queryKey: ["task-comments", taskId],
    queryFn: async () => {
      const res = await fetch(`/api/v1/tasks/${taskId}/comments`);
      if (!res.ok) return [];
      const json = (await res.json()) as { data: CommentDto[] };
      return json.data;
    },
  });

  async function refreshTask() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["task-detail", taskId] }),
      queryClient.invalidateQueries({ queryKey: ["task-comments", taskId] }),
      onMutated(),
    ]);
  }

  async function patchTask(patch: Record<string, unknown>) {
    if (!task) return;
    setError(null);
    const res = await fetch(`/api/v1/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...patch, version: task.version }),
    });
    const json = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setError(json.error?.message ?? t("errors.generic"));
      await queryClient.invalidateQueries({ queryKey: ["task-detail", taskId] });
      return;
    }
    await refreshTask();
  }

  async function handleAddSubtask(e: FormEvent) {
    e.preventDefault();
    if (!subtaskTitle.trim()) return;
    setError(null);
    const res = await fetch(`/api/v1/tasks/${taskId}/subtasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: subtaskTitle }),
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: { message: string } };
      setError(json.error?.message ?? t("errors.generic"));
      return;
    }
    setSubtaskTitle("");
    await refreshTask();
  }

  async function toggleSubtaskDone(sub: TaskDetailDto["subtasks"][number]) {
    const doneCol = columns.find((c) => c.category === "DONE");
    const todoCol = columns.find((c) => c.category === "TODO") ?? columns[0];
    if (!doneCol || !todoCol) return;
    const targetColId = sub.columnCategory === "DONE" ? todoCol.id : doneCol.id;

    await fetch(`/api/v1/tasks/${sub.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnId: targetColId, version: sub.version }),
    });
    await refreshTask();
  }

  async function handleAddDependency(e: FormEvent) {
    e.preventDefault();
    if (!prereqTaskId) return;
    setError(null);
    const res = await fetch(`/api/v1/tasks/${taskId}/dependencies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dependsOnTaskId: prereqTaskId }),
    });
    const json = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setError(json.error?.message ?? t("errors.generic"));
      return;
    }
    setPrereqTaskId("");
    await refreshTask();
  }

  async function handleRemoveDependency(depId: string) {
    await fetch(`/api/v1/tasks/${taskId}/dependencies/${depId}`, { method: "DELETE" });
    await refreshTask();
  }

  async function handleUploadFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/v1/tasks/${taskId}/attachments`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message: string } };
        setError(json.error?.message ?? t("errors.generic"));
        return;
      }
      await refreshTask();
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleDeleteAttachment(attId: string) {
    await fetch(`/api/v1/attachments/${attId}`, { method: "DELETE" });
    await refreshTask();
  }

  async function handlePostComment(e: FormEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    const res = await fetch(`/api/v1/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: commentBody }),
    });
    if (res.ok) {
      setCommentBody("");
      await refreshTask();
    }
  }

  async function handleDeleteComment(commentId: string) {
    await fetch(`/api/v1/comments/${commentId}`, { method: "DELETE" });
    await refreshTask();
  }

  async function handleDeleteTask() {
    if (!task) return;
    if (!window.confirm(t("confirmDeleteTask", { key: task.key }))) return;
    const res = await fetch(`/api/v1/tasks/${task.id}`, { method: "DELETE" });
    if (res.ok) {
      await onMutated();
      onClose();
    } else {
      const json = (await res.json()) as { error?: { message: string } };
      setError(json.error?.message ?? t("errors.generic"));
    }
  }

  void projectId;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/25 backdrop-blur-xs">
      <div className="flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl">
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="rounded-lg bg-blue-50 px-2.5 py-1 font-mono text-xs font-bold text-blue-700">
              {task?.key ?? "..."}
            </span>
            {task && <Badge variant="neutral">v{task.version}</Badge>}
            {task && task.incompleteBlockerKeys.length > 0 && (
              <Badge variant="error">
                <Lock className="h-3 w-3" />
                {t("blockedByBadge")}: {task.incompleteBlockerKeys.join(", ")}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canEdit && task && (
              <Button type="button" variant="ghost" size="sm" onClick={handleDeleteTask}>
                <Trash2 className="h-4 w-4 text-rose-600" />
              </Button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {isLoading || !task ? (
            <div className="space-y-3">
              <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-28 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : (
            <>
              {/* Title & Description */}
              <EditableTaskMain key={`${task.id}-${task.version}`} task={task} canEdit={canEdit} onSave={patchTask} />

              {/* Metadata Controls */}
              <div className="grid gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>{t("statusLabel")}</Label>
                  <select
                    disabled={!canEdit}
                    value={task.columnId}
                    onChange={(e) => patchTask({ columnId: e.target.value })}
                    className="flex h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900"
                  >
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.category})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label>{t("priorityLabel")}</Label>
                  <select
                    disabled={!canEdit}
                    value={task.priority}
                    onChange={(e) => patchTask({ priority: e.target.value })}
                    className="flex h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900"
                  >
                    {["LOWEST", "LOW", "MEDIUM", "HIGH", "HIGHEST"].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label>{t("assigneeLabel")}</Label>
                  <select
                    disabled={!canEdit}
                    value={task.assignee?.id ?? ""}
                    onChange={(e) =>
                      patchTask({ assigneeId: e.target.value ? e.target.value : null })
                    }
                    className="flex h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900"
                  >
                    <option value="">{t("unassigned")}</option>
                    {orgMembers.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label>{t("dueDateLabel")}</Label>
                  <input
                    type="date"
                    disabled={!canEdit}
                    value={task.dueDate ? task.dueDate.slice(0, 10) : ""}
                    onChange={(e) =>
                      patchTask({
                        dueDate: e.target.value ? new Date(e.target.value).toISOString() : null,
                      })
                    }
                    className="flex h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900"
                  />
                </div>

                {tags.length > 0 && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Tags</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tg) => {
                        const selected = task.tags.some((x) => x.id === tg.id);
                        return (
                          <button
                            key={tg.id}
                            type="button"
                            disabled={!canEdit}
                            onClick={() => {
                              const nextIds = selected
                                ? task.tags.filter((x) => x.id !== tg.id).map((x) => x.id)
                                : [...task.tags.map((x) => x.id), tg.id];
                              patchTask({ tagIds: nextIds });
                            }}
                            className={`cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-medium transition ${
                              selected
                                ? "text-white shadow-2xs"
                                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                            }`}
                            style={selected ? { backgroundColor: tg.color } : undefined}
                          >
                            {tg.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Subtasks Section */}
              {!task.parentId && (
                <section className="space-y-2.5">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {t("subtasksTitle")} ({task.completedSubtaskCount}/{task.subtaskCount})
                  </h3>
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {task.subtasks.map((sub) => {
                      const done = sub.columnCategory === "DONE";
                      return (
                        <div
                          key={sub.id}
                          className="flex items-center justify-between px-3.5 py-2.5 text-sm"
                        >
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => toggleSubtaskDone(sub)}
                            className="flex cursor-pointer items-center gap-2 text-left"
                          >
                            <CheckCircle2
                              className={`h-4 w-4 ${done ? "text-emerald-600" : "text-slate-300"}`}
                            />
                            <span className="font-mono text-xs text-slate-400">{sub.key}</span>
                            <span className={done ? "text-slate-400 line-through" : "text-slate-800"}>
                              {sub.title}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {canEdit && (
                    <form onSubmit={handleAddSubtask} className="flex gap-2">
                      <Input
                        placeholder={t("addSubtaskPlaceholder")}
                        value={subtaskTitle}
                        onChange={(e) => setSubtaskTitle(e.target.value)}
                      />
                      <Button type="submit" variant="outline" size="sm">
                        <Plus className="h-4 w-4" />
                        {t("addBtn")}
                      </Button>
                    </form>
                  )}
                </section>
              )}

              {/* Dependencies Section */}
              <section className="space-y-2.5">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <GitBranch className="h-4 w-4 text-blue-600" />
                  {t("dependenciesTitle")}
                </h3>

                {task.blockedBy.length > 0 && (
                  <div className="space-y-1.5">
                    {task.blockedBy.map((dep) => (
                      <div
                        key={dep.dependencyId}
                        className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant={dep.category === "DONE" ? "ok" : "warn"}>
                            {dep.category}
                          </Badge>
                          <span className="font-mono font-semibold text-blue-600">{dep.key}</span>
                          <span className="text-slate-700">{dep.title}</span>
                        </div>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => handleRemoveDependency(dep.dependencyId)}
                            className="text-slate-400 hover:text-rose-600"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {canEdit && (
                  <form onSubmit={handleAddDependency} className="flex gap-2">
                    <select
                      value={prereqTaskId}
                      onChange={(e) => setPrereqTaskId(e.target.value)}
                      className="flex h-9 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800"
                    >
                      <option value="">{t("selectPrerequisitePlaceholder")}</option>
                      {allTasks
                        .filter(
                          (cand) =>
                            cand.id !== task.id &&
                            !task.blockedBy.some((b) => b.taskId === cand.id),
                        )
                        .map((cand) => (
                          <option key={cand.id} value={cand.id}>
                            {cand.key} — {cand.title}
                          </option>
                        ))}
                    </select>
                    <Button type="submit" variant="outline" size="sm" disabled={!prereqTaskId}>
                      {t("linkDependencyBtn")}
                    </Button>
                  </form>
                )}
              </section>

              {/* Attachments Section */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    <Paperclip className="h-4 w-4 text-slate-500" />
                    {t("attachmentsTitle")} ({task.attachments.length})
                  </h3>
                  {canEdit && (
                    <label className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      {uploading ? t("saving") : t("uploadFileBtn")}
                      <input type="file" className="hidden" onChange={handleUploadFile} />
                    </label>
                  )}
                </div>
                {task.attachments.length > 0 && (
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {task.attachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between px-3.5 py-2.5 text-xs"
                      >
                        <div>
                          <span className="font-medium text-slate-800">{att.fileName}</span>
                          <span className="ml-2 text-slate-400">
                            ({formatBytes(att.sizeBytes)})
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <a
                            href={`/api/v1/attachments/${att.id}`}
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAttachment(att.id)}
                              className="text-slate-400 hover:text-rose-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Comments Section */}
              <section className="space-y-3">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <MessageSquare className="h-4 w-4 text-slate-500" />
                  {t("commentsTitle")} ({comments.length})
                </h3>

                <form onSubmit={handlePostComment} className="flex gap-2">
                  <Input
                    placeholder={t("commentPlaceholder")}
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                  />
                  <Button type="submit" size="sm" disabled={!commentBody.trim()}>
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </form>

                <div className="space-y-2.5">
                  {comments.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 text-sm"
                    >
                      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                        <span className="font-semibold text-slate-800">{c.author.name}</span>
                        {c.author.id === currentUserId && (
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(c.id)}
                            className="text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap text-slate-700">{c.body}</p>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EditableTaskMain({
  task,
  canEdit,
  onSave,
}: {
  task: TaskDetailDto;
  canEdit: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const t = useTranslations("Projects");
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const dirty = title !== task.title || description !== (task.description ?? "");

  return (
    <div className="space-y-3">
      <Input
        value={title}
        disabled={!canEdit}
        onChange={(e) => setTitle(e.target.value)}
        className="text-base font-semibold"
      />
      <textarea
        rows={3}
        disabled={!canEdit}
        placeholder={t("taskDescPlaceholder")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/10"
      />
      {canEdit && dirty && (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() => onSave({ title, description: description || null })}
          >
            {t("saveChanges")}
          </Button>
        </div>
      )}
    </div>
  );
}
