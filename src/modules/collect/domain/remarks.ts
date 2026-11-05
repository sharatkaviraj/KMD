/**
 * What a Collect payment writes in the ledger's reference and remarks. The
 * receipt has one notes field, so the cheque's bank and date and the late-fee
 * waiver's reason ride there, exactly as the vx desk writes them
 * (`composeRemarks`). UPI and bank transfer carry no reference (D9).
 */

import { composeRemarks, DESK_DEFAULT_WAIVE_REASON } from "@/modules/payments/vx/domain/desk";

import { chequeDateIso, type CollectMode } from "./cash";

export const WAIVER_REASONS = ["desk", "hardship", "sibling", "principal"] as const;
export type WaiverReason = (typeof WAIVER_REASONS)[number];

/** Stored in English, as the ledger's other waivers are. */
const REASON_TEXT: Record<WaiverReason, string> = {
  desk: DESK_DEFAULT_WAIVE_REASON,
  hardship: "Hardship",
  sibling: "Sibling concession",
  principal: "Principal approved",
};

export function nextReason(reason: WaiverReason): WaiverReason {
  return WAIVER_REASONS[(WAIVER_REASONS.indexOf(reason) + 1) % WAIVER_REASONS.length];
}

export function collectReference(mode: CollectMode, cheque: { number: string }): string | null {
  return mode === "cheque" ? cheque.number.trim() || null : null;
}

export function collectRemarks(input: {
  mode: CollectMode;
  cheque: { bank: string; date: string };
  waiving: boolean;
  lateFee: number;
  reason: WaiverReason;
}): string | null {
  const text = composeRemarks({
    mode: input.mode === "split" ? "cash" : input.mode,
    chequeBank: input.cheque.bank,
    chequeDate: chequeDateIso(input.cheque.date),
    waiveLate: input.waiving && input.lateFee > 0,
    waiveReason: REASON_TEXT[input.reason],
    waiveNote: "",
    notes: "",
  });
  return text || null;
}
