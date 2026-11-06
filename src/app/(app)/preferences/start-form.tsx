"use client";

import { useActionState } from "react";
import { ExternalLink } from "lucide-react";

import { saveStartAction, type PreferencesState } from "./actions";
import * as m from "@/messages/pairs";
import { primary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { cn } from "@/platform/utils";
import { Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

const idle: PreferencesState = { status: "idle", message: null };

/**
 * One option, flattened for the client boundary.
 *
 * Deliberately not the `StartDestination` itself: that carries the whole app
 * registry entry, including URL builders, and a function does not cross the
 * boundary. The server has already decided which options this role may have,
 * so the client renders a list and posts one value back — it does not get to
 * widen the set.
 */
export type StartChoice = {
  /** "" for the role's own Home, a path, or `app:<id>`. */
  value: string;
  label: Localized;
  hint: Localized;
  /** Drawn with the external mark, and the reason for the warning below. */
  external: boolean;
};

export function StartForm({
  choices,
  current,
}: {
  choices: StartChoice[];
  /** The stored value as it resolves today — "" when it is the role Home. */
  current: string;
}) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(saveStartAction, idle);
  const anyExternal = choices.some((choice) => choice.external);

  return (
    <form action={action} className="space-y-4">
      {state.message ? (
        <Notice
          tone={state.status === "error" ? "danger" : "success"}
          text={state.message}
          language={language}
        />
      ) : null}

      <fieldset className="space-y-2">
        <legend className="sr-only">{primary(m.startTitle, language)}</legend>

        {choices.map((choice) => {
          const id = `start-${choice.value || "home"}`;

          return (
            <label
              key={choice.value}
              htmlFor={id}
              className={cn(
                // 56px, and the whole row is the target rather than the 20px
                // radio inside it.
                "flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3",
                "transition-colors",
                choice.value === current
                  ? "border-accent bg-accent-soft text-accent-soft-foreground"
                  : "border-border bg-surface hover:bg-surface-2",
              )}
            >
              <input
                type="radio"
                id={id}
                name="start"
                value={choice.value}
                defaultChecked={choice.value === current}
                className="size-5 shrink-0 accent-accent"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[16px] font-medium">
                  <span className="min-w-0 truncate">
                    {primary(choice.label, language)}
                  </span>
                  {choice.external ? (
                    <ExternalLink aria-hidden className="size-4 shrink-0 opacity-70" />
                  ) : null}
                </span>
                <span className="block text-[13px] text-subtle-foreground">
                  {primary(choice.hint, language)}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {/* Only where it can actually happen. An account with no sibling app
          offered would be reading a warning about a choice it does not have. */}
      {anyExternal ? (
        <Notice tone="info" text={m.startLeavesAppWarning} language={language} />
      ) : null}

      <Button
        type="submit"
        fullWidth
        loading={pending}
        loadingText={primary(m.saving, language)}
      >
        {primary(m.save, language)}
      </Button>
    </form>
  );
}
