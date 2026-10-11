import "server-only";

import { createHash } from "node:crypto";

import { saveMarksCommand } from "@/modules/assessments/data/assessments-repo";
import { marksRefusals, saveMarksSchema, type SaveMarksInput } from "@/modules/assessments/domain/marks-command";
import { createAdminClient } from "@/platform/supabase/admin";
import { p, type Pair } from "@/vx/text";

import { studentsByIds } from "./data";
import type { SaveOutcome, SavePayload } from "./save-types";

/*
 * One door for every marks save on the vx screens — the exam office's grid,
 * the teacher's sheet and the no-login marks link. Each caller has decided
 * who the actor is; `save_marks` decides everything else again in the
 * transaction that writes (P7), and a locked class refuses there too.
 */

const EXTRA: Record<string, Pair> = {
  paper_locked: p(
    "Results for this class are locked. Ask the exam office to unlock it before changing a mark.",
    "इस कक्षा का परिणाम बंद है। अंक बदलने से पहले परीक्षा विभाग से खुलवाएँ।",
  ),
  too_late: p(
    "More than ten minutes have passed. Ask the exam office to hand the paper back.",
    "दस मिनट से ज़्यादा हो गए। पेपर वापस खुलवाने के लिए परीक्षा विभाग से कहें।",
  ),
};

export function refusal(reason: string): Pair {
  if (EXTRA[reason]) return EXTRA[reason];
  const known = marksRefusals[reason] ?? marksRefusals.failed;
  return { en: known.en, hi: known.hi };
}

function payloadHash(input: SaveMarksInput): string {
  const entries = [...input.entries].sort((a, b) => a.studentId.localeCompare(b.studentId));
  return createHash("sha256")
    .update(
      JSON.stringify({
        paperId: input.paperId,
        kind: input.kind,
        expectedRevision: input.expectedRevision,
        reason: input.reason,
        entries: entries.map((e) => [e.studentId, e.state, e.state === "value" ? e.value : null]),
      }),
    )
    .digest("hex");
}

export async function commitMarks(actorStaffId: string, raw: SavePayload): Promise<SaveOutcome> {
  const parsed = saveMarksSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "bad_request", message: refusal("bad_request") };

  let outcome;
  try {
    outcome = await saveMarksCommand({ ...parsed.data, actorStaffId, payloadHash: payloadHash(parsed.data) });
  } catch {
    return { ok: false, reason: "failed", message: refusal("failed") };
  }

  if (outcome.outcome === "saved") {
    const r = outcome.receipt;
    return { ok: true, revision: r.revision, entryStatus: r.entryStatus, savedAt: r.savedAt, actorName: r.actorName, changed: r.changed, counts: r.counts, replayed: r.replayed };
  }
  if (outcome.outcome === "stale") return { ok: false, reason: "stale", message: refusal("stale") };
  if (outcome.outcome === "incomplete") {
    const names = await studentsByIds(outcome.blank).catch(() => new Map());
    return {
      ok: false,
      reason: "incomplete",
      message: refusal("incomplete"),
      who: outcome.blank.map((id) => names.get(id)?.name ?? "—"),
    };
  }
  if (outcome.outcome === "invalid") {
    const names = outcome.studentId ? await studentsByIds([outcome.studentId]).catch(() => new Map()) : new Map();
    return {
      ok: false,
      reason: outcome.reason,
      message: refusal(outcome.reason),
      who: outcome.studentId ? [names.get(outcome.studentId)?.name ?? "—"] : [],
    };
  }
  return { ok: false, reason: outcome.reason, message: refusal(outcome.reason) };
}

/** A teacher takes back her own submission inside ten minutes (`withdraw_marks_submission`). */
export async function withdrawMarks(actorStaffId: string, paperId: string, expectedRevision: number): Promise<SaveOutcome> {
  if (!/^[0-9a-f-]{36}$/i.test(paperId) || !Number.isInteger(expectedRevision)) {
    return { ok: false, reason: "bad_request", message: refusal("bad_request") };
  }
  const { data, error } = await createAdminClient().rpc("withdraw_marks_submission", {
    p: { actor_staff_id: actorStaffId, paper_id: paperId, expected_revision: expectedRevision },
  });
  if (error) {
    const named = error.message.match(/marks:([a-z_]+)/);
    const reason = named?.[1] ?? "failed";
    return { ok: false, reason, message: refusal(reason) };
  }
  const row = data as { ok: boolean; reason?: string; revision?: number };
  if (!row.ok) return { ok: false, reason: row.reason ?? "failed", message: refusal(row.reason ?? "failed") };
  return {
    ok: true,
    revision: Number(row.revision),
    entryStatus: "open",
    savedAt: new Date().toISOString(),
    actorName: null,
    changed: 0,
    counts: null,
  };
}
