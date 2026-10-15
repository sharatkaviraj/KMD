"use client";

import { createContext, Fragment, useContext, useState, useTransition, type ReactNode } from "react";

import { checkCoverCommandAction, coverCommandAction } from "@/app/(app)/substitutions/actions";
import { m } from "@/messages";
import {
  idleCoverState,
  receiptSentence,
  type CoverState,
} from "@/modules/substitutions/domain/cover-state";
import { primary, secondary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/*
 * The client half of the cover command (P3).
 *
 * A form mints its submission id once, when it is drawn, and keeps it until it
 * gets a definite answer. That is what makes every failure safe to retry:
 *
 *   - a double click sends the same id twice, and the second gets the first's
 *     receipt;
 *   - an answer that never arrives (a dropped connection on a phone) is not
 *     reported as "not saved". The form asks the server whether that id
 *     committed — "Checking whether this saved" — and only offers "Try again"
 *     when it did not. Trying again sends the same id, so it cannot commit
 *     twice.
 *
 * The last outcome is shown once, at the top of the page, so a receipt
 * survives the duty card it came from being redrawn.
 */

type Outcome = CoverState | { status: "checking"; message: null; receipt: null };

const ResultContext = createContext<{ outcome: Outcome; set: (outcome: Outcome) => void }>({
  outcome: idleCoverState,
  set: () => {},
});

export function CoverResultProvider({ children }: { children: ReactNode }) {
  const [outcome, set] = useState<Outcome>(idleCoverState);
  return <ResultContext.Provider value={{ outcome, set }}>{children}</ResultContext.Provider>;
}

/** The last command's outcome, in words. Polite live region, so it is announced. */
export function CoverResultBanner() {
  const language = useLanguage();
  const { outcome } = useContext(ResultContext);

  if (outcome.status === "idle") return null;
  if (outcome.status === "checking") {
    return <Notice className="mb-4" tone="info" text={m.coverChecking} language={language} />;
  }
  if (outcome.status === "saved" && outcome.receipt) {
    const sentence = receiptSentence(outcome.receipt);
    return (
      <Notice
        className="mb-4"
        tone={outcome.receipt.needsHelp > 0 ? "warning" : "success"}
        text={outcome.receipt.replayed ? m.coverAlreadySaved : m.coverSaved}
        language={language}
      >
        <p className="text-[14px] font-medium">{primary(sentence, language)}</p>
        {secondary(sentence, language) ? (
          <p className="text-[13px]">{secondary(sentence, language)}</p>
        ) : null}
      </Notice>
    );
  }
  return outcome.message ? (
    <Notice
      className="mb-4"
      tone={outcome.status === "stale" ? "warning" : "danger"}
      text={outcome.message}
      language={language}
    />
  ) : null;
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
      );
}

/**
 * A form that sends one cover command.
 *
 * `fields` are the intent's own inputs, rendered inside; the day, its revision
 * and the submission id are added here so no caller can forget them.
 *
 * `resetOnSave` draws the fields afresh after a definite save, so the absence
 * form does not sit there still naming the teacher just saved — an invitation
 * to save her twice.
 */
export function CoverCommandForm({
  intent,
  day,
  dayRevision,
  label,
  children,
  hidden = {},
  variant = "primary",
  size = "default",
  fullWidth = false,
  resetOnSave = false,
  className,
}: {
  intent: "absence" | "clear_absence" | "assign" | "release" | "refresh";
  day: string;
  dayRevision: number;
  label: Localized;
  children?: ReactNode;
  hidden?: Record<string, string>;
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "default" | "lg";
  fullWidth?: boolean;
  resetOnSave?: boolean;
  className?: string;
}) {
  const language = useLanguage();
  const { set } = useContext(ResultContext);
  const [commandId, setCommandId] = useState(newId);
  const [pending, start] = useTransition();
  const [retry, setRetry] = useState<FormData | null>(null);
  const [generation, setGeneration] = useState(0);
  const saved = () => {
    setCommandId(newId());
    if (resetOnSave) setGeneration((value) => value + 1);
  };

  const send = (data: FormData) => {
    start(async () => {
      try {
        const result = await coverCommandAction(idleCoverState, data);
        // After an await, updates are no longer part of the transition: set
        // alone, the receipt drew at once while the duty list still waited for
        // the refreshed page ("3 duties assigned" over "assigned 2 · Saving…",
        // school-day run B15). Marked again, they land together.
        start(() => {
          set(result);
          setRetry(result.status === "error" ? data : null);
          // A definite answer ends this submission; the next one is new.
          if (result.status === "saved") saved();
          else if (result.status !== "error") setCommandId(newId());
        });
        if (result.status === "error") await confirm(data);
      } catch {
        await confirm(data);
      }
    });
  };

  // No answer, or an error after which the commit may still have landed:
  // ask before offering to try again.
  const confirm = async (data: FormData) => {
    set({ status: "checking", message: null, receipt: null });
    try {
      const check = await checkCoverCommandAction(commandId);
      if (check.status === "saved") {
        set(check);
        setRetry(null);
        saved();
        return;
      }
    } catch {
      // Still offline: say so, keep the same id for the retry.
    }
    set({ status: "error", message: m.coverNotSavedRetry, receipt: null });
    setRetry(data);
  };

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        send(data);
      }}
    >
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="day" value={day} />
      <input type="hidden" name="dayRevision" value={dayRevision} />
      <input type="hidden" name="commandId" value={commandId} />
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Fragment key={generation}>{children}</Fragment>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant={variant}
          size={size}
          fullWidth={fullWidth}
          loading={pending}
          loadingText={primary(m.saving, language)}
        >
          {primary(label, language)}
        </Button>
        {retry && !pending ? (
          <Button type="button" variant="outline" size={size} onClick={() => send(retry)}>
            {primary(m.tryAgain, language)}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
