"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { ReadyDraftView } from "@/modules/assist/domain/drafts";
import type { AssistDecision } from "@/modules/assist/domain/features";

import { reportDecision } from "./client";
import { useAssistOffers } from "./context";

/*
 * The drafts the app prepared for this person (D-418), kept small and apart
 * from the card that shows them, so a screen that only needs to know whether
 * anything is waiting does not carry the card's code (bundle budget).
 */

/* ---------------------------------------------------------- one shared list */

type Store = { drafts: ReadyDraftView[]; loaded: boolean };
let store: Store = { drafts: [], loaded: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const SERVER: Store = { drafts: [], loaded: false };

/** Read once per page load and shared by every card that shows a prepared draft. */
function load() {
  loading ??= fetch("/api/assist/drafts", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { drafts: [] }))
    .then((body: { drafts?: ReadyDraftView[] }) => {
      store = { drafts: Array.isArray(body.drafts) ? body.drafts : [], loaded: true };
      emit();
    })
    .catch(() => {
      store = { drafts: [], loaded: true };
      emit();
    });
}

/** Used, changed or put aside: off the list at once, recorded in the background. */
export function decideReadyDraft(draft: ReadyDraftView, decision: AssistDecision) {
  store = { ...store, drafts: store.drafts.filter((d) => d.id !== draft.id) };
  emit();
  void fetch("/api/assist/drafts", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: draft.id, decision }),
    keepalive: true,
  }).catch(() => (draft.logId ? reportDecision(draft.logId, decision) : undefined));
}

/**
 * The drafts the app prepared for this person (D-418). Nothing is fetched for
 * someone who is offered neither cover plans nor summaries.
 */
export function useReadyDrafts(): Store {
  const cover = useAssistOffers("cover");
  const summary = useAssistOffers("summary");
  const wanted = cover || summary;
  useEffect(() => {
    if (wanted) load();
  }, [wanted]);
  return useSyncExternalStore(subscribe, () => store, () => SERVER);
}
