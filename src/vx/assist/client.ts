"use client";

import { useCallback, useRef, useState } from "react";

import type { AssistDecision, AssistOutcome, AssistProblem } from "@/modules/assist/domain/features";
import type { AssistTaskId, TaskInput, TaskOutput } from "@/modules/assist/domain/tasks";
import { p, type Pair } from "@/vx/text";

/** Ask for a draft. Never throws: a dropped connection is "busy", like a busy API. */
export async function askAssist<K extends AssistTaskId>(task: K, input: TaskInput<K>): Promise<AssistOutcome<TaskOutput<K>>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 75_000);
  try {
    const response = await fetch("/api/assist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task, input }),
      signal: controller.signal,
    });
    if (response.status === 401) return { ok: false, problem: "denied" };
    const body = (await response.json().catch(() => null)) as AssistOutcome<TaskOutput<K>> | null;
    return body && typeof body.ok === "boolean" ? body : { ok: false, problem: "failed" };
  } catch {
    return { ok: false, problem: "busy" };
  } finally {
    clearTimeout(timer);
  }
}

/** What the person did with the draft. Fire and forget: it is a count, not a save. */
export function reportDecision(logId: string | null, decision: AssistDecision): void {
  if (!logId) return;
  void fetch("/api/assist", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ logId, decision }),
    keepalive: true,
  }).catch(() => undefined);
}

/** One sentence per problem. None is an error page: the person can always write it themselves. */
export const PROBLEM_TEXT: Record<AssistProblem, Pair> = {
  off: p("The AI helper is switched off. You can write it yourself as usual.", "AI सहायक अभी बंद है। आप पहले की तरह खुद लिख सकते हैं।"),
  denied: p("The AI helper is not available for this.", "इसके लिए AI सहायक उपलब्ध नहीं है।"),
  daily_cap: p("You have used today’s AI suggestions. They come back tomorrow.", "आज के AI सुझाव पूरे हो गए। कल फिर मिलेंगे।"),
  budget: p("This month’s AI budget is used up. The admin can raise it in Settings.", "इस महीने का AI बजट पूरा हो गया। एडमिन सेटिंग्स में बढ़ा सकते हैं।"),
  invalid: p("There is not enough here to work with yet.", "अभी इतना नहीं लिखा कि AI मदद कर सके।"),
  refused: p("The AI could not write this one. Please write it yourself.", "AI यह नहीं लिख सका। कृपया खुद लिखें।"),
  busy: p("The AI helper is busy. Try again in a minute.", "AI सहायक व्यस्त है। एक मिनट बाद फिर कोशिश करें।"),
  failed: p("That did not work. Try again, or write it yourself.", "यह नहीं हो पाया। फिर कोशिश करें या खुद लिखें।"),
};

/** The line under every AI suggestion, so nobody mistakes it for the school's words. */
export const DRAFT_NOTE = p("Written by AI — read and change it before you save.", "AI ने लिखा है — सहेजने से पहले पढ़ें और ज़रूरत हो तो बदलें।");
export const PRIVACY_NOTE = p("The child’s name and phone numbers are removed before the AI sees it.", "AI तक जाने से पहले बच्चे का नाम और फ़ोन नंबर हटा दिए जाते हैं।");

export type AssistState<T> =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "ready"; value: T; logId: string | null }
  | { kind: "problem"; problem: AssistProblem };

/**
 * The state every AI button shares: idle → working → ready (a suggestion to
 * use or throw away) or a one-line problem. `run` ignores a second press
 * while the first is working, and a reply that arrives after the person has
 * moved on (`reset`) is dropped.
 */
export function useAssistTask<K extends AssistTaskId>(task: K) {
  const [state, setState] = useState<AssistState<TaskOutput<K>>>({ kind: "idle" });
  const ticket = useRef(0);

  const run = useCallback(
    async (input: TaskInput<K>): Promise<AssistOutcome<TaskOutput<K>> | null> => {
      if (state.kind === "working") return null;
      const mine = ++ticket.current;
      setState({ kind: "working" });
      const result = await askAssist(task, input);
      if (mine !== ticket.current) return null;
      setState(result.ok ? { kind: "ready", value: result.value, logId: result.logId } : { kind: "problem", problem: result.problem });
      return result;
    },
    [task, state.kind],
  );

  const reset = useCallback(() => {
    ticket.current++;
    setState({ kind: "idle" });
  }, []);

  /** Used it, or threw it away: counted once, then back to idle. */
  const decide = useCallback(
    (decision: AssistDecision) => {
      if (state.kind === "ready") reportDecision(state.logId, decision);
      reset();
    },
    [state, reset],
  );

  return { state, run, reset, decide };
}
