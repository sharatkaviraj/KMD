/**
 * The one interface Collect's cards talk to (plan §5). Two adapters fill it:
 *
 *  - `bridge-adapter.ts` — real staff (`usesCanonicalFees`): Fees is the
 *    ledger, reached through `/api/one/v1` (quote → post → command status).
 *  - `local-adapter.ts` — test accounts and confined deployments: the vx
 *    Payment Desk's own actions against the TEST session.
 *
 * Every method answers; none throws for an expected refusal. Each server
 * action behind them checks permission and the session fence again.
 */

import type { LedgerMode } from "@/modules/collect/domain/cash";
import type {
  CollectDues,
  CollectPost,
  CollectStudentRow,
  LikelyRow,
  PostOutcome,
  Prepared,
  StatusOutcome,
} from "@/modules/collect/domain/types";

export type SearchAnswer = { ok: true; rows: CollectStudentRow[] } | { ok: false; message: string };
export type DuesAnswer = { ok: true; dues: CollectDues } | { ok: false; message: string };

export type MoneyPortInfo = {
  kind: "bridge" | "local";
  sessionLabel: string;
  today: string;
  sessionStart: string;
  /** Saving is open here (bridge writes on, not previewing; a collectable TEST session). */
  canPost: boolean;
  canWaive: boolean;
  /** May acknowledge a near-duplicate (the admin's `payments:adjust`). */
  canAdjust: boolean;
  /** Cash + UPI on one receipt: the bridge only, until the TEST ledger has tender lines. */
  canSplit: boolean;
  /** The UPI QR is the school's real one: drawn on the live desk only. */
  showRealQr: boolean;
  modes: LedgerMode[];
  staffName: string;
  userId: string;
};

export interface MoneyPort extends MoneyPortInfo {
  search(query: string): Promise<SearchAnswer>;
  /** "Likely today", from what this adapter knows. */
  likely(recentIds: readonly string[]): Promise<LikelyRow[]>;
  dues(studentId: string): Promise<DuesAnswer>;
  /** The ledger's word on one child's payment: the quote (bridge) or the dues on that date (local). */
  prepare(input: { studentId: string; amount: number; paymentDate: string; waive: boolean }): Promise<Prepared>;
  post(input: CollectPost): Promise<PostOutcome>;
  /** After a lost answer: the same command id, asked again. */
  status(input: { studentId: string; commandId: string }): Promise<StatusOutcome>;
}
