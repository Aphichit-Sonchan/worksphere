import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandLogo({
  className,
  size = "default",
}: {
  className?: string;
  size?: "sm" | "default";
}) {
  const iconBox = size === "sm" ? "h-8 w-8 rounded-lg" : "h-9 w-9 rounded-xl";
  const iconSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const textSize = size === "sm" ? "text-base" : "text-lg";

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "inline-flex items-center justify-center bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-600/25",
          iconBox,
        )}
      >
        <Layers className={iconSize} />
      </span>
      <span className={cn("font-bold tracking-tight text-slate-900", textSize)}>
        Work<span className="text-blue-600">Sphere</span>
      </span>
    </span>
  );
}
