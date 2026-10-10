import type { Pair } from "@/vx/text";

import type { CellState } from "./domain/entry";

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
    }
  | { ok: false; reason: string; message: Pair; who?: string[] };

/** The plain result of any other exam-office write. */
export type ActionResult = { ok: true; message?: Pair; data?: Record<string, unknown> } | { ok: false; message: Pair };
