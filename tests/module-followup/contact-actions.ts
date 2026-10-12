import { type ContactCommand, type ContactRequest, contactCommand, latestContactCandidate } from "@/vx/screens/family-contact/domain";
import type { ContactResult } from "../../src/vx/screens/family-contact/actions";
import { p } from "@/vx/text";
import { parseContact } from "@/vx/screens/family-contact/domain";

type Input = ContactRequest;
type Ledger = { calls: Input[]; checks: Input[]; records: ContactCommand[]; sends: number; refreshes: number };
const ledgerKey = `qa:module-contact-server:${new URLSearchParams(location.search).get("run") ?? "initial"}`;
const read = (): Ledger => {
  const raw = localStorage.getItem(ledgerKey);
  return raw ? JSON.parse(raw) as Ledger : { calls: [], checks: [], records: [], sends: 0, refreshes: 0 };
};
const change = (update: (ledger: Ledger) => void) => {
  const ledger = read(); update(ledger); localStorage.setItem(ledgerKey, JSON.stringify(ledger));
};
export const contactFixtureRecords = () => read().records;
declare global { interface Window { moduleContactSnapshot: () => Ledger; moduleContactDocumentCalls: () => Input[]; holdContactResult: (kind: "save" | "check") => void; releaseContactResult: (kind: "save" | "check") => void; contactResultEntered: (kind: "save" | "check") => boolean } }
const documentCalls: Input[] = [];
window.moduleContactDocumentCalls = () => structuredClone(documentCalls);
const gates = new Map<string, { promise: Promise<void>; release: () => void; entered: boolean }>();
window.holdContactResult = kind => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); gates.set(kind, { promise, release, entered: false }); };
window.releaseContactResult = kind => { gates.get(kind)?.release(); };
window.contactResultEntered = kind => gates.get(kind)?.entered ?? false;
const delayed = async (kind: "save" | "check") => { const gate = gates.get(kind); if (gate) { gate.entered = true; await gate.promise; } };
window.moduleContactSnapshot = () => structuredClone(read());
window.addEventListener("qa:refresh", () => { change(ledger => { ledger.refreshes++; }); });

// Shared synthetic server-effect oracle survives reload and other tabs.
// No product recovery record is stored, and no provider/DB/network call occurs.
// Probes are sequential; this fixture does not claim cross-tab CAS guarantees.
export async function logFamilyContactAction(input: Input): Promise<ContactResult> {
  documentCalls.push(structuredClone(input));
  change(ledger => { ledger.calls.push(structuredClone(input)); });
  if (!navigator.onLine) throw new Error("Synthetic offline contact transport");
  const earlier = read().records.find(record => record.attemptId === input.attemptId);
  const acceptable = (row: ContactCommand) => JSON.stringify(row) === JSON.stringify(contactCommand(input)) || !!input.dateCorrections?.some(date => JSON.stringify(row) === JSON.stringify({ ...contactCommand(input), agreedOn: date }));
  if (earlier && !acceptable(earlier)) return { ok: false, status: "refused", error: p("Synthetic immutable payload mismatch", "") };
  const candidate = latestContactCandidate(input);
  if (!earlier) {
    const today = new URLSearchParams(location.search).get("serverToday") ?? "2026-10-11";
    const parsed = parseContact(candidate, today);
    if (!parsed.ok) return { ok: false, status: "expired", today, error: parsed.error };
  }
  if (!earlier && input.dateCorrections && new URLSearchParams(location.search).has("originalWins")) change(ledger => { ledger.records.push(structuredClone(contactCommand(input)!)); });
  // Atomic UUID oracle: a late original may win after our preceding SELECT.
  if (!read().records.some(row => row.attemptId === input.attemptId)) change(ledger => { ledger.records.push(structuredClone(candidate)); });
  await delayed("save");
  if (new URLSearchParams(location.search).has("lost")) {
    await new Promise(resolve => window.setTimeout(resolve, 150));
    throw new Error("Synthetic connection interrupted after contact append");
  }
  return { ok: true, status: "saved", attemptId: input.attemptId, agreedOn: read().records.find(row => row.attemptId === input.attemptId)!.agreedOn };
}
export async function checkFamilyContactAction(input: Input): Promise<ContactResult> {
  change(ledger => { ledger.checks.push(structuredClone(input)); });
  if (!navigator.onLine) throw new Error("Synthetic offline contact readback");
  const record = read().records.find(row => row.attemptId === input.attemptId);
  await delayed("check");
  if (!record) return { ok: false, status: "not_found", today: new URLSearchParams(location.search).get("serverToday") ?? "2026-10-11", error: p("The original contact is not found yet. Retry this same contact ID.", "") };
  const acceptable = JSON.stringify(record) === JSON.stringify(contactCommand(input)) || !!input.dateCorrections?.some(date => JSON.stringify(record) === JSON.stringify({ ...contactCommand(input), agreedOn: date }));
  return acceptable ? { ok: true, status: "saved", attemptId: input.attemptId, agreedOn: record.agreedOn } : { ok: false, status: "refused", error: p("Synthetic immutable payload mismatch", "") };
}
