"use client";

import { AlertCircle, Building2, CheckCircle2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useOrganizations } from "@/hooks/use-tenancy";
import { Link, useRouter } from "@/i18n/navigation";

export default function AcceptInvitationPage() {
  const t = useTranslations("Tenancy");
  const locale = useLocale();
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = params.token;

  const { user, isLoading } = useAuth();
  const { setActiveOrgId, refreshOrganizations } = useOrganizations(false);

  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleAccept() {
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/v1/invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST",
      });
      const json = (await res.json()) as {
        data?: { orgId: string };
        error?: { message: string };
      };
      if (!res.ok || !json.data) {
        setStatus("error");
        setErrorMessage(json.error?.message ?? t("errors.generic"));
        return;
      }
      await refreshOrganizations();
      setActiveOrgId(json.data.orgId);
      setStatus("done");
      setTimeout(() => router.push("/app"), 900);
    } catch {
      setStatus("error");
      setErrorMessage(t("errors.generic"));
    }
  }

  const nextPath = `/${locale}/invitations/${token}`;

  return (
    <div className="flex min-h-screen flex-col justify-between bg-slate-50/70 px-6 py-8">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <Link href="/">
          <BrandLogo size="sm" />
        </Link>
        <LocaleSwitcher />
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
        <Card className="p-7 shadow-sm">
          <CardHeader className="mb-5 flex-col items-start gap-2">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-5 w-5" />
            </span>
            <CardTitle className="text-xl">{t("acceptInviteTitle")}</CardTitle>
            <CardDescription>{t("acceptInviteDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
            ) : !user ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">{t("loginToAccept")}</p>
                <div className="grid grid-cols-2 gap-2.5">
                  <a
                    href={`/${locale}/login?next=${encodeURIComponent(nextPath)}`}
                    className={buttonVariants({ variant: "default" })}
                  >
                    {t("signInBtn")}
                  </a>
                  <a
                    href={`/${locale}/register`}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    {t("signUpBtn")}
                  </a>
                </div>
              </div>
            ) : status === "done" ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>{t("acceptSuccess")}</span>
              </div>
            ) : (
              <div className="space-y-4">
                {status === "error" && errorMessage && (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                    <span>{errorMessage}</span>
                  </div>
                )}
                <p className="text-xs text-slate-500">
                  {t("acceptingAs")}: <strong className="text-slate-800">{user.email}</strong>
                </p>
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  disabled={status === "submitting"}
                  onClick={handleAccept}
                >
                  {status === "submitting" ? t("creating") : t("acceptInviteAction")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <footer className="text-center text-xs text-slate-400">
        © {new Date().getFullYear()} WorkSphere
      </footer>
    </div>
  );
}
