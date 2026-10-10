import { requirePermission } from "@/platform/auth/current-staff";
import { loadAdmissionsFeeContext, loadRecentAdmissions } from "@/modules/students-fees/vx/admissions";
import { dayMonth } from "@/vx/format";
import { lead } from "@/vx/text";
import { VxPage, TopBar, Section } from "@/vx/ui/page";
import { Btn } from "@/vx/ui/primitives";
import { getViewer } from "@/vx/view-as";

import { AdmissionsBoard, type AdmittedCard, type BoardCard, type Kpis, type RecentRow } from "@/vx/screens/admissions/board";
import { listEnquiries, loadAdmissionDetails, loadSeats } from "@/vx/screens/admissions/data";
import { daysSince, type Stage } from "@/vx/screens/admissions/logic";

export const runtime = "nodejs";

const DOC_SHORT: Record<string, string> = { birth: "Birth cert.", photo: "Photo", aadhaar: "Aadhaar", tc: "TC", address: "Address proof" };

function band(label: string): string {
  const l = label.toLowerCase();
  if (/nursery|jkg|skg|lkg|ukg/.test(l)) return "Pre";
  const n = Number(l.match(/(\d{1,2})/)?.[1] ?? 0);
  if (n >= 11) return "11–12";
  if (n >= 9) return "9–10";
  if (n >= 6) return "6–8";
  return "1–5";
}

/** Admissions (SCREENS.md "Admissions", state `list`): pipeline, seats, recent admissions. */
export default async function AdmissionsPage() {
  await requirePermission("fees:manage", "/admissions");
  const { staff } = await getViewer();
  const lang = staff.language;
  const ctx = await loadAdmissionsFeeContext();
  const [enquiries, recent, seats] = await Promise.all([listEnquiries(ctx.sessionLabel), loadRecentAdmissions(ctx.sessionLabel, 12), loadSeats(ctx.sessionLabel)]);
  const details = await loadAdmissionDetails(recent.recent.map((r) => r.id));

  const now = new Date();
  const open = enquiries.filter((e) => e.stage !== "admitted" && e.stage !== "closed");
  const cards: BoardCard[] = open.map((e) => ({
    id: e.id,
    stage: e.stage as Stage,
    name: e.childName,
    classLabel: e.classLabel ?? "—",
    parent: e.parentName ?? "—",
    phone: e.phone,
    days: daysSince(e.stageChangedAt, now),
  }));

  const recentRows: RecentRow[] = recent.recent.map((r) => {
    const d = details.get(r.id);
    const missing = d ? (["birth", "photo", "aadhaar"] as const).filter((k) => d.docs[k] !== true).map((k) => DOC_SHORT[k]) : [];
    return { id: r.id, name: r.name, classLabel: r.classLabel, sr: r.admissionNo, date: dayMonth(r.createdAt), missing };
  });
  const admitted: AdmittedCard[] = recent.recent.slice(0, 5).map((r) => ({ id: r.id, name: r.name, classLabel: r.classLabel, parent: r.fatherName ?? "—", sr: r.admissionNo }));

  let seatsLeft: number | null = null;
  const bands = new Map<string, number>();
  for (const c of ctx.classes) {
    const cap = seats.get(c.id);
    if (cap === undefined) continue;
    const left = Math.max(0, cap - c.onRoll);
    seatsLeft = (seatsLeft ?? 0) + left;
    const b = band(c.label);
    bands.set(b, (bands.get(b) ?? 0) + left);
  }

  const kpis: Kpis = {
    newCount: recent.count,
    openEnquiries: open.length,
    waitingWeek: cards.filter((c) => c.days >= 7).length,
    docsPending: recentRows.reduce((n, r) => n + r.missing.length, 0),
    seatsLeft,
    bands: ["Pre", "1–5", "6–8", "9–10", "11–12"].filter((b) => bands.has(b)).map((b) => ({ short: b, left: bands.get(b) ?? 0 })),
  };

  return (
    <VxPage>
      <TopBar
        crumb={`${lead({ en: "Students", hi: "विद्यार्थी" }, lang)} · ${lead({ en: "Session", hi: "सत्र" }, lang)} ${ctx.sessionLabel}`}
        title={lead({ en: "Admissions", hi: "दाख़िले" }, lang)}
        actions={<Btn variant="pri" icon="userPlus" href="/admissions/new">{lead({ en: "Add a student", hi: "विद्यार्थी जोड़ें" }, lang)}</Btn>}
        mSub={`${lead({ en: "Session", hi: "सत्र" }, lang)} ${ctx.sessionLabel}`}
        mBack="/menu"
        mAction={<Btn variant="pri" icon="userPlus" href="/admissions/new" ariaLabel="Add a student" style={{ height: 40 }}>{lead({ en: "Add", hi: "जोड़ें" }, lang)}</Btn>}
      />
      <main>
        <Section gap={18}>
          <AdmissionsBoard sessionLabel={ctx.sessionLabel} kpis={kpis} cards={cards} admitted={admitted} recent={recentRows} classLabels={ctx.classes.map((c) => c.label)} />
        </Section>
      </main>
    </VxPage>
  );
}
