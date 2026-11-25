import { CheckCircle2, GitBranch, Kanban, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useTranslations("Auth");

  const points = [
    { icon: ShieldCheck, text: t("showcase.point1") },
    { icon: Kanban, text: t("showcase.point2") },
    { icon: GitBranch, text: t("showcase.point3") },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900 lg:grid lg:grid-cols-12">
      {/* Left Enterprise Showcase Panel */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-slate-200/90 bg-slate-50 p-10 lg:col-span-5 lg:flex">
        <div className="bg-subtle-grid pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative z-10">
          <Link href="/" className="inline-block">
            <BrandLogo />
          </Link>
        </div>

        <div className="relative z-10 my-auto max-w-md space-y-6 py-12">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-600/20">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("showcase.badge")}
          </span>
          <h2 className="text-3xl font-bold leading-snug tracking-tight text-slate-900">
            {t("showcase.heading")}
          </h2>
          <p className="text-sm leading-relaxed text-slate-600">
            {t("showcase.description")}
          </p>

          <ul className="space-y-3.5 pt-2">
            {points.map(({ icon: Icon, text }, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-white/90 p-3.5 text-sm text-slate-700 shadow-2xs"
              >
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="font-medium leading-snug">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 text-xs text-slate-400">
          Argon2id • Refresh Token Rotation • Strict Tenant Isolation
        </div>
      </aside>

      {/* Right Pure White Auth Form Area */}
      <div className="flex min-h-screen flex-col justify-between bg-white px-6 py-8 lg:col-span-7 lg:px-12">
        <header className="flex items-center justify-between">
          <Link href="/" className="lg:invisible">
            <BrandLogo size="sm" />
          </Link>
          <LocaleSwitcher />
        </header>

        <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">
          {children}
        </main>

        <footer className="text-center text-xs text-slate-400">
          © {new Date().getFullYear()} WorkSphere
        </footer>
      </div>
    </div>
  );
}
