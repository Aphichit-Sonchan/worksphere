"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  KeyRound,
  Layers,
  LogOut,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useOrganizations } from "@/hooks/use-tenancy";
import { Link, useRouter } from "@/i18n/navigation";

interface DashboardSummaryDto {
  totals: {
    projects: number;
    totalTasks: number;
    completedTasks: number;
    openTasks: number;
    overdueTasks: number;
    dueSoonTasks: number;
    completionRate: number;
  };
  myWork: {
    assignedOpenCount: number;
    overdueCount: number;
    dueSoonCount: number;
    tasks: Array<{
      id: string;
      key: string;
      title: string;
      priority: "HIGHEST" | "HIGH" | "MEDIUM" | "LOW" | "LOWEST";
      dueDate: string | null;
      projectId: string;
      projectName: string;
      columnName: string;
    }>;
  };
}

const PRIORITY_BADGE: Record<string, string> = {
  HIGHEST: "bg-rose-50 text-rose-700 ring-rose-600/20",
  HIGH: "bg-amber-50 text-amber-700 ring-amber-600/20",
  MEDIUM: "bg-blue-50 text-blue-700 ring-blue-600/20",
  LOW: "bg-slate-100 text-slate-600 ring-slate-500/15",
  LOWEST: "bg-slate-50 text-slate-500 ring-slate-400/15",
};

export default function AppHomePage() {
  const t = useTranslations("AppShell");
  const tt = useTranslations("Tenancy");
  const ta = useTranslations("Analytics");
  const router = useRouter();
  const { user, logout } = useAuth();
  const { activeOrg } = useOrganizations(Boolean(user));

  const orgId = activeOrg?.id ?? "";
  const { data: summary } = useQuery<DashboardSummaryDto | null>({
    queryKey: ["org-dashboard-summary", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const res = await fetch(`/api/v1/organizations/${orgId}/dashboard/summary`);
      if (!res.ok) return null;
      const json = (await res.json()) as { data: DashboardSummaryDto };
      return json.data;
    },
  });

  if (!user || !activeOrg) return null;

  async function handleLogoutAll() {
    await logout(true);
    router.replace("/login");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {t("welcome", { name: user.name })}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {tt("overviewSubtitle", { org: activeOrg.name })}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href="/app/workspaces"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Layers className="h-3.5 w-3.5" />
            {t("nav.workspaces")}
          </Link>
          <Link href="/app/members" className={buttonVariants({ size: "sm" })}>
            <Users className="h-3.5 w-3.5" />
            {tt("inviteMembersBtn")}
          </Link>
        </div>
      </div>

      {/* Organization Tenancy KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {tt("kpiWorkspaces")}
            </span>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Layers className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-900">{activeOrg.workspaceCount}</div>
          <Link
            href="/app/workspaces"
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
          >
            {tt("manageWorkspacesLink")}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {tt("kpiMembers")}
            </span>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Users className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-900">{activeOrg.memberCount}</div>
          <Link
            href="/app/members"
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
          >
            {tt("manageMembersLink")}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {tt("kpiRole")}
            </span>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Building2 className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-lg font-bold text-slate-900">{activeOrg.role}</span>
            <Badge variant={user.emailVerified ? "ok" : "warn"}>
              {user.emailVerified ? t("verified") : t("unverified")}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-slate-500">Slug: /{activeOrg.slug}</p>
        </Card>
      </div>

      {/* Phase 7 Executive Analytics Pulse (WS-705) */}
      {summary && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            {ta("orgPulseTitle")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">{ta("totalTasks")}</span>
                <ClipboardList className="h-4 w-4 text-blue-600" />
              </div>
              <div className="mt-2 text-3xl font-bold text-slate-900">
                {summary.totals.totalTasks}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {ta("openTasks")}: {summary.totals.openTasks}
              </p>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">{ta("completionRate")}</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="mt-2 text-3xl font-bold text-emerald-700">
                {summary.totals.completionRate}%
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${summary.totals.completionRate}%` }}
                />
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">{ta("overdueTasks")}</span>
                <AlertTriangle className="h-4 w-4 text-rose-600" />
              </div>
              <div className="mt-2 text-3xl font-bold text-rose-600">
                {summary.totals.overdueTasks}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {ta("completedTasks")}: {summary.totals.completedTasks}
              </p>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">{ta("dueSoonTasks")}</span>
                <CalendarClock className="h-4 w-4 text-amber-600" />
              </div>
              <div className="mt-2 text-3xl font-bold text-amber-600">
                {summary.totals.dueSoonTasks}
              </div>
              <Link
                href="/app/projects"
                className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
              >
                {t("nav.projects")}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Card>
          </div>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-slate-200 px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>{ta("myWorkTitle")}</CardTitle>
                  <CardDescription>{ta("myWorkDesc")}</CardDescription>
                </div>
                <Badge variant="info">{summary.myWork.assignedOpenCount}</Badge>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {summary.myWork.tasks.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  {ta("emptyMyWork")}
                </div>
              ) : (
                summary.myWork.tasks.map((task) => (
                  <Link
                    key={task.id}
                    href={`/app/projects/${task.projectId}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 transition hover:bg-slate-50"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="font-mono text-xs font-bold text-blue-600">{task.key}</span>
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {task.title}
                      </span>
                      <span className="text-xs text-slate-400">· {task.projectName}</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-xs">
                      <Badge variant="neutral">{task.columnName}</Badge>
                      <span
                        className={`rounded-full px-2.5 py-0.5 font-semibold ring-1 ring-inset ${
                          PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.MEDIUM
                        }`}
                      >
                        {task.priority}
                      </span>
                      {task.dueDate && (
                        <span className="text-slate-500">
                          {new Date(task.dueDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="mb-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <KeyRound className="h-4 w-4" />
            </span>
            <div>
              <CardTitle>{t("securityCardTitle")}</CardTitle>
              <CardDescription>{t("securityCardDesc")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={handleLogoutAll}>
            <LogOut className="h-3.5 w-3.5" />
            {t("logoutAllDevices")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
