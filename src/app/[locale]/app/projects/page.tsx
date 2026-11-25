"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FolderKanban, Layers, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOrganizations } from "@/hooks/use-tenancy";
import { Link, useRouter } from "@/i18n/navigation";

interface ProjectItem {
  id: string;
  workspaceId: string;
  workspaceName: string;
  key: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  taskCount: number;
  memberCount: number;
}

interface WorkspaceOption {
  id: string;
  name: string;
  archivedAt: string | null;
}

function suggestProjectKey(name: string): string {
  const words = name
    .trim()
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return words
      .map((w) => w[0]!.toUpperCase())
      .join("")
      .slice(0, 5);
  }
  const single = (words[0] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return single.slice(0, 4);
}

export default function ProjectsDirectoryPage() {
  const t = useTranslations("Projects");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeOrg } = useOrganizations();

  const [filterWs, setFilterWs] = useState("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const [wsId, setWsId] = useState("");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const orgId = activeOrg?.id ?? "";

  const { data: projects = [], isLoading } = useQuery<ProjectItem[]>({
    queryKey: ["org-projects", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const res = await fetch(`/api/v1/organizations/${orgId}/projects`);
      const json = (await res.json()) as { data: ProjectItem[] };
      return res.ok ? json.data : [];
    },
  });

  const { data: workspaces = [] } = useQuery<WorkspaceOption[]>({
    queryKey: ["workspaces", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const res = await fetch(`/api/v1/organizations/${orgId}/workspaces`);
      const json = (await res.json()) as { data: WorkspaceOption[] };
      return res.ok ? json.data : [];
    },
  });

  if (!activeOrg) return null;

  const activeWorkspaces = workspaces.filter((w) => !w.archivedAt);
  const effectiveWsId = wsId || activeWorkspaces[0]?.id || "";

  const filtered = projects.filter((p) => {
    if (filterWs !== "all" && p.workspaceId !== filterWs) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.key.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  async function handleCreateProject(e: FormEvent) {
    e.preventDefault();
    if (!effectiveWsId) return;
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/v1/workspaces/${effectiveWsId}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: key.toUpperCase(),
          name,
          description: description || undefined,
        }),
      });
      const json = (await res.json()) as {
        data?: { project: { id: string } };
        error?: { message: string };
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? t("errors.generic"));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["org-projects", orgId] });
      router.push(`/app/projects/${json.data.project.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {t("directoryTitle")}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{t("directoryDesc")}</p>
        </div>
        {activeWorkspaces.length > 0 && (
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="h-4 w-4" />
            {t("newProjectBtn")}
          </Button>
        )}
      </div>

      {showCreate && (
        <Card className="border-blue-200">
          <CardHeader>
            <div>
              <CardTitle>{t("newProjectBtn")}</CardTitle>
              <CardDescription>{t("newProjectHint")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateProject} className="grid gap-4 sm:grid-cols-12">
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm text-rose-700 sm:col-span-12">
                  {error}
                </div>
              )}
              <div className="space-y-1.5 sm:col-span-4">
                <Label htmlFor="proj-ws">Workspace</Label>
                <select
                  id="proj-ws"
                  value={effectiveWsId}
                  onChange={(e) => setWsId(e.target.value)}
                  className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                >
                  {activeWorkspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-5">
                <Label htmlFor="proj-name">{t("projectNameLabel")}</Label>
                <Input
                  id="proj-name"
                  placeholder="Platform Core"
                  required
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!keyTouched) {
                      const suggested = suggestProjectKey(e.target.value);
                      if (suggested.length >= 2) setKey(suggested);
                    }
                  }}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-3">
                <Label htmlFor="proj-key">{t("projectKeyLabel")}</Label>
                <Input
                  id="proj-key"
                  placeholder="ENG"
                  maxLength={6}
                  required
                  value={key}
                  onChange={(e) => {
                    setKeyTouched(true);
                    setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                  }}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-12">
                <Label htmlFor="proj-desc">{t("projectDescLabel")}</Label>
                <Input
                  id="proj-desc"
                  placeholder={t("projectDescPlaceholder")}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 sm:col-span-12">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                  {t("cancel")}
                </Button>
                <Button type="submit" disabled={submitting || key.length < 2 || !name}>
                  {submitting ? t("saving") : t("createProjectAction")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <Input
            placeholder={t("searchProjectsPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={filterWs}
          onChange={(e) => setFilterWs(e.target.value)}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
        >
          <option value="all">{t("allWorkspaces")}</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-2xl border border-slate-200 bg-white"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="py-12 text-center">
          <FolderKanban className="mx-auto h-10 w-10 text-slate-300" />
          <h3 className="mt-3 text-base font-semibold text-slate-900">{t("emptyProjects")}</h3>
          <p className="mt-1 text-sm text-slate-500">{t("emptyProjectsHint")}</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((proj) => (
            <Card
              key={proj.id}
              className="flex flex-col justify-between transition hover:border-blue-300 hover:shadow-md"
            >
              <div>
                <CardHeader className="mb-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg bg-blue-50 px-2.5 py-1 font-mono text-xs font-bold text-blue-700 ring-1 ring-inset ring-blue-600/20">
                      {proj.key}
                    </span>
                    <Badge variant={proj.archivedAt ? "warn" : "neutral"}>
                      <Layers className="h-3 w-3" />
                      {proj.workspaceName}
                    </Badge>
                  </div>
                </CardHeader>
                <CardTitle className="text-lg">{proj.name}</CardTitle>
                <p className="mt-1.5 line-clamp-2 text-sm text-slate-500">
                  {proj.description || t("noDescription")}
                </p>
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3.5 text-xs text-slate-500">
                <span>
                  {proj.taskCount} {t("tasksUnit")} • {proj.memberCount} {t("membersUnit")}
                </span>
                <Link
                  href={`/app/projects/${proj.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  {t("openBoard")}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
