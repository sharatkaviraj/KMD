"use client";

import type { Cell } from "./domain/entry";
import { MarksSheet } from "./marks-sheet";
import type { SaveOutcome, SavePayload } from "./save-types";
import type { SheetPaper, SheetStudent } from "./sheet-data";

/*
 * The marks sheet behind a no-login link. Same sheet; its saves go to the
 * link's own route, which resolves the token again on every request.
 */

const OFFLINE: SaveOutcome = {
  ok: false,
  reason: "failed",
  message: { en: "Not saved. Check your connection — what you typed is kept here.", hi: "सहेजा नहीं गया। इंटरनेट देखें — आपका भरा यहीं रखा है।" },
};

async function post(token: string, body: unknown): Promise<SaveOutcome> {
  try {
    const res = await fetch(`/t/marks/${encodeURIComponent(token)}/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 409) return OFFLINE;
    return (await res.json()) as SaveOutcome;
  } catch {
    return OFFLINE;
  }
}

export function PublicMarksSheet({
  token,
  paper,
  students,
  saved,
  coordinatorName,
  crumb,
  view,
}: {
  token: string;
  paper: SheetPaper;
  students: SheetStudent[];
  saved: Record<string, Cell>;
  coordinatorName: string | null;
  crumb: string;
  view: "entry" | "keypad" | "check" | "submitted";
}) {
  return (
    <MarksSheet
      paper={paper}
      students={students}
      saved={saved}
      coordinatorName={coordinatorName}
      onSave={(payload: SavePayload) => post(token, { action: "save", payload })}
      onWithdraw={(paperId: string, revision: number) => post(token, { action: "withdraw", paperId, revision })}
      initialPhase={view === "check" ? "check" : view === "submitted" ? "sent" : "entry"}
      initialMode={view === "keypad" ? "pad" : "list"}
      crumb={crumb}
      backHref={`/t/marks/${token}`}
      doneHref={`/t/marks/${token}`}
    />
  );
}
