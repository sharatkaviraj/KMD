import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { MarksSheet } from "@/vx/screens/exams/marks-sheet";
import type { Cell } from "@/vx/screens/exams/domain/entry";
import type { SaveOutcome, SavePayload } from "@/vx/screens/exams/save-types";
import "../../src/vx/vx.css";

const params = new URLSearchParams(location.search);
const ledgerKey = "qa:marks-mobile:ledger";
type Ledger = { revision: number; status: "open" | "submitted"; cells: Record<string, Cell>; calls: SavePayload[]; receipts: Record<string, SaveOutcome>; lost: boolean };
const read = (): Ledger => JSON.parse(localStorage.getItem(ledgerKey) ?? '{"revision":0,"status":"open","cells":{},"calls":[],"receipts":{},"lost":false}');
const students = Array.from({ length: 5 }, (_, i) => ({ id: `00000000-0000-4000-8000-00000000000${i + 1}`, name: params.has("duplicateNames") && i < 2 ? "Synthetic repeated name" : `Synthetic student ${i + 1}`, roll: params.has("noRoll") ? null : String(i + 1), prev: null, prevPct: null }));
async function save(payload: SavePayload): Promise<SaveOutcome> {
  const ledger = read();
  ledger.calls.push(payload);
  localStorage.setItem(ledgerKey, JSON.stringify(ledger));
  if (ledger.receipts[payload.commandId]) return ledger.receipts[payload.commandId];
  if (payload.expectedRevision !== ledger.revision) return { ok: false, reason: "stale", message: { en: "Marks changed in another tab. Reload before trying again.", hi: "QA" } };
  const failThisKind = !params.get("failureKind") || payload.kind === params.get("failureKind");
  if (params.get("delay")) await new Promise((resolve) => setTimeout(resolve, Number(params.get("delay"))));
  if (params.get("failure") === "offline" && failThisKind && !ledger.lost) { ledger.lost = true; localStorage.setItem(ledgerKey, JSON.stringify(ledger)); throw Error("synthetic offline before commit"); }
  for (const entry of payload.entries) ledger.cells[entry.studentId] = { state: entry.state, value: entry.value };
  ledger.revision += 1;
  ledger.status = payload.kind === "submit" || payload.kind === "correction" ? "submitted" : "open";
  const result: SaveOutcome = { ok: true, revision: ledger.revision, entryStatus: ledger.status, savedAt: "2026-10-11T12:00:00Z", actorName: "Synthetic teacher", changed: payload.entries.length, counts: null };
  ledger.receipts[payload.commandId] = result;
  const lose = params.get("failure") === "after-commit" && failThisKind && !ledger.lost;
  if (lose) ledger.lost = true;
  localStorage.setItem(ledgerKey, JSON.stringify(ledger));
  if (lose) throw Error("synthetic answer lost after commit");
  return result;
}
const ledger = read();
localStorage.setItem(ledgerKey, JSON.stringify(ledger));
async function withdraw(): Promise<SaveOutcome> {
  const current = read(); current.status = "open"; current.revision++;
  localStorage.setItem(ledgerKey, JSON.stringify(current));
  return { ok: true, revision: current.revision, entryStatus: "open", savedAt: "2026-10-11T12:00:00Z", actorName: "Synthetic teacher", changed: 0, counts: null };
}
createRoot(document.getElementById("root")!).render(<LanguageProvider language="en"><div className="vx"><MarksSheet
  ownerId={params.get("owner") ?? "synthetic-teacher"} sessionLabel={params.get("session") ?? "OPS-TEST"}
  paper={{ id: "00000000-0000-4000-8000-000000000099", examId: "qa-exam", examLabel: { en: "Synthetic exam", hi: "QA" }, classId: "qa-class", classLabel: "QA Class 6", subjectCode: "Maths", subjectId: "qa-maths", maxMarks: 40, passMarks: 13, markStep: 0.5, allowExempt: params.get("exempt") !== "no", entryStatus: ledger.status, entryRevision: ledger.revision, submittedAt: null, submittedBy: null, examOpen: true, locked: params.get("locked") === "yes", dueLabel: null }}
  students={students} saved={ledger.cells} coordinatorName="Synthetic exam office" onSave={save} onWithdraw={withdraw} canCorrect canReopen
  initialMode={params.get("mode") === "pad" ? "pad" : "list"} crumb="Synthetic school" backHref="/" doneHref="/"
/></div></LanguageProvider>);
