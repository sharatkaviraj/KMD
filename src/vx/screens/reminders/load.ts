import "server-only";

import { byClassLabel } from "@/modules/academics/domain/class-order";

import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { loadDuesBoard, loadLeftOwing } from "@/modules/defaulters/vx/data";
import { groupFamilies, type ContactSummary } from "@/modules/defaulters/vx/domain/families";
import { addDays } from "@/modules/receipts/vx/domain/day-close";
import { listRuns, runRecipients } from "@/modules/whatsapp/vx/data";
import type { AudienceFamily } from "@/modules/whatsapp/vx/domain/reminders";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { schoolToday } from "@/vx/format";
import { listPromises } from "@/vx/screens/dues/data";

import { getBatch, listBatches, listRules } from "./data";
import type { RemindersProps, RemindersView, RunDetail } from "./types";

type Search = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export async function resolveSession(search: Search = {}): Promise<string> {
  const viewSession = await resolveViewSession({ searchParamSession: search.session ?? null, cookieSession: await getViewSessionCookie() });
  return viewSession.sessionLabel;
}

/**
 * Every family a reminder could reach, with the facts the leave-out rules need.
 * The amounts are pending today and not due yet, never a late fee.
 */
export async function loadAudience(sessionLabel: string, today: string): Promise<{ families: AudienceFamily[]; classOf: Map<string, string> }> {
  const [board, left, promises] = await Promise.all([loadDuesBoard(sessionLabel), loadLeftOwing(sessionLabel), listPromises(sessionLabel, today)]);
  const promisedIds = new Set(promises.filter((pr) => pr.kind === "pay").map((pr) => pr.studentId));
  const contacts = new Map<string, ContactSummary>(Object.entries(board.contacts));
  const recent = addDays(today, -3);
  const classOf = new Map<string, string>();
  for (const s of board.students) classOf.set(s.studentId, s.classLabel);

  const families: AudienceFamily[] = groupFamilies(board.students, contacts).map((f) => ({
    key: f.key,
    studentIds: f.kids.map((k) => k.studentId),
    fatherName: f.fatherName,
    kidsLine: f.kids.map((k) => `${k.fullName.split(" ")[0]} · ${k.classLabel}`).join(", "),
    classLabels: f.kids.map((k) => k.classLabel),
    pendingToday: f.pendingToday,
    notDueYet: f.notDueYet,
    usesBus: f.usesBus,
    overdueInstallments: f.overdueInstallments,
    daysOverdue: f.days,
    promised:
      f.kids.some((k) => promisedIds.has(k.studentId)) ||
      f.kids.some((k) => {
        const c = contacts.get(k.studentId);
        return c?.lastOutcome === "promised_pay" && (c.snoozeUntil ?? "") >= today;
      }),
    paidLast3Days: f.kids.some((k) => (k.lastPaymentDate ?? "") >= recent),
    left: false,
  }));
  const onRoll = new Set(families.flatMap((f) => f.studentIds));
  for (const l of left) {
    if (onRoll.has(l.studentId)) continue;
    classOf.set(l.studentId, l.classLabel ?? "—");
    families.push({
      key: `s:${l.studentId}`,
      studentIds: [l.studentId],
      fatherName: l.fatherName?.trim() || l.fullName,
      kidsLine: `${l.fullName.split(" ")[0]} · ${l.classLabel ?? "—"}`,
      classLabels: [l.classLabel ?? ""],
      pendingToday: Math.round(l.owed),
      notDueYet: 0,
      usesBus: false,
      overdueInstallments: [],
      promised: false,
      paidLast3Days: (l.lastPaymentDate ?? "") >= recent,
      left: true,
    });
  }
  return { families, classOf };
}

export async function loadReminders(staff: CurrentStaff, search: Search): Promise<RemindersProps> {
  const today = schoolToday();
  const sessionLabel = await resolveSession(search);
  const viewParam = one(search.view) as RemindersView;
  const stepNum = Number(one(search.step));
  const step = (stepNum === 2 || stepNum === 3 ? stepNum : 1) as 1 | 2 | 3;

  const [runs, batches, rules] = await Promise.all([listRuns(sessionLabel), listBatches(sessionLabel), listRules()]);

  let view: RemindersView = ["wizard", "sending", "results", "empty"].includes(viewParam) ? viewParam : "list";
  if (view === "list" && runs.length === 0 && batches.length === 0) view = "empty";

  const needsAudience = view === "wizard" || view === "results";
  const audience = needsAudience ? await loadAudience(sessionLabel, today) : null;

  const batchId = one(search.batch);
  const batch = view === "sending" && batchId ? await getBatch(batchId) : null;
  if (view === "sending" && !batch) view = "list";

  let result: RunDetail | null = null;
  if (view === "results") {
    const run = runs.find((r) => r.runId === one(search.run)) ?? runs[0];
    if (run) {
      const recipients = await runRecipients(run.runId);
      const byClass = new Map<string, { classLabel: string; messaged: number; quoted: number }>();
      for (const r of recipients) {
        const label = audience?.classOf.get(r.studentId) ?? "—";
        const c = byClass.get(label) ?? { classLabel: label, messaged: 0, quoted: 0 };
        c.messaged += 1;
        c.quoted += r.dueAmount;
        byClass.set(label, c);
      }
      result = {
        run,
        notDelivered: recipients
          .filter((r) => r.status === "failed")
          .map((r) => ({ studentId: r.studentId, studentName: r.studentName, classLabel: audience?.classOf.get(r.studentId) ?? null, error: r.error })),
        byClass: [...byClass.values()].sort((a, b) => byClassLabel(a.classLabel, b.classLabel)),
      };
    } else {
      view = "list";
    }
  }

  const ruleKey = one(search.rule);
  return {
    today,
    sessionLabel,
    view,
    step,
    runs,
    batches,
    rules,
    audience: view === "wizard" ? (audience?.families ?? []) : [],
    batch,
    result,
    ruleOpen: one(search.sheet) === "rule" && rules.some((r) => r.ruleKey === ruleKey) ? ruleKey : null,
    perms: { queue: can(staff, "fees:view"), rules: can(staff, "fees:manage") },
  };
}
