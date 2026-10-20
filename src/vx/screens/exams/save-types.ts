import type { Pair } from "@/vx/text";

import type { CellState } from "./domain/entry";

/** How long a teacher may take back her own submission — `withdraw_marks_submission` (vx_exam_office.sql). */
export const UNDO_MS = 10 * 60_000;

/** What a marks sheet sends, the same shape `saveMarksSchema` reads. */
export type SavePayload = {
  commandId: string;
  paperId: string;
  kind: "draft" | "submit" | "correction" | "reopen";
  expectedRevision: number;
  reason: string | null;
  entries: { studentId: string; state: CellState; value: number | null }[];
};

export type SaveOutcome =
  | {
      ok: true;
      revision: number;
      entryStatus: "open" | "submitted";
      savedAt: string;
      actorName: string | null;
      changed: number;
      counts: { entered: number; absent: number; exempt: number; blank: number; total: number } | null;
      replayed?: boolean;
    }
  | { ok: false; reason: string; message: Pair; who?: string[] };

/** The plain result of any other exam-office write. */
export type ActionResult = { ok: true; message?: Pair; data?: Record<string, unknown> } | { ok: false; message: Pair };
