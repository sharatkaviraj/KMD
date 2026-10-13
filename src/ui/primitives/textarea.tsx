import * as React from "react";

import { cn } from "@/platform/utils";

type TextareaProps = React.ComponentProps<"textarea"> & {
  autoGrow?: boolean;
};

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoGrow = true, onInput, ...props }, forwardedRef) => {
    const innerRef = React.useRef<HTMLTextAreaElement>(null);

    React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement);

    const resize = React.useCallback(() => {
      const element = innerRef.current;
      if (!element || !autoGrow) return;

      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    }, [autoGrow]);

    React.useEffect(() => {
      resize();
    }, [props.value, resize]);

    return (
      <textarea
        ref={innerRef}
        className={cn(
          "flex min-h-[96px] w-full rounded-[12px] border border-border-strong bg-surface text-foreground",
          "px-3.5 py-3 text-[15px] leading-normal transition-[border-color,box-shadow,background-color] duration-200 max-md:text-base",
          "placeholder:text-subtle-foreground",
          "focus-visible:outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent-soft",
          "disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-surface-2",
          "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/30",
          className,
        )}
        onInput={(event) => {
          resize();
          onInput?.(event);
        }}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
