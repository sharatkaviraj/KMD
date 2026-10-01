"use client";
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { CommandNavItem } from './providers/nav';

const CommandContent = dynamic(() => import('./command-content').then((module) => module.CommandContent), { ssr: false });

/** Only shortcut listeners are eager. Search UI and providers load on intent. */
export function CommandHost(props: { navigation: readonly CommandNavItem[]; canViewStudents: boolean; canViewReceipts: boolean }) {
  const [panel, setPanel] = useState<'command' | 'shortcuts' | null>(null);
  useEffect(() => {
    if (panel) return;
    const open = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.matches('input,textarea,select,[contenteditable]');
      if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') || (!typing && event.key === '/')) {
        event.preventDefault(); setPanel('command');
      } else if (!typing && event.key === '?') { event.preventDefault(); setPanel('shortcuts'); }
    };
    const command = () => setPanel('command');
    const shortcuts = () => setPanel('shortcuts');
    document.addEventListener('keydown', open);
    window.addEventListener('vpps:open-command', command);
    window.addEventListener('vpps:open-shortcuts', shortcuts);
    return () => {
      document.removeEventListener('keydown', open);
      window.removeEventListener('vpps:open-command', command);
      window.removeEventListener('vpps:open-shortcuts', shortcuts);
    };
  }, [panel]);
  return panel ? <CommandContent {...props} initialPanel={panel} /> : null;
}
export type { CommandNavItem };
