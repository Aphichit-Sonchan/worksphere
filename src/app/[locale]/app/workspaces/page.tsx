"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Layers, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toSlug, useOrganizations } from "@/hooks/use-tenancy";

interface WorkspaceDto {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description: string | null;
  archivedAt: string | null;
  memberCount: number;
  projectCount: number;
}

interface OrgMemberDto {
  userId: string;
  email: string;
  name: string;
  role: "ORG_OWNER" | "ORG_ADMIN" | "MEMBER";
}

interface WorkspaceMemberDto {
  userId: string;
  email: string;
  name: string;
  role: "WORKSPACE_ADMIN" | "MEMBER";
}

export default function WorkspacesPage() {
  const t = useTranslations("Tenancy");
  const queryClient = useQueryClient();
  const { activeOrg, refreshOrganizations } = useOrganizations();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [selectedWsId, setSelectedWsId] = useState<string | null>(null);
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<"WORKSPACE_ADMIN" | "MEMBER">("MEMBER");

  const orgId = activeOrg?.id ?? "";
  const canManage = activeOrg?.role === "ORG_OWNER" || activeOrg?.role === "ORG_ADMIN";

  const { data: workspaces = [], isLoading } = useQuery<WorkspaceDto[]>({
    queryKey: ["workspaces", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const res = await fetch(`/api/v1/organizations/${orgId}/workspaces`);
      const json = (await res.json()) as { data: WorkspaceDto[] };
      return res.ok ? json.data : [];
    },
  });

  const { data: orgMembers = [] } = useQuery<OrgMemberDto[]>({
    queryKey: ["org-members", orgId],
    enabled: Boolean(orgId && selectedWsId && canManage),
    queryFn: async () => {
      const res = await fetch(`/api/v1/organizations/${orgId}/members`);
      const json = (await res.json()) as { data: OrgMemberDto[] };
      return res.ok ? json.data : [];
    },
  });

  const { data: wsMembers = [] } = useQuery<WorkspaceMemberDto[]>({
    queryKey: ["ws-members", selectedWsId],
    enabled: Boolean(selectedWsId),
    queryFn: async () => {
      const res = await fetch(`/api/v1/workspaces/${selectedWsId}/members`);
      const json = (await res.json()) as { data: WorkspaceMemberDto[] };
      return res.ok ? json.data : [];
    },
  });

  if (!activeOrg) return null;

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/organizations/${orgId}/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, description: description || undefined }),
      });
      const json = (await res.json()) as { error?: { message: string } };
      if (!res.ok) {
        setError(json.error?.message ?? t("errors.generic"));
        return;
      }
      setName("");
      setSlug("");
      setDescription("");
      setShowCreate(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspaces", orgId] }),
        refreshOrganizations(),
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleArchive(ws: WorkspaceDto) {
    await fetch(`/api/v1/workspaces/${ws.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !ws.archivedAt }),
    });
    await queryClient.invalidateQueries({ queryKey: ["workspaces", orgId] });
  }

  async function handleAddWsMember(e: FormEvent) {
    e.preventDefault();
    if (!selectedWsId || !addUserId) return;
    await fetch(`/api/v1/workspaces/${selectedWsId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: addUserId, role: addRole }),
    });
    setAddUserId("");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["ws-members", selectedWsId] }),
      queryClient.invalidateQueries({ queryKey: ["workspaces", orgId] }),
    ]);
  }

  async function handleRemoveWsMember(userId: string) {
    if (!selectedWsId) return;
    await fetch(`/api/v1/workspaces/${selectedWsId}/members/${userId}`, {
      method: "DELETE",
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["ws-members", selectedWsId] }),
      queryClient.invalidateQueries({ queryKey: ["workspaces", orgId] }),
    ]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {t("workspacesTitle")}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{t("workspacesDesc")}</p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-4 w-4" />
            {t("newWorkspaceBtn")}
          </Button>
        )}
      </div>

      {showCreate && canManage && (
        <Card className="border-blue-200">
          <CardHeader>
            <div>
              <CardTitle>{t("newWorkspaceBtn")}</CardTitle>
              <CardDescription>{t("workspaceFormDesc")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm text-rose-700 sm:col-span-2">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="ws-name">{t("wsNameLabel")}</Label>
                <Input
                  id="ws-name"
                  placeholder="Engineering"
                  required
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSlug(toSlug(e.target.value));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-slug">Slug</Label>
                <Input
                  id="ws-slug"
                  placeholder="engineering"
                  required
                  value={slug}
                  onChange={(e) => setSlug(toSlug(e.target.value))}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ws-desc">{t("wsDescLabel")}</Label>
                <Input
                  id="ws-desc"
                  placeholder={t("wsDescPlaceholder")}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                  {t("cancel")}
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? t("creating") : t("createWorkspaceAction")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          <div className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {workspaces.map((ws) => {
            const isSelected = selectedWsId === ws.id;
            return (
              <Card
                key={ws.id}
                className={isSelected ? "border-blue-400 ring-2 ring-blue-500/15" : ""}
              >
                <CardHeader className="mb-2">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      <Layers className="h-4 w-4" />
                    </span>
                    <div>
                      <CardTitle>{ws.name}</CardTitle>
                      <p className="text-xs text-slate-400">/{ws.slug}</p>
                    </div>
                  </div>
                  <Badge variant={ws.archivedAt ? "warn" : "ok"}>
                    {ws.archivedAt ? t("archived") : t("active")}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-slate-600">
                    {ws.description || t("noDescription")}
                  </p>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <span>
                      {ws.memberCount} {t("membersUnit")} • {ws.projectCount} {t("projectsUnit")}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedWsId(isSelected ? null : ws.id)}
                      >
                        <Users className="h-3.5 w-3.5" />
                        {t("membersBtn")}
                      </Button>
                      {canManage && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleArchive(ws)}
                        >
                          {ws.archivedAt ? (
                            <ArchiveRestore className="h-3.5 w-3.5" />
                          ) : (
                            <Archive className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Workspace Member Management Panel */}
      {selectedWsId && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t("wsMembersPanelTitle")}</CardTitle>
              <CardDescription>{t("wsMembersPanelDesc")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {canManage && (
              <form onSubmit={handleAddWsMember} className="flex flex-wrap items-end gap-3">
                <div className="min-w-[220px] flex-1 space-y-1">
                  <Label htmlFor="ws-member-select">{t("selectOrgMember")}</Label>
                  <select
                    id="ws-member-select"
                    value={addUserId}
                    onChange={(e) => setAddUserId(e.target.value)}
                    className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                  >
                    <option value="">{t("chooseMemberPlaceholder")}</option>
                    {orgMembers.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name} ({m.email})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ws-role-select">Role</Label>
                  <select
                    id="ws-role-select"
                    value={addRole}
                    onChange={(e) => setAddRole(e.target.value as "WORKSPACE_ADMIN" | "MEMBER")}
                    className="flex h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                  >
                    <option value="MEMBER">MEMBER</option>
                    <option value="WORKSPACE_ADMIN">WORKSPACE_ADMIN</option>
                  </select>
                </div>
                <Button type="submit" disabled={!addUserId}>
                  <UserPlus className="h-4 w-4" />
                  {t("assignToWorkspace")}
                </Button>
              </form>
            )}

            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {wsMembers.map((m) => (
                <div
                  key={m.userId}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <div>
                    <span className="font-semibold text-slate-900">{m.name}</span>{" "}
                    <span className="text-slate-500">({m.email})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">{m.role}</Badge>
                    {canManage && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveWsMember(m.userId)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
