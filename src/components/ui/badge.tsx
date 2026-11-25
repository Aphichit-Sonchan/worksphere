import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
  {
    variants: {
      variant: {
        ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
        warn: "bg-amber-50 text-amber-700 ring-amber-600/20",
        error: "bg-rose-50 text-rose-700 ring-rose-600/20",
        info: "bg-blue-50 text-blue-700 ring-blue-600/20",
        neutral: "bg-slate-100 text-slate-700 ring-slate-500/15",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
