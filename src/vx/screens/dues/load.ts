import "server-only";

import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import {
  collectedThisWeek,
  countCallsToday,
  loadDuesBoard,
  loadFamilyDetail,
  loadLeftOwing,
  paymentsSince,
  studentBriefs,
} from "@/modules/defaulters/vx/data";
import {
  agingBuckets,
  familyKeyOf,
  groupFamilies,
  isCallable,
  lateFeeOnly,
  promiseState,
  sortForCalling,
  type ContactSummary,
  type DuesFamily,
} from "@/modules/defaulters/vx/domain/families";
import { addDays } from "@/modules/receipts/vx/domain/day-close";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { feePermissionsFor } from "@/platform/auth/fee-roles";
import { can } from "@/platform/auth/permissions";
import { isRepaymentPlanCreationEnabled } from "@/platform/env";
import { schoolToday } from "@/vx/format";

import { listPromises, listWriteOffRequests } from "./data";
import type { DuesProps, DuesSheet, DuesTab, LeftView, PromiseView } from "./types";

type Search = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const TABS: DuesTab[] = ["call", "prom", "left", "aging"];
const SHEETS: DuesSheet[] = ["call", "promise", "wa", "plan", "wo"];

function kidsLine(f: Pick<DuesFamily, "kids">): string {
  return f.kids.map((k) => `${k.fullName.split(" ")[0]} · ${k.classLabel}`).join(", ");
}

/** Everything /dues draws, from the URL. */
export async function loadDues(staff: CurrentStaff, search: Search): Promise<DuesProps> {
  const today = schoolToday();
  const tabParam = one(search.tab) as DuesTab;
  const tab: DuesTab = TABS.includes(tabParam) ? tabParam : "call";
  const sheetParam = one(search.sheet) as DuesSheet;
  const sheet: DuesSheet | null = SHEETS.includes(sheetParam) ? sheetParam : null;

  const viewSession = await resolveViewSession({ searchParamSession: search.session ?? null, cookieSession: await getViewSessionCookie() });
  const sessionLabel = viewSession.sessionLabel;
  const promiseWindow = addDays(today, -21);

  const [board, leftRows, callsToday, collectedWeek, promiseRows, writeOffs] = await Promise.all([
    loadDuesBoard(sessionLabel),
    loadLeftOwing(),
    countCallsToday(sessionLabel, today),
    collectedThisWeek(sessionLabel),
    listPromises(sessionLabel, promiseWindow),
    listWriteOffRequests(sessionLabel),
  ]);

  const contacts = new Map<string, ContactSummary>(Object.entries(board.contacts));
  const all = groupFamilies(board.students, contacts);
  const callable = sortForCalling(all.filter(isCallable));
  const lateOnly = lateFeeOnly(all);
  const familyOf = new Map<string, DuesFamily>();
  for (const f of all) for (const k of f.kids) familyOf.set(k.studentId, f);

  // Promises: judged against every receipt of the family made since the promise.
  const missing = promiseRows.map((r) => r.studentId).filter((id) => !familyOf.has(id));
  const briefs = new Map((await studentBriefs(missing)).map((b) => [b.studentId, b]));
  const familyIds = (studentId: string) => familyOf.get(studentId)?.kids.map((k) => k.studentId) ?? [studentId];
  const since = promiseRows.reduce((min, r) => (r.createdAt.slice(0, 10) < min ? r.createdAt.slice(0, 10) : min), today);
  const payments = await paymentsSince([...new Set(promiseRows.flatMap((r) => familyIds(r.studentId)))], since);

  const promises: PromiseView[] = promiseRows.map((r) => {
    const fam = familyOf.get(r.studentId);
    const ids = new Set(familyIds(r.studentId));
    const mine = payments.filter((x) => ids.has(x.studentId)).map((x) => ({ ...x, studentId: r.studentId }));
    const s = promiseState({ studentId: r.studentId, promisedOn: r.promisedOn, amount: r.kind === "visit" ? 0 : r.amount, madeAt: r.createdAt }, mine, today);
    const b = briefs.get(r.studentId);
    return {
      id: r.id,
      studentId: r.studentId,
      familyKey: fam?.key ?? familyKeyOf({ studentId: r.studentId, familyGroupId: null, fatherPhone: b?.phone ?? null }),
      fatherName: fam?.fatherName ?? b?.fatherName ?? b?.fullName ?? "—",
      kidsLine: fam ? kidsLine(fam) : (b?.fullName ?? ""),
      phone: fam?.phone ?? b?.phone ?? null,
      kind: r.kind,
      promisedOn: r.promisedOn,
      amount: r.amount,
      note: r.note,
      by: r.createdByName,
      createdAt: r.createdAt,
      state: s.state,
      paid: s.paid,
      receiptNumber: s.receiptNumber,
    };
  });
  // One promise per family: the newest.
  const seen = new Set<string>();
  const latestPromises = promises.filter((pv) => (seen.has(pv.familyKey) ? false : (seen.add(pv.familyKey), true)));
  const dueToday = latestPromises.filter((pv) => pv.promisedOn === today);

  const pendingWriteOff = new Map<string, NonNullable<LeftView["writeOff"]>>();
  for (const w of writeOffs)
    if (!pendingWriteOff.has(w.studentId))
      pendingWriteOff.set(w.studentId, { status: w.status, amount: w.amount, reasonCode: w.reasonCode, note: w.note, by: w.requestedByName });
  const left: LeftView[] = leftRows.map((r) => ({ ...r, writeOff: pendingWriteOff.get(r.studentId) ?? null }));

  const familyKey = one(search.family);
  const selected = familyKey ? (all.find((f) => f.key === familyKey) ?? null) : null;
  const detail = selected ? await loadFamilyDetail(sessionLabel, selected.kids.map((k) => k.studentId)) : null;
  const woId = one(search.wo);
  const writeOffFor = woId ? (left.find((l) => l.studentId === woId) ?? null) : null;

  const fee = feePermissionsFor(staff.role);
  const studentsPending = board.students.filter((s) => s.overdueAmount > 0).length;
  return {
    today,
    sessionLabel,
    tab,
    families: callable,
    lateFeeOnly: { count: lateOnly.length, amount: lateOnly.reduce((s, f) => s + f.lateFee, 0) },
    metrics: {
      pendingToday: callable.reduce((s, f) => s + f.pendingToday, 0),
      students: studentsPending,
      notDueYet: all.reduce((s, f) => s + f.notDueYet, 0),
      promisesToday: dueToday.length,
      promisesKeptToday: dueToday.filter((pv) => pv.state === "kept").length,
      callsToday,
      collectedWeek,
    },
    promises: latestPromises,
    left,
    aging: {
      buckets: agingBuckets(board.students),
      top: [...callable].sort((a, b) => b.pendingToday - a.pendingToday).slice(0, 10),
      classByInst: board.classByInst,
    },
    selected,
    detail,
    sheet: selected || writeOffFor ? sheet : null,
    dialing: Boolean(selected) && sheet === "call" && one(search.dial) === "1",
    writeOffFor,
    perms: {
      log: fee.includes("defaulters:view"),
      plan: fee.includes("fees:repayment_plan"),
      planEnabled: isRepaymentPlanCreationEnabled(),
      collect: can(staff, "fees:collect"),
      writeOff: fee.includes("finance:write"),
      // The call sheet is the fee app's defaulters export, which asks for reports:view.
      callSheet: fee.includes("reports:view"),
    },
  };
}
