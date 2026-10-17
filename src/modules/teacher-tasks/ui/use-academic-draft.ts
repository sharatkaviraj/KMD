"use client";
import { useEffect, useRef, useState } from "react";
import { draftKey, readDraft, type DraftEnvelope } from "@/platform/drafts/policy";
import { loadDraft, removeDraft, saveDraft } from "@/platform/drafts/store";
import { useOnline } from "@/platform/drafts/use-durable-draft";
import type { AcademicWork } from "../data/repo";
import { validAcademicDraft, type AcademicDraft } from "../domain/academic-draft";

/** Mounted inside an editor keyed by scope, so asynchronous recovery cannot cross it. */
export function useAcademicDraft(work: AcademicWork) {
  const key = draftKey(work.draftScope, work.session, work.taskId);
  const baseline = String(work.revision);
  const [ready, setReady] = useState(false);
  const [recovered, setRecovered] = useState<DraftEnvelope<AcademicDraft> | null>(null);
  const [status, setStatus] = useState<"idle" | "writing" | "local" | "school" | "error">("idle");
  const generation = useRef(0);
  const initial = useRef(work);
  const online = useOnline();

  useEffect(() => {
    let cancelled = false;
    void loadDraft(key).then(raw => {
      if (cancelled) return;
      setRecovered(readDraft(raw, (value): value is AcademicDraft => validAcademicDraft(initial.current, value)));
      setReady(true);
    }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [key]);

  const persist = async (value: AcademicDraft): Promise<boolean> => {
    const current = ++generation.current;
    setStatus("writing");
    try {
      await saveDraft(key, { version: 1, baseline, value, updatedAt: Date.now() });
      if (current === generation.current) setStatus("local");
      return true;
    } catch {
      if (current === generation.current) setStatus("error");
      return false;
    }
  };
  const clear = async () => {
    ++generation.current;
    try { await removeDraft(key); setRecovered(null); setStatus("school"); }
    catch { setStatus("error"); }
  };
  return { ready, recovered, status, online, persist, clear, dismissRecovery: () => setRecovered(null), changed: recovered !== null && recovered.baseline !== baseline };
}
