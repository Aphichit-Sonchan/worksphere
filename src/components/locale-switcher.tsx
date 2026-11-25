"use client";

import { Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = { th: "TH", en: "EN" };

export function LocaleSwitcher() {
  const t = useTranslations("LocaleSwitcher");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs font-medium"
    >
      <Globe className="ml-1.5 mr-0.5 h-3.5 w-3.5 text-slate-400" />
      {routing.locales.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            onClick={() => router.replace(pathname, { locale: l })}
            className={cn(
              "cursor-pointer rounded-lg px-2 py-1 transition-all",
              active
                ? "bg-white font-semibold text-blue-600 shadow-2xs ring-1 ring-slate-200/80"
                : "text-slate-500 hover:text-slate-800",
            )}
          >
            {LABELS[l]}
          </button>
        );
      })}
    </div>
  );
}
