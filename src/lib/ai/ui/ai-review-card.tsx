"use client";

import type { ReactNode } from "react";

import { p } from "@/vx/text";
import { Btn } from "@/vx/ui/primitives";
import { useVx } from "@/vx/i18n";

export function AiReviewCard({ children, busy, canSave, onSave, onDiscard, saveLabel }: {
  children: ReactNode;
  busy: boolean;
  canSave: boolean;
  onSave: () => void;
  saveLabel?: string;
  onDiscard?: () => void;
}) {
  const { tx } = useVx();
  return (
    <section aria-label={tx(p("Check what the app read", "ऐप ने जो पढ़ा उसे जाँचें"))} className="space-y-3">
      <h2 className="font-semibold">{tx(p("Check what the app read", "ऐप ने जो पढ़ा उसे जाँचें"))}</h2>
      {children}
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        <Btn variant="pri" big disabled={busy || !canSave} onClick={onSave}>{saveLabel ?? tx(p("Save", "सहेजें"))}</Btn>
        {onDiscard && <Btn variant="ghost" big disabled={busy} onClick={onDiscard}>{tx(p("Discard", "हटाएँ"))}</Btn>}
      </div>
    </section>
  );
}
