import {
  ArrowRight,
  CheckCircle2,
  GitBranch,
  Kanban,
  Lock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SystemStatusCard } from "@/components/system-status-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";

const FEATURE_META = [
  {
    key: "issues",
    icon: GitBranch,
    iconBg: "bg-blue-50 text-blue-600 ring-blue-600/15",
  },
  {
    key: "board",
    icon: Kanban,
    iconBg: "bg-indigo-50 text-indigo-600 ring-indigo-600/15",
  },
  {
    key: "rbac",
    icon: ShieldCheck,
    iconBg: "bg-emerald-50 text-emerald-600 ring-emerald-600/15",
  },
] as const;

export default function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("Home");

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      {/* Sticky Enterprise Navbar */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <BrandLogo />
          <div className="flex items-center gap-3">
            <LocaleSwitcher />
            <Link
              href="/login"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {t("login")}
            </Link>
            <Link
              href="/register"
              className={buttonVariants({ variant: "default", size: "sm" })}
            >
              {t("getStarted")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section on Crisp White + Subtle Light Grid */}
      <section className="relative overflow-hidden border-b border-slate-200/70 bg-gradient-to-b from-slate-50/80 via-white to-white">
        <div className="bg-subtle-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:linear-gradient(to_bottom,white,transparent)]" />
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-12 lg:py-22">
          <div className="flex flex-col gap-6 lg:col-span-6">
            <div>
              <Badge variant="info" className="px-3 py-1">
                <Sparkles className="h-3.5 w-3.5" />
                {t("eyebrow")}
              </Badge>
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl sm:leading-[1.12]">
              {t("tagline")}
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
              {t("subtitle")}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link href="/register" className={buttonVariants({ size: "lg" })}>
                {t("getStarted")}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                {t("login")}
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-xs font-medium text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                {t("highlights.auth")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                {t("highlights.tenant")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                {t("highlights.dag")}
              </span>
            </div>
          </div>

          {/* Interactive-style Product Preview Window */}
          <div className="lg:col-span-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-900/5">
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <span className="ml-2 text-xs font-semibold text-slate-700">
                    Acme Corp / Engineering / Sprint Board
                  </span>
                </div>
                <Badge variant="ok">Live Sync</Badge>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {/* Column 1 */}
                <div className="rounded-xl border border-slate-200/70 bg-slate-50/80 p-2.5">
                  <div className="mb-2.5 flex items-center justify-between px-1">
                    <span className="text-xs font-semibold text-slate-700">To Do</span>
                    <span className="rounded-md bg-slate-200/80 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                      2
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-2xs">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-mono text-[11px] font-semibold text-blue-600">
                          ENG-104
                        </span>
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                          HIGH
                        </span>
                      </div>
                      <p className="text-xs font-medium text-slate-800">
                        Multi-tenant workspace switcher
                      </p>
                      <div className="mt-2 flex items-center gap-1 text-[10px] text-rose-600">
                        <Lock className="h-3 w-3" />
                        <span>Blocked by ENG-101</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Column 2 */}
                <div className="rounded-xl border border-blue-200/70 bg-blue-50/40 p-2.5">
                  <div className="mb-2.5 flex items-center justify-between px-1">
                    <span className="text-xs font-semibold text-blue-900">In Progress</span>
                    <span className="rounded-md bg-blue-100 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700">
                      1
                    </span>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-white p-3 shadow-xs">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono text-[11px] font-semibold text-blue-600">
                        ENG-101
                      </span>
                      <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                        HIGHEST
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-800">
                      Refresh token rotation & RBAC guard
                    </p>
                    <div className="mt-2.5 flex items-center justify-between">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        v3 • Locked
                      </span>
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                        SC
                      </span>
                    </div>
                  </div>
                </div>

                {/* Column 3 */}
                <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-2.5">
                  <div className="mb-2.5 flex items-center justify-between px-1">
                    <span className="text-xs font-semibold text-emerald-900">Done</span>
                    <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                      1
                    </span>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3 opacity-90 shadow-2xs">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono text-[11px] font-semibold text-slate-400 line-through">
                        ENG-98
                      </span>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    </div>
                    <p className="text-xs font-medium text-slate-700">
                      PostgreSQL schema & Neon migration
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Capabilities */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-6 py-16">
        <section className="flex flex-col gap-6">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              {t("sectionTitle")}
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">{t("sectionSubtitle")}</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            {FEATURE_META.map(({ key, icon: Icon, iconBg }) => (
              <Card
                key={key}
                className="transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
              >
                <CardHeader className="mb-3 flex-col items-start gap-3">
                  <span
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-inset ${iconBg}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <CardTitle className="text-lg">{t(`features.${key}.title`)}</CardTitle>
                </CardHeader>
                <CardContent>{t(`features.${key}.body`)}</CardContent>
              </Card>
            ))}
          </div>
        </section>

        <SystemStatusCard />
      </main>

      <footer className="border-t border-slate-200/80 bg-slate-50/60 py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 text-xs text-slate-500">
          <span>© {new Date().getFullYear()} WorkSphere Platform</span>
          <span className="font-medium text-slate-600">{t("phase")}</span>
        </div>
      </footer>
    </div>
  );
}
