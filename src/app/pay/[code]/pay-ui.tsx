import type { ReactNode } from "react";

import type { Bilingual } from "@/modules/payments/domain/online/pay-page-copy";

/**
 * The pay page's two building blocks, shared by every screen of the one-tap
 * panel. Plain markup only: this is client code on a page that must open fast
 * inside WhatsApp, and the shared chunk has no room for a component library.
 */

export const BRAND = "#06426F";

/** Hindi large, English as one small line under it: the page's language rule. */
export function Both({ text, className }: { text: Bilingual; className?: string }) {
  return (
    <span className={className}>
      <span lang="hi" className="block">
        {text.hi}
      </span>
      <span lang="en" className="block text-[0.75em] font-normal opacity-70">
        {text.en}
      </span>
    </span>
  );
}

const TONES = {
  plain: "bg-background",
  success: "bg-emerald-50",
  failed: "bg-amber-50",
} as const;

/**
 * A screen that replaces the whole page. The parent sees only this, from its
 * top, whatever they had scrolled to — which is how the "received" message
 * stopped hiding below the breakdown.
 */
export function FullScreen({
  children,
  tone = "plain",
  label,
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
  label: string;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label={label} className={`fixed inset-0 z-50 overflow-y-auto ${TONES[tone]}`}>
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 pb-10 pt-8">{children}</div>
    </div>
  );
}
