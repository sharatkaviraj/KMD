export type PhotoCredential =
  | { kind: "task"; id: string; token?: string }
  | { kind: "request"; token: string }
  | { kind: "assigned-request"; id: string; generation: string }
  | { kind: "student"; id: string }
  | { kind: "staff"; id?: string };
export type PhotoSaveResult = { ok: true } | { ok: false; reason: string };

/** A rejection's reason as stored: trimmed, 3 to 300 characters, or null when it says nothing. */
export function rejectionNote(note: string | null | undefined): string | null {
  const text = (note ?? "").replace(/\s+/g, " ").trim();
  return text.length >= 3 && text.length <= 300 ? text : null;
}
export type PhotoEditorContext = {
  scope: string; studentId?: string; currentId: string | null; currentUrl: string | null;
  proposalId: string | null; proposalUrl: string | null; decided: boolean; proposal: boolean;
  /** How this round's photograph was decided, and the reason it was sent back. */
  outcome?: "accepted" | "rejected" | null; note?: string | null;
};
export type PhotoInput = { commandId: string; studentId: string; expectedCurrent: string | null; expectedProposal: string | null; bytes: ArrayBuffer; source: "camera" | "file" | "folder" };
