import "server-only";

import { getBridgeDues, getBridgeDuesFamily, getBridgeDuesPeople } from "@/platform/fees-bridge/client";
import type { PaymentFact } from "@/modules/defaulters/vx/domain/families";
import { buildDuesBoard, familyDetailFrom, leftOwingInSession, type DuesBoard, type LeftOwing } from "@/modules/defaulters/vx/domain/board";

import type { StudentBrief } from "./data";

/*
 * Dues & calls for real staff on a real session: read live from Fees through
 * the bridge (6 Nov 2026), never from One's local copy, and built by the same
 * rules as the local board. If Fees does not answer, the caller says so; it
 * never falls back to the copy's numbers.
 */

export type FeesDues = { board: DuesBoard; left: LeftOwing[]; calledIds: string[]; collectedWeek: number; asOf: string };

export async function loadDuesFromFees(sessionLabel: string): Promise<FeesDues> {
  const dues = await getBridgeDues(sessionLabel);
  return {
    board: buildDuesBoard({
      defaulters: dues.defaulters,
      overdue: dues.overdueRows,
      notDue: new Map(dues.notDueYet.map((n) => [n.studentId, n.amount])),
      contacts: dues.contacts.map((c) => [c.studentId, c] as const),
    }),
    left: leftOwingInSession(dues.recovery, sessionLabel),
    calledIds: dues.calledToday,
    collectedWeek: dues.collectedWeek,
    asOf: dues.asOf,
  };
}

export async function familyDetailFromFees(sessionLabel: string, studentIds: string[]) {
  const ids = [...new Set(studentIds)].slice(0, 8);
  if (!ids.length) return { installments: {}, contacts: [], meta: {} };
  return familyDetailFrom(ids, await getBridgeDuesFamily(sessionLabel, ids));
}

/** Names and receipts since `since` for the children One holds a promise for. */
export async function peopleFromFees(sessionLabel: string, studentIds: string[], since: string): Promise<{ briefs: StudentBrief[]; payments: PaymentFact[] }> {
  const ids = [...new Set(studentIds.filter(Boolean))];
  if (!ids.length) return { briefs: [], payments: [] };
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  const pages = await Promise.all(chunks.map((chunk) => getBridgeDuesPeople(sessionLabel, chunk, since)));
  return { briefs: pages.flatMap((p) => p.briefs), payments: pages.flatMap((p) => p.payments) };
}
