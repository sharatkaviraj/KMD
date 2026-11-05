import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";

import { DRAFT_PURGE_GRACE_DAYS, readDraft, type DraftKind, type ReadyDraft } from "../domain/drafts";
import type { AssistDecision } from "../domain/features";
import { recordDecision } from "./log";

/**
 * `vppsone.assist_drafts` (migration 20261105063256): drafts the app prepares
 * for one member of staff (D-418). Service role only, after the caller's own
 * checks; every read and write names the person it is for.
 */

const COLUMNS = "id, kind, ref, title_en, title_hi, href, log_id, created_at, payload";

export async function saveDraft(row: {
  staffProfileId: string;
  kind: DraftKind;
  ref: string;
  sessionLabel: string;
  title: { en: string; hi: string };
  href: string | null;
  payload: unknown;
  logId: string | null;
  expiresAt: Date;
}): Promise<void> {
  const { error } = await createAdminClient()
    .from("assist_drafts")
    .upsert(
      {
        staff_profile_id: row.staffProfileId,
        kind: row.kind,
        ref: row.ref,
        session_label: row.sessionLabel,
        title_en: row.title.en.slice(0, 160),
        title_hi: row.title.hi.slice(0, 160),
        href: row.href,
        payload: row.payload,
        log_id: row.logId,
        created_at: new Date().toISOString(),
        expires_at: row.expiresAt.toISOString(),
        decision: null,
        decided_at: null,
      },
      { onConflict: "staff_profile_id,kind,ref" },
    );
  if (error) throw new Error(`Could not keep the prepared draft: ${error.message}`);
}

/** The refs of one kind that already have a draft for these people, so a rerun spends nothing twice. */
export async function draftedRefs(kind: DraftKind, refs: readonly string[]): Promise<Set<string>> {
  if (!refs.length) return new Set();
  const { data, error } = await createAdminClient().from("assist_drafts").select("ref, staff_profile_id").eq("kind", kind).in("ref", [...refs].slice(0, 200));
  if (error) throw new Error(`Could not read prepared drafts: ${error.message}`);
  return new Set(((data ?? []) as { ref: string; staff_profile_id: string }[]).map((r) => `${r.staff_profile_id}:${r.ref}`));
}

/** What is waiting for this person in this session: not yet used or put aside, not expired. Newest first. */
export async function readyDraftsFor(staffProfileId: string, sessionLabel: string, now = new Date()): Promise<ReadyDraft[]> {
  const { data, error } = await createAdminClient()
    .from("assist_drafts")
    .select(COLUMNS)
    .eq("staff_profile_id", staffProfileId)
    .eq("session_label", sessionLabel)
    .is("decision", null)
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Parameters<typeof readDraft>[0][]).map(readDraft).filter((d): d is ReadyDraft => d !== null);
}

/**
 * Used, changed or put aside: the draft leaves the strip, and the log row it
 * came from gets the same decision (the measure of whether it earns its cost).
 */
export async function decideDraft(id: string, staffProfileId: string, decision: AssistDecision): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("assist_drafts")
    .update({ decision, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("staff_profile_id", staffProfileId)
    .is("decision", null)
    .select("log_id")
    .returns<{ log_id: string | null }[]>();
  if (error) throw new Error(error.message);
  const logId = data?.[0]?.log_id;
  if (logId) await recordDecision(logId, staffProfileId, decision).catch(() => undefined);
  return Boolean(data?.length);
}

/** Expired drafts past the grace days. Counts only. */
export async function purgeDrafts(now = new Date()): Promise<number> {
  const cutoff = new Date(now.valueOf() - DRAFT_PURGE_GRACE_DAYS * 86_400_000).toISOString();
  const { count, error } = await createAdminClient().from("assist_drafts").delete({ count: "exact" }).lt("expires_at", cutoff);
  if (error) throw new Error(`Could not clear old prepared drafts: ${error.message}`);
  return count ?? 0;
}
