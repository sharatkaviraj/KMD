import Image from "next/image";

import { schoolBrand } from "@/platform/config/school-brand";
import { cn } from "@/platform/utils";

type SchoolBrandProps = {
  className?: string;
  variant?: "hero" | "sidebar" | "sidebar-ink" | "compact" | "icon";
  preload?: boolean;
};

const variantStyles = {
  hero: {
    root: "gap-4",
    frame: "size-16 rounded-xl p-1.5 shadow-sm",
    eyebrow: "text-[10px] font-semibold uppercase tracking-[0.16em] text-accent",
    title: "mt-1 font-display text-2xl font-semibold tracking-tight text-foreground",
    subtitle: "mt-0.5 text-sm leading-6 text-muted-foreground",
  },
  sidebar: {
    root: "gap-3",
    frame: "size-11 rounded-lg p-1 shadow-xs",
    eyebrow: "text-[10px] font-semibold uppercase tracking-[0.14em] text-accent",
    title: "mt-0.5 font-display text-[15px] font-semibold leading-tight tracking-tight text-foreground",
    subtitle: "mt-0.5 text-[11px] leading-4 text-muted-foreground",
  },
  "sidebar-ink": {
    root: "gap-3",
    frame: "size-11 rounded-lg p-1 shadow-xs",
    // Essential small copy stays full-strength on the navy sidebar.
    eyebrow: "text-[10px] font-semibold uppercase tracking-[0.14em] text-nav-foreground",
    title: "mt-0.5 font-display text-[15px] font-semibold leading-tight tracking-tight text-nav-foreground",
    subtitle: "mt-0.5 text-[11px] leading-4 text-nav-muted",
  },
  compact: {
    root: "gap-2.5",
    frame: "size-10 rounded-md p-1 shadow-xs",
    eyebrow: "text-[10px] font-semibold uppercase tracking-[0.14em] text-accent",
    title: "font-display text-sm font-semibold leading-tight tracking-tight text-foreground",
    subtitle: "text-[11px] leading-4 text-muted-foreground",
  },
  icon: {
    root: "gap-0",
    frame: "size-11 rounded-lg p-0.5 shadow-sm",
    eyebrow: "",
    title: "",
    subtitle: "",
  },
} as const;

export function SchoolBrand({
  className,
  variant = "compact",
  preload = false,
}: SchoolBrandProps) {
  const style = variantStyles[variant];

  return (
    <div className={cn("flex items-center", style.root, className)}>
      <div
        className={cn(
          "shrink-0 overflow-hidden border",
          variant === "sidebar-ink" ? "border-nav-border bg-white" : "border-border bg-white",
          style.frame,
        )}
      >
        <Image
          src={variant === "hero" ? schoolBrand.logo : schoolBrand.emblem}
          alt={`${schoolBrand.name} logo`}
          width={variant === "hero" ? 1500 : 344}
          height={variant === "hero" ? 1500 : 283}
          sizes={variant === "hero" ? "64px" : "44px"}
          preload={preload}
          className="h-full w-full object-contain"
        />
      </div>

      {variant === "icon" ? null : (
        <div className="min-w-0">
          <p className={style.eyebrow}>{schoolBrand.name}</p>
          <h2 className={style.title}>VPPS One</h2>
          <p className={style.subtitle}>{schoolBrand.location}</p>
        </div>
      )}
    </div>
  );
}
