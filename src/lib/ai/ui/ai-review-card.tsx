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
    <section aria-label={tx(p("Review what Gemini read", "Gemini की पढ़ाई जाँचें"))} className="space-y-3">
      <h2 className="font-semibold">{tx(p("Review what Gemini read", "Gemini ने जो पढ़ा उसे जाँचें"))}</h2>
      {children}
      <div className="flex flex-wrap gap-2">
        <Btn variant="pri" disabled={busy || !canSave} onClick={onSave}>{saveLabel ?? tx(p("Save", "सहेजें"))}</Btn>
        {onDiscard && <Btn variant="ghost" disabled={busy} onClick={onDiscard}>{tx(p("Discard", "हटाएँ"))}</Btn>}
      </div>
    </section>
  );
}
