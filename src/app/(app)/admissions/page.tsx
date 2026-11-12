import { requirePermission } from "@/platform/auth/current-staff";
import { getStudentSegmentCounts } from "@/modules/students-fees/data/directory";
import { segmentCount } from "@/modules/students-fees/domain/student-segments";
import { loadAdmissionsFeeContext, loadAdmissionsRosterContext, loadRecentAdmissions } from "@/modules/students-fees/vx/admissions";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { shortDay, shortDayP, schoolToday } from "@/vx/format";
import { getViewer } from "@/vx/view-as";
import { can } from "@/platform/auth/permissions";

import { AdmissionsListScreen, type AdmittedCard, type BoardCard, type DocState, type Kpis, type RecentRow } from "@/vx/screens/admissions/board";
import { listEnquiries, loadAdmissionDetails, loadSeats } from "@/vx/screens/admissions/data";
import { daysSince, usualAgeFor, visitWhen, type Stage } from "@/vx/screens/admissions/logic";

export const runtime = "nodejs";

function band(label: string): string {
  const l = label.toLowerCase();
  if (/nursery|jkg|skg|lkg|ukg/.test(l)) return "Pre";
  const n = Number(l.match(/(\d{1,2})/)?.[1] ?? 0);
  if (n >= 11) return "11–12";
  if (n >= 9) return "9–10";
  if (n >= 6) return "6–8";
  return "1–5";
}

/** A TC from an old school is not asked of a pre-primary child. */
function needsTc(classLabel: string): boolean {
  const age = usualAgeFor(classLabel);
  return age === null || age >= 6;
}

/** Admissions (SCREENS.md "Admissions", state `list`): pipeline, seats, recent admissions. */
export default async function AdmissionsPage() {
  await requirePermission("fees:manage", "/admissions");
  const { staff } = await getViewer();
  const canonical=usesCanonicalFees(staff,await getViewSessionCookie());
  const ctx = canonical ? await loadAdmissionsRosterContext() : await loadAdmissionsFeeContext();
  const [enquiries, recent, seats, segments] = await Promise.all([
    listEnquiries(ctx.sessionLabel),
    loadRecentAdmissions(ctx.sessionLabel, 12),
    loadSeats(ctx.sessionLabel),
    canonical ? Promise.resolve(null) : getStudentSegmentCounts({ sessionLabel: ctx.sessionLabel }).catch(() => null),
  ]);
  const details = await loadAdmissionDetails(recent.recent.map((r) => r.id));

  const now = new Date();
  const today = schoolToday(now);
  const open = enquiries.filter((e) => e.stage !== "admitted" && e.stage !== "closed");
  const cards: BoardCard[] = open.map((e) => {
    const when = visitWhen(e.visitOn, today);
    return {
      id: e.id,
      stage: e.stage as Stage,
      name: e.childName,
      classLabel: e.classLabel ?? "—",
      parent: e.parentName ?? "—",
      phone: e.phone,
      days: daysSince(e.stageChangedAt, now),
      // A school visit booked on WhatsApp (D-592, D-593): the card says when.
      visit: when && e.visitOn && e.visitPart ? { when, day: shortDayP(e.visitOn), part: e.visitPart } : null,
      fromWhatsApp: e.source === "whatsapp",
    };
  });

  const recentRows: RecentRow[] = recent.recent.map((r) => {
    const docs = details.get(r.id)?.docs ?? {};
    const state = (k: "birth" | "tc" | "photo"): DocState => (k === "tc" && !needsTc(r.classLabel) ? "na" : docs[k] === true ? "ok" : "pending");
    return { id: r.id, name: r.name, classLabel: r.classLabel, sr: r.admissionNo, date: shortDay(r.createdAt), isNew: schoolToday(new Date(r.createdAt)) === today, docs: { birth: state("birth"), tc: state("tc"), photo: state("photo") } };
  });
  const admitted: AdmittedCard[] = recent.recent.slice(0, 5).map((r) => ({ id: r.id, name: r.name, classLabel: r.classLabel, parent: r.fatherName ?? "—", sr: r.admissionNo }));

  let seatsLeft: number | null = null;
  const bands = new Map<string, { left: number; cap: number }>();
  for (const c of ctx.classes) {
    const cap = seats.get(c.id);
    if (cap === undefined) continue;
    const left = Math.max(0, cap - c.onRoll);
    seatsLeft = (seatsLeft ?? 0) + left;
    const b = band(c.label);
    const now = bands.get(b) ?? { left: 0, cap: 0 };
    bands.set(b, { left: now.left + left, cap: now.cap + cap });
  }

  const kpis: Kpis = {
    // The fee app's "New" tier, the same count as the Students "New this year"
    // chip. Rows created since 1 April said 537 — more than the roll — because
    // every row of an imported or replicated roll is new by that test (admin B7).
    newCount: segmentCount(segments, "newThisYear") ?? recent.count,
    openEnquiries: open.length,
    waitingWeek: cards.filter((c) => c.days >= 7).length,
    docsPending: recentRows.reduce((n, r) => n + (["birth", "tc", "photo"] as const).filter((k) => r.docs[k] === "pending").length, 0),
    seatsLeft,
    seatsEditable: can(staff, "settings:manage"),
    bands: ["Pre", "1–5", "6–8", "9–10", "11–12"].filter((b) => bands.has(b)).map((b) => ({ short: b, ...bands.get(b)! })),
  };

  return <AdmissionsListScreen sessionLabel={ctx.sessionLabel} kpis={kpis} cards={cards} admitted={admitted} recent={recentRows} classLabels={ctx.classes.map((c) => c.label)} />;
}
