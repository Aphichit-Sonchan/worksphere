"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, PasswordInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, useRouter } from "@/i18n/navigation";

function LoginForm() {
  const t = useTranslations("Auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = (await res.json()) as { error?: { message: string } };
      if (!res.ok) {
        setError(json.error?.message ?? t("errors.generic"));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
      const next = searchParams.get("next");
      if (next && next.startsWith("/")) {
        window.location.assign(next);
      } else {
        router.push("/app");
      }
    } catch {
      setError(t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-slate-200/90 p-7 shadow-sm">
      <CardHeader className="mb-6 flex-col items-start gap-1">
        <CardTitle className="text-2xl font-bold">{t("loginTitle")}</CardTitle>
        <CardDescription>{t("loginSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t("password")}</Label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
              >
                {t("forgotPasswordLink")}
              </Link>
            </div>
            <PasswordInput
              id="password"
              placeholder="••••••••"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" disabled={submitting} className="mt-2 w-full">
            {submitting ? t("submitting") : t("loginAction")}
            {!submitting && <ArrowRight className="h-4 w-4" />}
          </Button>

          <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {t("demoAccountsLabel")}
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: "Owner", email: "owner@demo.worksphere.io" },
                { label: "Member", email: "member@demo.worksphere.io" },
                { label: "Viewer", email: "viewer@demo.worksphere.io" },
              ].map((demo) => (
                <button
                  key={demo.label}
                  type="button"
                  onClick={() => {
                    setEmail(demo.email);
                    setPassword("DemoPass#2026");
                    setError(null);
                  }}
                  className="cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                >
                  {demo.label}
                </button>
              ))}
            </div>
          </div>

          <p className="pt-2 text-center text-sm text-slate-500">
            {t("noAccount")}{" "}
            <Link
              href="/register"
              className="font-semibold text-blue-600 hover:text-blue-700 hover:underline"
            >
              {t("registerLink")}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
