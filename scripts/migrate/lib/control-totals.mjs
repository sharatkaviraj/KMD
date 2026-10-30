/**
 * Control totals: the money a copy must match, computed exactly as the fees
 * app's read-only MCP computes them (plan §2.5; rule 4, copy don't reinvent).
 *
 * Ported from the fees repo at 8a0cd47c:
 *   workers/schoolfees-mcp/src/scope.mjs           STUDENT_SCOPES, rowInScope
 *   workers/schoolfees-mcp/src/shape/student.mjs   moneySegment, summarizeFinancialRows,
 *                                                  groupFinancialRows
 *   workers/schoolfees-mcp/src/format.mjs          number
 * What changed and why: nothing in the arithmetic. The scope predicates are
 * applied client-side (rowInScope) over rows already read from
 * `v_workbook_student_financials`, because the extract reads the whole view
 * once; the MCP pushes the same predicate into PostgREST. The class rollup's
 * sort is by key rather than by pending money, so two runs line up row for row.
 *
 * The two rules, which are deliberately different (fees migration
 * 20260808210000):
 *   headcount  on_roll      record_status = 'active'
 *   money      collectable  record_status = 'active' OR total_paid > 0
 * Fees and late fees are separate figures and are never added together except
 * as the explicitly named totalCollectable.
 *
 * Pure: no database, no network. tests/migrate-control-totals.test.ts.
 */

export const SCOPE_NAMES = ["on_roll", "collectable", "left_owing", "everyone"];

/** fees format.mjs `number`: whole rupees, null and junk as 0. */
export function number(value) {
  return Math.round(Number(value || 0));
}

/** fees scope.mjs `rowInScope`, unchanged. */
export function rowInScope(row, name) {
  const status = row?.record_status;
  const paid = Number(row?.total_paid || 0);
  const outstanding = Number(row?.outstanding_amount || 0);
  switch (name) {
    case "on_roll":
      return status === "active";
    case "collectable":
      return status === "active" || paid > 0;
    case "left_owing":
      return status !== "active" && outstanding > 0;
    case "everyone":
      return true;
    default:
      throw new Error(`Unknown student scope "${name}". Every read must name one of: ${SCOPE_NAMES.join(", ")}.`);
  }
}

/** fees shape/student.mjs `moneySegment`, unchanged. */
export function moneySegment(row) {
  const baseChargeTotal = number(row.base_charge_total ?? row.total_due);
  const totalPaid = number(row.total_paid);
  const closeouts = number(row.total_discount_closeouts);
  const outstanding = number(row.outstanding_amount);

  if (totalPaid === 0 && baseChargeTotal > 0) return "never_paid";
  if (totalPaid > 0 && outstanding > 0) return "partly_paid";
  if (outstanding <= 0 && totalPaid + closeouts > 0 && baseChargeTotal > 0) return "year_clear";
  return "unclassified";
}

/** fees shape/student.mjs `summarizeFinancialRows`, unchanged. */
export function summarizeFinancialRows(rows) {
  const summary = {
    studentCount: 0,
    onRollCount: 0,
    notOnRollCount: 0,
    pendingStudentCount: 0,
    overdueStudentCount: 0,
    lateFeePendingStudentCount: 0,
    totalExpectedFees: 0,
    totalPaid: 0,
    totalFeesPending: 0,
    totalLateFeeCharged: 0,
    totalLateFeeWaived: 0,
    totalLateFeePending: 0,
    totalCollectable: 0,
    totalDiscount: 0,
    totalDiscountCloseouts: 0,
    moneySegments: { never_paid: 0, partly_paid: 0, year_clear: 0, unclassified: 0 },
  };

  for (const row of rows) {
    const feesPending = number(row.outstanding_amount);
    const lateFeePending = number(row.late_fee_outstanding_amount);

    summary.studentCount += 1;
    if (row.record_status === "active") summary.onRollCount += 1;
    else summary.notOnRollCount += 1;

    summary.totalExpectedFees += number(row.base_charge_total ?? row.total_due);
    summary.totalPaid += number(row.total_paid);
    summary.totalFeesPending += feesPending;
    summary.totalLateFeeCharged += number(row.late_fee_total);
    summary.totalLateFeeWaived += number(row.late_fee_waiver_amount);
    summary.totalLateFeePending += lateFeePending;
    summary.totalCollectable += feesPending + lateFeePending;
    summary.totalDiscount += number(row.discount_amount);
    summary.totalDiscountCloseouts += number(row.total_discount_closeouts);
    summary.moneySegments[moneySegment(row)] += 1;

    if (feesPending > 0) summary.pendingStudentCount += 1;
    if (number(row.overdue_installment_count) > 0) summary.overdueStudentCount += 1;
    if (lateFeePending > 0) summary.lateFeePendingStudentCount += 1;
  }

  return summary;
}

/** fees shape/student.mjs `groupFinancialRows`; sorted by key for a stable diff. */
export function groupFinancialRows(rows, keySelector, labelSelector = keySelector) {
  const groups = new Map();
  for (const row of rows) {
    const key = keySelector(row) || "unknown";
    const current = groups.get(key) || {
      key,
      label: labelSelector(row) || key,
      studentCount: 0,
      onRollCount: 0,
      pendingStudentCount: 0,
      overdueStudentCount: 0,
      totalExpectedFees: 0,
      totalPaid: 0,
      totalFeesPending: 0,
      totalLateFeePending: 0,
      totalDiscount: 0,
    };
    current.studentCount += 1;
    if (row.record_status === "active") current.onRollCount += 1;
    current.totalExpectedFees += number(row.base_charge_total ?? row.total_due);
    current.totalPaid += number(row.total_paid);
    current.totalFeesPending += number(row.outstanding_amount);
    current.totalLateFeePending += number(row.late_fee_outstanding_amount);
    current.totalDiscount += number(row.discount_amount);
    if (number(row.outstanding_amount) > 0) current.pendingStudentCount += 1;
    if (number(row.overdue_installment_count) > 0) current.overdueStudentCount += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

/**
 * The session money summary, shaped like the MCP's `get_session_money_summary`
 * headcount + money blocks, from the rows of `v_workbook_student_financials`.
 */
export function sessionMoneySummary(financialRows, sessionLabel) {
  const inSession = financialRows.filter((row) => row.session_label === sessionLabel);
  const onRoll = inSession.filter((row) => rowInScope(row, "on_roll")).length;
  const collectable = inSession.filter((row) => rowInScope(row, "collectable"));
  return {
    sessionLabel,
    headcount: { studentsOnRoll: onRoll, scope: "on_roll" },
    money: { ...summarizeFinancialRows(collectable), scope: "collectable" },
  };
}

/**
 * The MCP's `yearSplit` block: current year against previous-year
 * carry-forward, split on `is_carry_forward`, never on session_label.
 * Ported from the fee schema's `public.get_dashboard_fee_split(p_session_label)`
 * (the RPC the MCP's get_session_money_summary calls; read from wtgx, which
 * matches live per docs/cutover/SCHEMA-PARITY.md) and the MCP's shaping in
 * workers/schoolfees-mcp/src/tools/money.mjs. What changed: the SQL runs
 * here over rows already extracted — `v_workbook_installment_balances`,
 * `students`, `classes`, `payments`, `receipts` — because the sealed reader
 * cannot call an RPC. Arithmetic unchanged:
 *   scope   balance rows of the session, class active, and the student active
 *           OR with any payment on a non-discount receipt;
 *   collected against base = least(greatest(applied, 0), base_charge);
 *   late fee pending = greatest(late_fee_pending, 0), current year only.
 * Pure.
 */
/**
 * @param {{ balances?: any[], students?: any[], classes?: any[], payments?: any[], receipts?: any[] }} inputs
 * @param {string} sessionLabel
 * @param {{ exclude?: Set<string> }} [options]
 */
export function sessionYearSplit({ balances = [], students = [], classes = [], payments = [], receipts = [] }, sessionLabel, { exclude = new Set() } = {}) {
  const classStatus = new Map(classes.map((c) => [String(c.id), c.status]));
  const studentStatus = new Map(students.map((s) => [String(s.id), s.status]));
  const receiptMode = new Map(receipts.map((r) => [String(r.id), r.payment_mode]));
  const paidSomething = new Set(payments.filter((p) => receiptMode.has(String(p.receipt_id)) && receiptMode.get(String(p.receipt_id)) !== "discount").map((p) => String(p.student_id)));

  const sums = { cyExpected: 0, cyCollected: 0, cyPending: 0, pyOriginal: 0, pyCollected: 0, pyPending: 0, latePending: 0 };
  for (const b of balances) {
    if (b.session_label !== sessionLabel) continue;
    const studentId = String(b.student_id);
    if (exclude.has(studentId)) continue;
    if (classStatus.get(String(b.class_id)) !== "active") continue;
    if (!studentStatus.has(studentId)) continue;
    if (studentStatus.get(studentId) !== "active" && !paidSomething.has(studentId)) continue;
    const base = Number(b.base_charge ?? 0);
    const collected = Math.min(Math.max(Number(b.applied_amount ?? 0), 0), base);
    const pending = Number(b.pending_amount ?? 0);
    if (b.is_carry_forward === true) {
      sums.pyOriginal += base;
      sums.pyCollected += collected;
      sums.pyPending += pending;
    } else {
      sums.cyExpected += base;
      sums.cyCollected += collected;
      sums.cyPending += pending;
      sums.latePending += Math.max(Number(b.late_fee_pending ?? 0), 0);
    }
  }
  return {
    currentYear: { expected: number(sums.cyExpected), collected: number(sums.cyCollected), pending: number(sums.cyPending) },
    previousYear: { originalBalance: number(sums.pyOriginal), collected: number(sums.pyCollected), pending: number(sums.pyPending) },
    lateFeePending: number(sums.latePending),
  };
}

/** Year-split fields the MCP reports, compared field by field. */
export const MCP_YEAR_SPLIT_FIELDS = [
  ["currentYear", "expected"], ["currentYear", "collected"], ["currentYear", "pending"],
  ["previousYear", "originalBalance"], ["previousYear", "collected"], ["previousYear", "pending"],
  ["lateFeePending"],
];

/** Per-class rollups for one session, money scope. */
export function classRollups(financialRows, sessionLabel) {
  return groupFinancialRows(
    financialRows.filter((row) => row.session_label === sessionLabel && rowInScope(row, "collectable")),
    (row) => row.class_id,
    (row) => row.class_label ?? row.class_name,
  ).map((group) => {
    // Ids and sums only: no class label in a report.
    const rest = { ...group };
    delete rest.label;
    return rest;
  });
}

/** The money fields the MCP reports, for a field-by-field comparison. */
export const MCP_MONEY_FIELDS = [
  "studentCount", "onRollCount", "notOnRollCount", "pendingStudentCount", "overdueStudentCount",
  "lateFeePendingStudentCount", "totalExpectedFees", "totalPaid", "totalFeesPending",
  "totalLateFeeCharged", "totalLateFeeWaived", "totalLateFeePending", "totalCollectable",
  "totalDiscount", "totalDiscountCloseouts",
];

/**
 * Compare our summary with what the MCP said. Returns [{ field, ours, theirs }]
 * for every field that differs (empty = match). `theirs` is the MCP payload's
 * structuredContent (or anything with `headcount` and `money`).
 */
export function compareWithMcp(ours, theirs) {
  const out = [];
  const ourHead = ours?.headcount?.studentsOnRoll;
  const theirHead = theirs?.headcount?.studentsOnRoll;
  if (ourHead !== theirHead) out.push({ field: "headcount.studentsOnRoll", ours: ourHead, theirs: theirHead });
  for (const field of MCP_MONEY_FIELDS) {
    const a = ours?.money?.[field];
    const b = theirs?.money?.[field];
    if (b === undefined) continue; // the MCP does not report every field we do
    if (a !== b) out.push({ field: `money.${field}`, ours: a, theirs: b });
  }
  for (const segment of ["never_paid", "partly_paid", "year_clear", "unclassified"]) {
    const a = ours?.money?.moneySegments?.[segment];
    const b = theirs?.money?.moneySegments?.[segment];
    if (b === undefined) continue;
    if (a !== b) out.push({ field: `money.moneySegments.${segment}`, ours: a, theirs: b });
  }
  if (theirs?.yearSplit) {
    if (!ours?.yearSplit) out.push({ field: "yearSplit", ours: "not computed (extract has no v_workbook_installment_balances)", theirs: "present" });
    else {
      for (const fieldPath of MCP_YEAR_SPLIT_FIELDS) {
        const a = fieldPath.reduce((o, k) => o?.[k], ours.yearSplit);
        const b = fieldPath.reduce((o, k) => o?.[k], theirs.yearSplit);
        if (b === undefined) continue;
        if (a !== b) out.push({ field: `yearSplit.${fieldPath.join(".")}`, ours: a, theirs: b });
      }
    }
  }
  return out;
}
