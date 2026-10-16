export type PhotoCredential =
  | { kind: "task"; id: string; token?: string }
  | { kind: "request"; token: string }
  | { kind: "student"; id: string }
  | { kind: "staff"; id?: string };
export type PhotoSaveResult = { ok: true } | { ok: false; reason: string };
export type PhotoEditorContext = {
  scope: string; studentId?: string; currentId: string | null; currentUrl: string | null;
  proposalId: string | null; proposalUrl: string | null; decided: boolean; proposal: boolean;
};
export type PhotoInput = { commandId: string; studentId: string; expectedCurrent: string | null; expectedProposal: string | null; bytes: ArrayBuffer; source: "camera" | "file" | "folder" };
