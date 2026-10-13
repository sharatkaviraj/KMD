"use client";

import * as React from "react";

import { cn } from "@/platform/utils";

type InputProps = React.ComponentProps<"input"> & {
  /** Legacy: scrolls the input into view on focus. Off by default — interferes with mobile keyboards. */
  scrollIntoViewOnFocus?: boolean;
  /** Visual size. `default` 36px desktop / 44px mobile. */
  inputSize?: "sm" | "default" | "lg";
};

const sizeClasses: Record<NonNullable<InputProps["inputSize"]>, string> = {
  sm: "h-9 px-3 text-sm max-md:h-11 max-md:text-base",
  default: "h-11 px-3.5 text-[15px] max-md:text-base",
  lg: "h-12 px-4 text-base",
};

/**
 * On a phone the wrong soft keyboard costs a tap and an error every time —
 * a number pad for a phone number, a letter keyboard for an amount. These
 * were previously opt-in per call site, so only the Payment Desk got them
 * right. Deriving from `type` makes every field correct by default; any call
 * site can still override by passing inputMode/enterKeyHint explicitly.
 */
const inputModeByType: Partial<Record<string, React.HTMLAttributes<HTMLInputElement>["inputMode"]>> = {
  tel: "tel",
  email: "email",
  url: "url",
  search: "search",
  number: "decimal",
};

const enterKeyHintByType: Partial<Record<string, React.InputHTMLAttributes<HTMLInputElement>["enterKeyHint"]>> = {
  search: "search",
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      onFocus,
      scrollIntoViewOnFocus = false,
      inputSize = "default",
      inputMode,
      enterKeyHint,
      ...props
    },
    ref,
  ) => {
    return (
      <input
        type={type}
        ref={ref}
        inputMode={inputMode ?? (type ? inputModeByType[type] : undefined)}
        enterKeyHint={enterKeyHint ?? (type ? enterKeyHintByType[type] : undefined)}
        className={cn(
          "flex w-full rounded-[12px] border border-border-strong bg-surface text-foreground",
          "transition-[border-color,box-shadow,background-color] duration-200",
          "placeholder:text-subtle-foreground",
          "focus-visible:outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent-soft",
          "disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-2",
          "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/30",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          sizeClasses[inputSize],
          className,
        )}
        onFocus={(event) => {
          if (scrollIntoViewOnFocus) {
            const target = event.currentTarget;
            setTimeout(() => {
              target.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 320);
          }
          onFocus?.(event);
        }}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
