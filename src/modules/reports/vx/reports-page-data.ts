import "server-only";

/*
 * Everything the redesigned Reports screen needs for one view, computed on
 * the server so the browser gets totals and lists, not 2,000 installment
 * rows. The page has already checked `fees:view`; nothing here writes.
 */

import { maskPhone } from "@/modules/finance-controls/vx/domain/books";
import { getFinanceControlsPageData } from "@/modules/finance-controls/data/queries";
import {
  buildClasswise,
  buildDefaulters,
  cellStudents,
  collectionRange,
  sessionStart,
  daysInRange,
  type InstallmentBalance,
} from "@/modules/reports/vx/domain/reports";
import { isPendingOn } from "@/modules/fees/domain/due-rule";
import { isLeft } from "@/modules/reports/vx/domain/reports";
import { getClasses, getCollectionReceipts, getInstallmentBalances, getReportSchedules } from "@/modules/reports/vx/reports-data";
import type { CollectionPreset, ReportsPageData, ReportsSheet, ReportsView } from "@/modules/reports/vx/types";

function defaulterRows(balances: InstallmentBalance[], today: string) {
  return buildDefaulters(balances, today, { includeLeft: true }).map(({ fatherPhone, ...r }) => ({ ...r, phone: maskPhone(fatherPhone) }));
}

export async function getReportsPageData(input: {
  view: ReportsView;
  sheet: ReportsSheet;
  today: string;
  sessionLabel: string;
  schoolName: string;
  preset: CollectionPreset;
  from?: string;
  to?: string;
  date?: string;
  cellClass?: string;
  cellInst?: number;
}): Promise<ReportsPageData> {
  const { view, today, sessionLabel } = input;
  const base: ReportsPageData = {
    today,
    sessionLabel,
    schoolName: input.schoolName,
    view,
    sheet: input.sheet,
    classes: [],
    hub: null,
    collection: null,
    defaulters: null,
    classwise: null,
    cell: null,
    daybook: null,
    schedules: [],
    sessionFrom: sessionStart(sessionLabel, today),
  };

  const needsBalances = view === "hub" || view === "defaulters" || view === "classwise";
  const [classes, balances, schedules] = await Promise.all([
    getClasses(sessionLabel),
    needsBalances ? getInstallmentBalances(sessionLabel) : Promise.resolve([] as InstallmentBalance[]),
    view === "hub" || view === "schedule" || input.sheet === "newsch" ? getReportSchedules() : Promise.resolve([]),
  ]);
  base.classes = classes;
  base.schedules = schedules;

  if (view === "hub") {
    const monthFrom = `${today.slice(0, 7)}-01`;
    const sparkFrom = new Date(Date.parse(`${today}T00:00:00Z`) - 13 * 86_400_000).toISOString().slice(0, 10);
    const from = sparkFrom < monthFrom ? sparkFrom : monthFrom;
    const receipts = await getCollectionReceipts(from, today);
    const live = receipts.filter((r) => !r.reversed);
    const todayLive = live.filter((r) => r.paymentDate === today);
    const month = live.filter((r) => r.paymentDate >= monthFrom);
    const share = { upi: 0, cash: 0, cheque: 0, bank_transfer: 0 };
    for (const r of month) if (r.paymentMode in share) share[r.paymentMode as keyof typeof share] += r.amount;
    const defaulters = buildDefaulters(balances, today);
    const leftOwing = buildDefaulters(balances, today, { includeLeft: true }).filter((r) => r.left);
    // Everything owed that is not pending today, by the same rule (due-rule.ts).
    const notDueYet = balances.filter((b) => !isLeft(b.studentStatus) && !isPendingOn(b, today)).reduce((s, b) => s + Math.max(0, b.pendingAmount), 0);
    base.hub = {
      todayTotal: todayLive.reduce((s, r) => s + r.amount, 0),
      todayReceipts: todayLive.length,
      todayReversed: receipts.filter((r) => r.paymentDate === today && r.reversed).length,
      spark: daysInRange(sparkFrom, today).map((d) => live.filter((r) => r.paymentDate === d).reduce((s, r) => s + r.amount, 0)),
      monthTotal: month.reduce((s, r) => s + r.amount, 0),
      monthUpi: share.upi,
      modeShare: share,
      pendingToday: defaulters.reduce((s, r) => s + r.pending, 0),
      defaulters: defaulters.length,
      notDueYet,
      lateFeePending: balances.reduce((s, b) => s + Math.max(0, b.lateFeePending), 0),
      leftOwing: leftOwing.length,
      leftOwingAmount: leftOwing.reduce((s, r) => s + r.pending, 0),
      schedules: schedules.filter((s) => s.active).length,
    };
  }

  if (view === "collection") {
    const range = collectionRange(input.preset, today, sessionLabel, { from: input.from, to: input.to });
    const receipts = await getCollectionReceipts(range.from, range.to);
    base.collection = {
      preset: input.preset,
      ...range,
      receipts: receipts.map((r) => ({ date: r.paymentDate, mode: r.paymentMode, amount: r.amount, classId: r.classId, reversed: r.reversed })),
    };
  }

  if (view === "defaulters") base.defaulters = defaulterRows(balances, today);

  if (view === "classwise") {
    base.classwise = buildClasswise(balances, today, { includeLeft: true });
    let cellClass = input.cellClass;
    let cellInst = input.cellInst;
    if (cellClass === "*") {
      // `?view=cell` with no cell named: open the busiest class's latest due installment.
      const top = [...base.classwise.rows].sort((a, b) => b.pendingToday - a.pendingToday)[0];
      const dueNos = base.classwise.dueNos.filter((n) => top?.cells[n]?.due);
      cellClass = top?.classLabel;
      cellInst = dueNos[dueNos.length - 1] ?? base.classwise.installmentNos[0];
    }
    if (cellClass && cellInst) {
      const students = cellStudents(balances, today, cellClass, cellInst);
      base.cell = {
        classLabel: cellClass,
        installmentNo: cellInst,
        dueDate: base.classwise.dueDates[cellInst] ?? null,
        students: students.map(({ fatherPhone, ...s }) => ({ ...s, phone: maskPhone(fatherPhone) })),
      };
    }
  }

  if (view === "daybook") {
    const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) && input.date <= today ? input.date : today;
    const fc = await getFinanceControlsPageData(date, sessionLabel);
    base.daybook = {
      date: fc.selectedDate,
      closure: fc.closure ? { status: fc.closure.status, closedAt: fc.closure.closedAt, closedByName: fc.closure.closedByName } : null,
      collected: fc.summary.receiptTotal,
      paidOut: fc.dayBookRows.reduce((s, r) => s + r.cashOut, 0),
      receiptCount: fc.summary.receiptCount,
      reversedCount: fc.summary.reversedReceiptCount,
      rows: fc.dayBookRows.map((r) => ({
        id: `${r.entryType}-${r.entryId}`,
        type: r.entryType,
        postedAt: r.postedAt,
        studentId: r.studentId,
        studentName: r.studentName,
        classLabel: r.classLabel,
        receiptNumber: r.receiptNumber,
        mode: r.paymentMode,
        cashIn: r.cashIn,
        cashOut: r.cashOut,
        status: r.statusLabel,
        tone: r.statusTone,
        note: r.note,
      })),
    };
  }

  return base;
}
