import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { documentKindLabels, humanSize } from "@/modules/collection/domain/review";
import { studentFees, type StudentFees } from "@/modules/students-fees/vx/admin-students";
import { schoolToday } from "@/vx/format";
import {
  installmentState,
  moneyFromInstallments,
  parseTab,
  recentWeeks,
  tabsFor,
  type MarkStatus,
} from "@/vx/screens/admin/logic";
import { loadStudentSchool } from "@/vx/screens/admin/data";
import { notesForStudentTab } from "@/vx/screens/admin/notes-tab";
import { Student360 } from "@/vx/screens/admin/student360";
import { T } from "@/vx/screens/admin/text";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, EmptyState } from "@/vx/ui/primitives";

export const runtime = "nodejs";

export const metadata = { title: "Student" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Student 360 (P5, design F06–F08/D02). Overview, attendance, marks,
 * documents, notes, history and info from this app's own records; fees and
 * family from the fee app's, and only for `fees:view`.
 */
export default async function StudentPage(props: PageProps<"/students/[id]">) {
  const staff = await requirePermission("students:view", "/students");
  const language = staff.language;
  const { id } = await props.params;
  const search = await props.searchParams;
  const sessionLabel = await resolveSessionLabel();

  const valid = UUID.test(id) && Boolean(sessionLabel);
  const seesMoney = can(staff, "fees:view");

  // Everything this card shows is independent of everything else, so it all
  // starts at once: the fee side (the fee app's own reads) and the notes no
  // longer wait for the school side to finish first. On a phone that was the
  // difference between one round of queries and three in a row.
  const feesPromise = valid && seesMoney ? studentFees(id).catch((): StudentFees | null => null) : Promise.resolve(null);
  const notesPromise = valid && sessionLabel ? notesForStudentTab(staff, id, sessionLabel).catch(() => []) : Promise.resolve([]);
  const school = valid && sessionLabel ? await loadStudentSchool(staff, id, sessionLabel) : null;
  if (!school || !sessionLabel) {
    return (
      <VxPage>
        <TopBar title={lead(T.students, language)} mBack="/students" />
        <main>
          <Section>
            <EmptyState icon="user" title={lead(sessionLabel ? T.notFound : T.noSession, language)} action={<Btn href="/students">{lead(T.backToStudents, language)}</Btn>} />
          </Section>
        </main>
      </VxPage>
    );
  }

  const tabs = tabsFor({
    fees: seesMoney,
    documents: can(staff, "documents:view"),
    notes: can(staff, "notes:view"),
    history: can(staff, "collection:view"),
    marks: can(staff, "marks:view"),
  });
  const tab = parseTab(typeof search.tab === "string" ? search.tab : null, tabs);
  const today = schoolToday();

  const [fees, notes] = await Promise.all([feesPromise, notesPromise]);

  const closed = new Set(school.closedDays);
  const counts: Record<MarkStatus, number> = { present: 0, absent: 0, half_day: 0, late: 0, leave: 0 };
  for (const row of school.attendance) counts[row.status] += 1;

  return (
    <VxPage label={school.card.fullName}>
      {/* Keyed by child: the tab is client state now, and a sibling opened
          from the family tab must start on its own overview. */}
      <Student360
        key={id}
        p={{
          id,
          name: school.card.fullName,
          classLabel: school.classLabel,
          sr: school.card.admissionNo,
          rollNo: school.rollNo,
          status: fees?.status ?? school.card.status,
          father: school.card.fatherName,
          mother: school.card.motherName,
          phone: school.card.guardianPhone ?? school.card.primaryPhone,
          address: fees?.address ?? null,
          dob: fees?.dateOfBirth ?? null,
          joined: fees?.joinedOn ?? null,
          route: fees?.routeLabel ?? null,
          tab,
          tabs,
          money: fees ? moneyFromInstallments(fees.installments, today) : null,
          installments: fees
            ? fees.installments.map((row) => ({
                id: row.installmentId,
                label: row.installmentLabel,
                dueDate: row.dueDate,
                state: installmentState(row, today),
                status: row.balanceStatus,
                pending: row.pendingAmount,
                settled: row.feeSettledAmount,
                paid: row.settledAmount,
                receiptedHere: row.appliedAmount + row.discountCloseoutAmount,
                adjusted: row.adjustmentAmount,
                base: row.baseCharge,
                lateFee: row.finalLateFee,
                lateFeeWaived: row.waiverApplied,
                lateFeePending: row.lateFeePending,
                carry: row.isCarryForward,
              }))
            : null,
          feeSummary: fees?.summary ?? null,
          feeBreakup: fees?.breakup ?? null,
          feeSession: fees?.sessionLabel ?? null,
          receipts: fees?.receipts ?? null,
          family: fees ? fees.family.map((m) => ({ id: m.id, name: m.fullName, sr: m.admissionNo, classLabel: m.classLabel, self: m.isSelf })) : null,
          attendance: {
            percent: school.attendancePercent,
            counted: school.attendanceCounted,
            counts,
            weeks: recentWeeks(school.attendance, today, 4, (day) => closed.has(day)),
          },
          terms: school.terms.map((t) => ({
            term: t.term,
            percent: t.totals.percent,
            grade: t.grade,
            missing: t.totals.missing,
            scored: t.totals.scored,
            outOf: t.totals.outOf,
          })),
          documents: school.documents.map((d) => ({
            id: d.id,
            kind: lead(documentKindLabels[d.kind], language),
            fileName: d.fileName,
            size: humanSize(d.byteSize),
            createdAt: d.createdAt,
            by: d.uploadedByName,
          })),
          notes: notes.map((n) => ({ id: n.id, body: n.body, kindEn: n.kindLabelEn, kindHi: n.kindLabelHi, by: n.writtenByName, createdAt: n.createdAt })),
          history: school.history.map((h) => ({
            id: h.id,
            label: { en: h.labelEn, hi: h.labelHi },
            from: h.oldValue,
            to: h.newValue,
            blocked: h.outcome === "blocked",
            at: h.recordedAt,
            by: h.actorName,
          })),
          canCollect: can(staff, "fees:collect"),
          canManageDocuments: can(staff, "documents:manage"),
          canManageFees: can(staff, "fees:manage"),
        }}
      />
    </VxPage>
  );
}
