import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/platform/utils";

const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[12px] text-sm font-semibold",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-60",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    "active:scale-[.97]",
  ].join(" "),
  {
    variants: {
      variant: {
        // Solid ink — default for confirm/save actions
        primary:
          "bg-primary text-primary-foreground hover:brightness-110",
        // Tonal neutral — quieter than primary; for medium-emphasis actions
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-surface-3",
        // Reserved for the SINGLE hero CTA per screen (saffron)
        accent:
          "bg-accent text-accent-foreground hover:brightness-110",
        // Quiet bordered button — most secondary actions
        outline:
          "border border-border-strong bg-surface text-foreground hover:bg-surface-2",
        // Tonal — implies importance without solid color (uses accent-soft)
        soft:
          "bg-accent-soft text-accent-soft-foreground hover:brightness-[.96]",
        // Borderless — toolbars, compact actions
        ghost:
          "text-foreground hover:bg-surface-2",
        // Destructive
        destructive:
          "bg-destructive text-destructive-foreground hover:brightness-110",
        "destructive-outline":
          "border border-destructive/40 bg-surface text-destructive-soft-foreground hover:bg-destructive-soft hover:border-destructive/60",
        // Inline link
        link:
          "text-accent underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        sm: "h-9 px-3 text-[13px]",
        default: "h-10 px-4",
        lg: "h-11 px-5 text-[15px]",
        // Mobile-default — bigger tap target
        mobile: "h-11 px-4 text-sm",
        icon: "h-10 w-10",
        "icon-sm": "h-9 w-9",
        "icon-lg": "h-11 w-11",
      },
    },
    /*
     * Every size is at least 44px on a phone.
     *
     * The fee app shipped `sm` at `max-md:h-10` — 40px — and `icon-sm` with no
     * bump at all. This app holds a stricter line, recorded in PLAN §3a and
     * asserted by `tests/e2e/responsive-baseline.spec.ts`: principal phone
     * targets are 44px minimum, preferably 48. That is a product decision,
     * stronger than WCAG 2.2's 24px, made because these screens are used
     * standing up with a register in the other hand.
     *
     * So this is a deliberate divergence from the fee app, and in the
     * direction that costs nobody anything: the suite caught six screens where
     * a 40px button had arrived, including "Take attendance", which is the one
     * control a teacher taps every single morning.
     */
    compoundVariants: [
      { size: "default", class: "max-md:h-11 max-md:px-4" },
      { size: "sm", class: "max-md:h-11" },
      { size: "icon", class: "max-md:h-11 max-md:w-11" },
      { size: "icon-sm", class: "max-md:h-11 max-md:w-11" },
      { size: "icon-lg", class: "max-md:h-12 max-md:w-12" },
      { size: "lg", class: "max-md:h-12" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

// Backwards-compat: existing call sites use variant="default" — alias to primary
type LegacyVariant = "default";
type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]> | LegacyVariant;
type ButtonSize = VariantProps<typeof buttonVariants>["size"];

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  asChild?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  /** Expand to fill container width. Useful for mobile CTAs. */
  fullWidth?: boolean;
}

function resolveVariant(variant?: ButtonVariant) {
  if (!variant || variant === "default") return "primary" as const;
  return variant;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      loadingText,
      leadingIcon,
      trailingIcon,
      fullWidth = false,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const resolvedVariant = resolveVariant(variant);
    const buttonClassName = cn(
      buttonVariants({ variant: resolvedVariant, size, className }),
      fullWidth && "w-full",
    );
    const busy = loading || undefined;

    if (asChild && !loading && !leadingIcon && !trailingIcon) {
      return (
        <Slot
          ref={ref}
          className={buttonClassName}
          aria-busy={busy}
          {...props}
        >
          {children}
        </Slot>
      );
    }

    return (
      <Comp
        ref={ref}
        className={buttonClassName}
        disabled={disabled || loading}
        aria-busy={busy}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {asChild ? <Slottable>{loadingText ?? children}</Slottable> : loadingText ?? children}
          </>
        ) : (
          <>
            {leadingIcon}
            {asChild ? <Slottable>{children}</Slottable> : children}
            {trailingIcon}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

/**
 * The class string on its own, for something that navigates.
 *
 * A `<Link>` nested inside a `<button>` is invalid HTML and behaves like it,
 * so anything that goes somewhere is an anchor wearing these classes instead.
 * Twenty-six files in this app already call it by this name; keeping the name
 * is what let the fee app's button replace this app's without touching any of
 * them.
 *
 * `fullWidth` is a real variant on `<Button>` but not on `buttonVariants`, so
 * it is applied here — otherwise every ported and every existing call site
 * would disagree about what the prop does.
 */
export function buttonClasses({
  variant,
  size,
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}) {
  return cn(
    buttonVariants({
      // `default` is the fee app's own legacy alias for `primary`; accepting
      // it here keeps the two spellings meaning one thing.
      variant: variant === "default" ? "primary" : variant,
      size,
    }),
    fullWidth && "w-full",
    className,
  );
}

export { Button, buttonVariants };
