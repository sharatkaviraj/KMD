"use client";

import { useActionState } from "react";

import { saveNoticePrefsAction, saveWhatsappConsentAction, type PreferencesState } from "./actions";
import { staffWhatsappMessages as w } from "@/messages/setup";
import { flat, primary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

const idle: PreferencesState = { status: "idle", message: null };

export type WhatsappKindChoice = { kind: string; label: Localized; enabled: boolean };

/**
 * Yes or no to WhatsApp from the school app, and which kinds (go-live Phase F).
 * The server decides what is shown; both forms post to actions that act on the
 * signed-in person's own row only.
 */
export function WhatsappForm({
  state,
  since,
  hasNumber,
  kinds,
}: {
  state: "yes" | "no_consent" | "opted_out";
  since: Localized | null;
  hasNumber: boolean;
  kinds: WhatsappKindChoice[];
}) {
  const language = useLanguage();
  const [consent, consentAction, consentPending] = useActionState(saveWhatsappConsentAction, idle);
  const [prefs, prefsAction, prefsPending] = useActionState(saveNoticePrefsAction, idle);
  const stateText = state === "yes" ? w.stateYes : state === "opted_out" ? w.stateOptedOut : w.stateNo;

  return (
    <div className="space-y-4" data-testid="whatsapp-consent">
      <p className="text-sm text-muted-foreground">{flat(w.help, language)}</p>
      {consent.message ? (
        <Notice tone={consent.status === "error" ? "danger" : "success"} text={consent.message} language={language} />
      ) : null}
      <p className="text-sm font-medium">
        {primary(stateText, language)}
        {since ? <span className="text-muted-foreground"> · {primary(since, language)}</span> : null}
      </p>
      {!hasNumber ? <p className="text-sm text-muted-foreground">{flat(w.noNumber, language)}</p> : null}
      <form action={consentAction}>
        <input type="hidden" name="whatsapp" value={state === "yes" ? "no" : "yes"} />
        <Button type="submit" variant={state === "yes" ? "outline" : "primary"} size="sm" disabled={consentPending}>
          {primary(state === "yes" ? w.optOut : w.optIn, language)}
        </Button>
      </form>

      {state === "yes" ? (
        <form action={prefsAction} className="space-y-2 border-t border-border pt-4">
          <p className="text-sm font-semibold">{primary(w.kindsTitle, language)}</p>
          <p className="text-sm text-muted-foreground">{flat(w.kindsHelp, language)}</p>
          {prefs.message ? (
            <Notice tone={prefs.status === "error" ? "danger" : "success"} text={prefs.message} language={language} />
          ) : null}
          <fieldset className="grid gap-1 sm:grid-cols-2">
            <legend className="sr-only">{primary(w.kindsTitle, language)}</legend>
            {kinds.map((choice) => (
              <label key={choice.kind} className="flex min-h-11 items-center gap-3 rounded-xl px-2 text-sm">
                <input
                  type="checkbox"
                  name="kind"
                  value={choice.kind}
                  defaultChecked={choice.enabled}
                  className="size-5 shrink-0 accent-accent"
                />
                {primary(choice.label, language)}
              </label>
            ))}
          </fieldset>
          <Button type="submit" variant="outline" size="sm" disabled={prefsPending}>
            {primary(w.saveKinds, language)}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
