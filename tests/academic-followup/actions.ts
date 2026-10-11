import type { CoverActionResult, CoverInput } from '../academic-ui/actions';
export * from '../academic-ui/actions';

type Attempt = { kind: 'save' | 'check'; id: string; online: boolean };
const attemptsKey = 'qa-academic-followup-attempts';
const rowsKey = 'qa-academic-followup-server-rows';
const saved = { ok: true, status: 'saved', message: { en: 'Synthetic original receipt verified', hi: 'मूल परीक्षण रसीद जाँची गई' } } as const;
function attempt(kind: Attempt['kind'], input: CoverInput) {
  const entries = JSON.parse(localStorage.getItem(attemptsKey) ?? '[]') as Attempt[];
  entries.push({ kind, id: input.commandId, online: navigator.onLine });
  localStorage.setItem(attemptsKey, JSON.stringify(entries));
  if (!navigator.onLine) throw Error('Synthetic offline transport');
}
function rows(): CoverInput[] { return JSON.parse(localStorage.getItem(rowsKey) ?? '[]'); }

// This independent synthetic server model stores unique original commands.
// It does not use the UI's pending record or the older shared fixture ledger.
export async function coverAction(input: CoverInput): Promise<CoverActionResult> {
  attempt('save', input);
  const stored = rows();
  const earlier = stored.find(row => row.commandId === input.commandId);
  if (earlier && JSON.stringify(earlier) !== JSON.stringify(input)) return { ok: false, status: 'refused', message: { en: 'Synthetic ID was reused', hi: 'परीक्षण पहचान दोबारा बदली गई' } };
  if (!earlier) { stored.push(structuredClone(input)); localStorage.setItem(rowsKey, JSON.stringify(stored)); }
  if (sessionStorage.getItem('qa-academic-followup-lose-response') === '1') {
    sessionStorage.removeItem('qa-academic-followup-lose-response');
    throw Error('Synthetic response lost after commit');
  }
  return saved;
}

export async function checkCoverAction(input: CoverInput): Promise<CoverActionResult> {
  attempt('check', input);
  return rows().some(row => row.commandId === input.commandId)
    ? saved
    : { ok: false, status: 'not_found', message: { en: 'Synthetic receipt not found; retry original save', hi: 'परीक्षण रसीद नहीं मिली; मूल अनुरोध दोहराएँ' } };
}
