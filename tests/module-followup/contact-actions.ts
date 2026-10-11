import { parseContact } from "@/vx/screens/family-contact/domain";

type Input = { studentId: string; outcome: string; note?: string | null; agreedOn?: string | null };
type Ledger = { calls: Input[]; records: Input[]; sends: number; refreshes: number };
const ledgerKey = `qa:module-contact-server:${new URLSearchParams(location.search).get("run") ?? "initial"}`;
const read = (): Ledger => {
  const raw = localStorage.getItem(ledgerKey);
  return raw ? JSON.parse(raw) as Ledger : { calls: [], records: [], sends: 0, refreshes: 0 };
};
const change = (update: (ledger: Ledger) => void) => {
  const ledger = read(); update(ledger); localStorage.setItem(ledgerKey, JSON.stringify(ledger));
};
export const contactFixtureRecords = () => read().records;
declare global { interface Window { moduleContactSnapshot: () => Ledger } }
window.moduleContactSnapshot = () => structuredClone(read());
window.addEventListener("qa:refresh", () => { change(ledger => { ledger.refreshes++; }); });

// Shared synthetic server-effect oracle survives reload and other tabs.
// No product recovery record is stored, and no provider/DB/network call occurs.
// Probes are sequential; this fixture does not claim cross-tab CAS guarantees.
export async function logFamilyContactAction(input: Input) {
  change(ledger => { ledger.calls.push(structuredClone(input)); });
  const parsed = parseContact(input, "2026-10-11");
  if (!parsed.ok) return parsed;
  if (new URLSearchParams(location.search).has("lost")) {
    change(ledger => { ledger.records.push({ ...input, ...parsed.value }); });
    await new Promise(resolve => window.setTimeout(resolve, 150));
    throw new Error("Synthetic connection interrupted after contact append");
  }
  change(ledger => { ledger.records.push({ ...input, ...parsed.value }); });
  return { ok: true as const };
}
