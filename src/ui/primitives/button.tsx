import * as React from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/platform/utils";

/**
 * Cut down from the fee app's button (`schoolfees/src/ui/primitives/button.tsx`).
 *
 * Dropped: `asChild`/Radix Slot and `cva`, neither of which earns a dependency
 * at this size. Kept, because they are the parts that were learned on these
 * users' phones: the 44px minimum tap target below `md`, the disabled and busy
 * states, and one accent variant reserved for a single hero action per screen.
 */

type Variant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "accent"
  | "destructive";

type Size = "sm" | "default" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/92",
  secondary: "bg-secondary text-secondary-foreground hover:bg-surface-3",
  outline:
    "border border-border bg-surface text-foreground shadow-xs hover:bg-surface-2 hover:border-border-strong",
  ghost: "text-foreground hover:bg-surface-2",
  accent: "bg-accent text-accent-foreground shadow-xs hover:bg-accent/92",
  destructive:
    "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/92",
};

/**
 * `max-md:` bumps every size to 44px on a phone. The desktop heights are the
 * comfortable ones for a mouse; the phone heights are the ones a thumb can
 * hit while standing in a corridor.
 */
const SIZES: Record<Size, string> = {
  sm: "h-9 px-3 text-sm max-md:h-11 max-md:px-4",
  default: "h-10 px-4 text-[15px] max-md:h-12",
  lg: "h-12 px-5 text-base",
  icon: "h-10 w-10 max-md:h-11 max-md:w-11",
};

/**
 * The button's look, for an element that must not be a `<button>`.
 *
 * A `<Link>` nested inside a `<button>` is invalid HTML and behaves
 * unpredictably — a navigation and a form control fighting over the same tap.
 * Anything that navigates is an anchor wearing these classes instead.
 */
export function buttonClasses({
  variant = "primary",
  size = "default",
  fullWidth = false,
  className,
}: {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  className?: string;
} = {}) {
  return cn(
    "focus-ring relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out",
    "active:translate-y-[0.5px]",
    "[&_svg]:size-4 [&_svg]:shrink-0",
    VARIANTS[variant],
    SIZES[size],
    fullWidth && "w-full",
    className,
  );
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  loadingText?: string;
  fullWidth?: boolean;
};

export function Button({
  className,
  variant = "primary",
  size = "default",
  loading = false,
  loadingText,
  fullWidth = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "focus-ring relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold",
        "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out",
        "disabled:pointer-events-none disabled:opacity-60",
        "active:translate-y-[0.5px]",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      // A button that is working is disabled, so a second tap on a slow
      // connection cannot submit the form twice.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          {loadingText ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
