"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ScrollText, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOrganizations, type OrganizationItem } from "@/hooks/use-tenancy";
import { useRouter } from "@/i18n/navigation";

function OrgGeneralForm({
  org,
  onSaved,
}: {
  org: OrganizationItem;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("Tenancy");
  const canUpdate = org.role === "ORG_OWNER" || org.role === "ORG_ADMIN";

  const [name, setName] = useState(org.name);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`/api/v1/organizations/${org.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message: string } };
        setError(json.error?.message ?? t("errors.generic"));
        return;
      }
      await onSaved();
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="max-w-md space-y-4">
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span>{t("settingsSaved")}</span>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="settings-org-name">{t("orgNameLabel")}</Label>
        <Input
          id="settings-org-name"
          value={name}
          disabled={!canUpdate}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      {canUpdate && (
        <Button type="submit" disabled={saving}>
          {saving ? t("saving") : t("saveChanges")}
        </Button>
      )}
    </form>
  );
}

export default function OrgSettingsPage() {
  const t = useTranslations("Tenancy");
  const tr = useTranslations("Realtime");
  const router = useRouter();
  const { activeOrg, refreshOrganizations, setActiveOrgId } = useOrganizations();

  const canReadAudit =
    activeOrg?.role === "ORG_OWNER" || activeOrg?.role === "ORG_ADMIN";
  const { data: auditResp } = useQuery<{
    data: Array<{
      id: string;
      action: string;
      actor: { name: string; email: string };
      createdAt: string;
    }>;
  }>({
    queryKey: ["org-audit", activeOrg?.id],
    enabled: Boolean(activeOrg?.id && canReadAudit),
    queryFn: async () => {
      const res = await fetch(`/api/v1/organizations/${activeOrg!.id}/audit-logs`);
      return res.json();
    },
  });
  const auditLogs = auditResp?.data ?? [];

  if (!activeOrg) return null;
  const isOwner = activeOrg.role === "ORG_OWNER";

  async function handleDeleteOrg() {
    if (!activeOrg) return;
    const confirmed = window.confirm(t("confirmDeleteOrg", { name: activeOrg.name }));
    if (!confirmed) return;

    const res = await fetch(`/api/v1/organizations/${activeOrg.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setActiveOrgId(null);
      await refreshOrganizations();
      router.push("/app");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {t("settingsTitle")}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t("settingsDesc")}</p>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t("generalSettings")}</CardTitle>
            <CardDescription>Slug: /{activeOrg.slug}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <OrgGeneralForm
            key={activeOrg.id}
            org={activeOrg}
            onSaved={refreshOrganizations}
          />
        </CardContent>
      </Card>

      {canReadAudit && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <ScrollText className="h-4 w-4" />
              </span>
              <div>
                <CardTitle>{tr("auditLogsTitle")}</CardTitle>
                <CardDescription>{tr("auditLogsDesc")}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {auditLogs.length === 0 ? (
              <p className="text-sm text-slate-500">{tr("emptyActivity")}</p>
            ) : (
              <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-slate-900">{log.actor.name}</span>
                      <span className="mx-2 rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-700">
                        {log.action}
                      </span>
                    </div>
                    <span className="text-slate-400">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isOwner && (
        <Card className="border-rose-200">
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <div>
                <CardTitle className="text-rose-700">{t("dangerZone")}</CardTitle>
                <CardDescription>{t("dangerZoneDesc")}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="destructive" size="sm" onClick={handleDeleteOrg}>
              <Trash2 className="h-3.5 w-3.5" />
              {t("deleteOrgBtn")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
