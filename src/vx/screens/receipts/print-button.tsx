"use client";

import { useState, type CSSProperties } from "react";

import { printReceipt } from "@/modules/receipts/ui/receipt-print-fit";
import { cue } from "@/ui/feedback/cue";
import { Ic } from "@/vx/icons";

/**
 * Print A4: the receipt on this screen, alone, on one sheet. The button says
 * what it is doing while the logo and signature load and the sheet is fitted
 * ("Getting the sheet ready…"), so a first tap that takes a second never
 * looks like nothing happened and is never tapped twice.
 */
export function PrintButton({ label, busyLabel, big, full, style, variant = "pri" }: { label: string; busyLabel?: string; big?: boolean; full?: boolean; style?: CSSProperties; variant?: "pri" | "sec" }) {
  const [busy, setBusy] = useState(false);
  async function print() {
    if (busy) return;
    cue("tap");
    setBusy(true);
    try {
      await printReceipt();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      className={`tap btn ${variant}${big ? " big" : ""}`}
      style={{ width: full ? "100%" : undefined, ...style }}
      onClick={() => void print()}
      disabled={busy}
      aria-busy={busy}
      data-receipt-print=""
    >
      <Ic n={busy ? "refresh" : "printer"} size={big ? 20 : 18} className={busy ? "spin" : undefined} />
      <span aria-live="polite">{busy ? (busyLabel ?? label) : label}</span>
    </button>
  );
}
