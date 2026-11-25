"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, MailPlus, Trash2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useOrganizations } from "@/hooks/use-tenancy";

interface MemberItem {
  userId: string;
  email: string;
  name: string;
  role: "ORG_OWNER" | "ORG_ADMIN" | "MEMBER";
  joinedAt: string;
}

interface InvitationItem {
  id: string;
  email: string;
  role: "ORG_OWNER" | "ORG_ADMIN" | "MEMBER";
  expiresAt: string;
}

export default function MembersPage() {
  const t = useTranslations("Tenancy");
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { activeOrg, refreshOrganizations } = useOrganizations(Boolean(user));

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ORG_OWNER" | "ORG_ADMIN" | "MEMBER">("MEMBER");
  const [latestInviteUrl, setLatestInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const orgId = activeOrg?.id ?? "";
  const canManage = activeOrg?.role === "ORG_OWNER" || activeOrg?.role === "ORG_ADMIN";

  const { data: members = [] } = useQuery<MemberItem[]>({
    queryKey: ["org-members", orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const res = await fetch(`/api/v1/organizations/${orgId}/members`);
      const json = (await res.json()) as { data: MemberItem[] };
      return res.ok ? json.data : [];
    },
  });

  const { data: invitations = [] } = useQuery<InvitationItem[]>({
    queryKey: ["org-invitations", orgId],
    enabled: Boolean(orgId && canManage),
    queryFn: async () => {
      const res = await fetch(`/api/v1/organizations/${orgId}/invitations`);
      const json = (await res.json()) as { data: InvitationItem[] };
      return res.ok ? json.data : [];
    },
  });

  if (!activeOrg || !user) return null;

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLatestInviteUrl(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/organizations/${orgId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const json = (await res.json()) as {
        data?: { inviteUrl: string };
        error?: { message: string };
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? t("errors.generic"));
        return;
      }
      setInviteEmail("");
      setLatestInviteUrl(json.data.inviteUrl);
      await queryClient.invalidateQueries({ queryKey: ["org-invitations", orgId] });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRoleChange(targetUserId: string, role: MemberItem["role"]) {
    setError(null);
    const res = await fetch(`/api/v1/organizations/${orgId}/members/${targetUserId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: { message: string } };
      setError(json.error?.message ?? t("errors.generic"));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["org-members", orgId] });
  }

  async function handleRemoveMember(targetUserId: string) {
    setError(null);
    const res = await fetch(`/api/v1/organizations/${orgId}/members/${targetUserId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: { message: string } };
      setError(json.error?.message ?? t("errors.generic"));
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["org-members", orgId] }),
      refreshOrganizations(),
    ]);
  }

  async function handleRevokeInvite(invitationId: string) {
    await fetch(`/api/v1/organizations/${orgId}/invitations/${invitationId}`, {
      method: "DELETE",
    });
    await queryClient.invalidateQueries({ queryKey: ["org-invitations", orgId] });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {t("membersTitle")}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t("membersDesc")}</p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t("inviteCardTitle")}</CardTitle>
              <CardDescription>{t("inviteCardDesc")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[240px] flex-1 space-y-1.5">
                <Label htmlFor="inv-email">{t("inviteEmailLabel")}</Label>
                <Input
                  id="inv-email"
                  type="email"
                  placeholder="teammate@company.com"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-role">Role</Label>
                <select
                  id="inv-role"
                  value={inviteRole}
                  onChange={(e) =>
                    setInviteRole(e.target.value as "ORG_OWNER" | "ORG_ADMIN" | "MEMBER")
                  }
                  className="flex h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                >
                  <option value="MEMBER">MEMBER</option>
                  <option value="ORG_ADMIN">ORG_ADMIN</option>
                  {activeOrg.role === "ORG_OWNER" && (
                    <option value="ORG_OWNER">ORG_OWNER</option>
                  )}
                </select>
              </div>
              <Button type="submit" disabled={submitting}>
                <MailPlus className="h-4 w-4" />
                {submitting ? t("sending") : t("sendInviteBtn")}
              </Button>
            </form>

            {latestInviteUrl && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
                <span className="truncate font-mono">{latestInviteUrl}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(latestInviteUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? t("copied") : t("copyInviteLink")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Active Members Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("activeMembersHeader")} ({members.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {members.map((m) => (
              <div
                key={m.userId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-sm"
              >
                <div>
                  <div className="font-semibold text-slate-900">{m.name}</div>
                  <div className="text-xs text-slate-500">{m.email}</div>
                </div>
                <div className="flex items-center gap-2.5">
                  {canManage && !(activeOrg.role === "ORG_ADMIN" && m.role === "ORG_OWNER") ? (
                    <select
                      value={m.role}
                      onChange={(e) =>
                        handleRoleChange(
                          m.userId,
                          e.target.value as "ORG_OWNER" | "ORG_ADMIN" | "MEMBER",
                        )
                      }
                      className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800"
                    >
                      <option value="MEMBER">MEMBER</option>
                      <option value="ORG_ADMIN">ORG_ADMIN</option>
                      {activeOrg.role === "ORG_OWNER" && (
                        <option value="ORG_OWNER">ORG_OWNER</option>
                      )}
                    </select>
                  ) : (
                    <Badge variant="info">{m.role}</Badge>
                  )}

                  {canManage && m.userId !== user.id && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveMember(m.userId)}
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

      {/* Pending Invitations */}
      {canManage && invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t("pendingInvitesHeader")} ({invitations.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div>
                    <span className="font-semibold text-slate-900">{inv.email}</span>
                    <span className="ml-2 text-xs text-slate-400">({inv.role})</span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleRevokeInvite(inv.id)}
                  >
                    <XCircle className="h-3.5 w-3.5 text-rose-600" />
                    {t("revokeBtn")}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
