export type DraftEnvelope<T = unknown> = {
  version: 1;
  baseline: string;
  value: T;
  updatedAt: number;
};

export function draftKey(owner: string, session: string, record: string): string {
  if (!owner || !session || !record) throw new Error('A draft needs an owner, session and record.');
  return `vppsone.draft.v2:${[owner, session, record].map(encodeURIComponent).join(':')}`;
}

export function readDraft<T>(raw: unknown, validate: (value: unknown) => value is T): DraftEnvelope<T> | null {
  if (!raw || typeof raw !== 'object') return null;
  const draft = raw as Partial<DraftEnvelope>;
  if (draft.version !== 1 || typeof draft.baseline !== 'string' || typeof draft.updatedAt !== 'number' || !Number.isFinite(draft.updatedAt) || !validate(draft.value)) return null;
  return draft as DraftEnvelope<T>;
}

export function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((entry) => typeof entry === 'string'));
}
