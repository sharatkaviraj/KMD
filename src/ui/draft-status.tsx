"use client";

import * as m from '@/messages/pairs';
import { primary, type Language } from '@/platform/i18n/language';

export function DraftStatus({ status, online, recovered, changed, onRestore, onDiscard, language }: {
  status: 'idle' | 'writing' | 'local' | 'school' | 'error'; online: boolean;
  recovered?: boolean; changed?: boolean; onRestore?: () => void; onDiscard?: () => void; language: Language;
}) {
  return <div className="rounded-xl border border-border bg-surface px-3 py-2 text-sm" data-draft-storage-error={status === "error"} role="status" aria-live="polite">
    <p className={status === 'error' ? 'text-destructive-soft-foreground' : 'text-muted-foreground'}>
      {primary(recovered ? (changed ? m.draftChanged : m.draftFound) : status === 'error' ? m.draftStorageError : status === 'writing' ? m.draftWriting : status === 'school' ? m.draftSchool : status === 'local' ? (online ? m.draftLocal : m.draftWaiting) : (!online ? m.draftOffline : m.draftReady), language)}
    </p>
    {recovered ? <div className="mt-2 flex gap-3">
      <button type="button" onClick={onRestore} className="focus-ring min-h-11 rounded-lg px-3 font-semibold text-accent">{primary(m.draftRestore, language)}</button>
      <button type="button" onClick={onDiscard} className="focus-ring min-h-11 rounded-lg px-3 text-muted-foreground">{primary(m.draftDiscard, language)}</button>
    </div> : null}
  </div>;
}
