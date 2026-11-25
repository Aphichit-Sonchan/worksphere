"use client";

import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  FolderKanban,
  Layers,
  LayoutDashboard,
  LogOut,
  Plus,
  Settings,
  Users,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useNotifications } from "@/hooks/use-realtime";
import { toSlug, useOrganizations } from "@/hooks/use-tenancy";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function CreateOrganizationForm({
  onCreated,
  onCancel,
}: {
  onCreated: (orgId: string) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("Tenancy");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug }),
      });
      const json = (await res.json()) as {
        data?: { organization: { id: string } };
        error?: { message: string };
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? t("errors.generic"));
        return;
      }
      onCreated(json.data.organization.id);
    } catch {
      setError(t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
          {error}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="org-name">{t("orgNameLabel")}</Label>
        <Input
          id="org-name"
          placeholder={t("orgNamePlaceholder")}
          required
          minLength={2}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(toSlug(e.target.value));
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="org-slug">{t("orgSlugLabel")}</Label>
        <Input
          id="org-slug"
          placeholder="acme-corp"
          required
          minLength={2}
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(toSlug(e.target.value));
          }}
        />
        <p className="text-xs text-slate-400">{t("orgSlugHint")}</p>
      </div>
      <div className="flex items-center justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
        )}
        <Button type="submit" disabled={submitting || !name || !slug}>
          {submitting ? t("creating") : t("createOrgAction")}
        </Button>
      </div>
    </form>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("AppShell");
  const tt = useTranslations("Tenancy");
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading: authLoading, logout } = useAuth();
  const {
    organizations,
    activeOrg,
    isLoading: orgLoading,
    setActiveOrgId,
    refreshOrganizations,
  } = useOrganizations(Boolean(user));
  const { unreadCount } = useNotifications(Boolean(user));

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  async function handleLogout() {
    await logout(false);
    router.replace("/login");
  }

  const navItems = [
    { href: "/app", label: t("nav.overview"), icon: LayoutDashboard, exact: true, badge: 0 },
    { href: "/app/projects", label: t("nav.projects"), icon: FolderKanban, exact: false, badge: 0 },
    { href: "/app/workspaces", label: t("nav.workspaces"), icon: Layers, exact: false, badge: 0 },
    { href: "/app/members", label: t("nav.members"), icon: Users, exact: false, badge: 0 },
    {
      href: "/app/notifications",
      label: t("nav.notifications"),
      icon: Bell,
      exact: false,
      badge: unreadCount,
    },
    { href: "/app/settings", label: t("nav.settings"), icon: Settings, exact: false, badge: 0 },
  ];

  return (
    <div className="flex min-h-screen bg-slate-50/70 text-slate-900">
      {/* Pure White Sidebar */}
      <aside className="hidden w-68 shrink-0 flex-col justify-between border-r border-slate-200 bg-white p-4 md:flex">
        <div className="space-y-5">
          <div className="px-2 pt-1">
            <Link href="/app">
              <BrandLogo size="sm" />
            </Link>
          </div>

          {/* Organization Switcher */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSwitcherOpen((v) => !v)}
              className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-slate-100/70"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-xs font-bold text-white">
                  {activeOrg ? getInitials(activeOrg.name) : <Building2 className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {activeOrg ? activeOrg.name : tt("selectOrg")}
                  </div>
                  <div className="truncate text-[11px] text-slate-500">
                    {activeOrg ? activeOrg.role : tt("noOrganization")}
                  </div>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
            </button>

            {switcherOpen && (
              <div className="absolute left-0 right-0 z-30 mt-1.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {tt("yourOrganizations")}
                </div>
                <div className="max-h-52 space-y-0.5 overflow-y-auto">
                  {organizations.map((org) => {
                    const selected = org.id === activeOrg?.id;
                    return (
                      <button
                        key={org.id}
                        type="button"
                        onClick={() => {
                          setActiveOrgId(org.id);
                          setSwitcherOpen(false);
                        }}
                        className={cn(
                          "flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition",
                          selected
                            ? "bg-blue-50 font-semibold text-blue-700"
                            : "text-slate-700 hover:bg-slate-50",
                        )}
                      >
                        <span className="truncate">{org.name}</span>
                        {selected && <Check className="h-4 w-4 shrink-0 text-blue-600" />}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1 border-t border-slate-100 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSwitcherOpen(false);
                      setCreateModalOpen(true);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50"
                  >
                    <Plus className="h-4 w-4" />
                    {tt("newOrganization")}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Primary Navigation */}
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition",
                    isActive
                      ? "bg-blue-50 font-semibold text-blue-700"
                      : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900",
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </span>
                  {item.badge > 0 && (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {user && (
          <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
              {getInitials(user.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
              <p className="truncate text-xs text-slate-500">{user.email}</p>
            </div>
          </div>
        )}
      </aside>

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-6 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <span className="md:hidden">
              <BrandLogo size="sm" />
            </span>
            {activeOrg && (
              <div className="hidden items-center gap-2 md:flex">
                <span className="text-sm font-semibold text-slate-900">{activeOrg.name}</span>
                <span className="text-slate-300">/</span>
                <Badge variant="info">{activeOrg.role}</Badge>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <Link
                href="/app/notifications"
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </Link>
            )}
            <LocaleSwitcher />
            {user && (
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="h-3.5 w-3.5" />
                {t("logout")}
              </Button>
            )}
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6 sm:p-8">
          {authLoading || (user && orgLoading) ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-white" />
              <div className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-white" />
            </div>
          ) : !user ? (
            <Card>
              <CardContent className="flex items-center justify-between py-6">
                <span className="text-slate-700">{t("sessionExpired")}</span>
                <Button size="sm" onClick={() => router.replace("/login")}>
                  {t("goLogin")}
                </Button>
              </CardContent>
            </Card>
          ) : !activeOrg ? (
            <Card className="mx-auto w-full max-w-lg border-slate-200 p-7">
              <CardHeader className="mb-5 flex-col items-start gap-1">
                <span className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <Building2 className="h-5 w-5" />
                </span>
                <CardTitle className="text-xl">{tt("onboardingTitle")}</CardTitle>
                <CardDescription>{tt("onboardingDesc")}</CardDescription>
              </CardHeader>
              <CardContent>
                <CreateOrganizationForm
                  onCreated={async (newId) => {
                    await refreshOrganizations();
                    setActiveOrgId(newId);
                  }}
                />
              </CardContent>
            </Card>
          ) : (
            children
          )}
        </main>
      </div>

      {/* Create Organization Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-xs">
          <Card className="w-full max-w-md border-slate-200 p-6 shadow-xl">
            <CardHeader className="mb-4">
              <div>
                <CardTitle className="text-lg">{tt("newOrganization")}</CardTitle>
                <CardDescription>{tt("onboardingDesc")}</CardDescription>
              </div>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </CardHeader>
            <CardContent>
              <CreateOrganizationForm
                onCancel={() => setCreateModalOpen(false)}
                onCreated={async (newId) => {
                  setCreateModalOpen(false);
                  await refreshOrganizations();
                  setActiveOrgId(newId);
                }}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
