import Link from "next/link";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { studentAttendance } from "@/modules/attendance/data/attendance-repo";
import { ownClassIds } from "@/modules/attendance/data/teaching-repo";
import {
  attendanceLabels,
  attendancePercent,
  type AttendanceStatus,
} from "@/modules/attendance/domain/attendance";
import { listNoteKinds, notesForStudent } from "@/modules/notes/data/notes-repo";
import { canReadNote } from "@/modules/notes/domain/notes";
import { NoteComposer } from "@/modules/notes/ui/note-composer";
import { NoteList } from "@/modules/notes/ui/note-list";
import {
  enrolmentForStudent,
  feeStanding,
  getStudentCard,
} from "@/modules/students/data/student-repo";
import { Badge, Card, DetailList, Notice, Section } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.studentTitle) };
}

const rupees = (amount: number) =>
  `₹${new Intl.NumberFormat("en-IN").format(Math.round(amount))}`;

/**
 * One child, assembled from both applications.
 *
 * The fee app owns who they are and what the family owes; VPPS One owns which
 * class they are in this session and everything written about them since. Two
 * rules shape what is shown:
 *
 *  - **fees and late fees never appear as one number** (D-33). A family whose
 *    only debt is a late fee is not a defaulter, and a single figure would tell
 *    a teacher otherwise in a conversation with a parent.
 *  - **money is only shown to somebody whose job it is.** A teacher does not
 *    need a family's dues in order to teach, and putting them on a screen
 *    opened in a corridor invites the conversation the office should be having.
 *
 * Marks are the one thing named in the plan for this card that is not here:
 * the assessment tables arrive in Phase 6, and a placeholder would be a
 * promise the data cannot keep.
 */
export default async function StudentPage(
  props: PageProps<"/teach/student/[id]">,
) {
  const staff = await requirePermission("attendance:view", "/teach");
  const language = staff.language;
  const { id: studentId } = await props.params;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader title={m.studentTitle} language={language} back={BACK} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const student = await getStudentCard(studentId);

  if (!student) {
    return (
      <>
        <PageHeader title={m.studentTitle} language={language} back={BACK} />
        <EmptyState title={m.notFound} language={language} />
      </>
    );
  }

  const seesMoney = can(staff, "collection:view");

  const [enrolment, history, labels, own, kinds, fees] = await Promise.all([
    enrolmentForStudent(studentId, sessionLabel),
    studentAttendance(studentId, sessionLabel),
    classLabelMap(sessionLabel),
    ownClassIds(staff.id, sessionLabel),
    listNoteKinds(),
    seesMoney ? feeStanding(studentId) : Promise.resolve(null),
  ]);

  const statuses = history.map((entry) => entry.status);
  const summary = attendancePercent(statuses);

  const counts = statuses.reduce<Record<AttendanceStatus, number>>(
    (totals, status) => {
      totals[status] += 1;
      return totals;
    },
    { present: 0, absent: 0, late: 0, leave: 0 },
  );

  const phone = student.guardianPhone ?? student.primaryPhone;
  const classId = enrolment?.classId ?? student.classId;
  const classLabel = classId ? (labels.get(classId) ?? "—") : "—";

  const allNotes = can(staff, "notes:view")
    ? await notesForStudent(studentId, sessionLabel)
    : [];

  const notes = allNotes.filter((note) =>
    canReadNote({
      hasNotesView: can(staff, "notes:view"),
      seesEverything: can(staff, "attendance:correct"),
      ownClassIds: own,
      note,
      staffId: staff.id,
    }),
  );

  return (
    <>
      <PageHeader
        title={t(student.fullName, student.fullName)}
        description={t(classLabel, classLabel)}
        language={language}
        back={BACK}
        action={
          classId ? (
            <Link
              href={`/teach/class/${classId}`}
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              {primary(m.teachClassTitle, language)}
            </Link>
          ) : null
        }
      />

      <Card className="p-5">
        <DetailList
          language={language}
          items={[
            { label: m.studentAdmissionNo, value: student.admissionNo ?? "—" },
            {
              label: m.studentRollNo,
              value: enrolment?.rollNo ?? student.rollNo ?? "—",
            },
            { label: m.studentFather, value: student.fatherName ?? "—" },
            { label: m.studentMother, value: student.motherName ?? "—" },
            {
              label: m.studentGuardianPhone,
              value: phone ? (
                // A tappable number, because the reason a teacher opens this
                // card at all is usually to ring somebody.
                <a
                  className="focus-ring rounded font-medium text-accent underline-offset-2 hover:underline"
                  href={`tel:${phone}`}
                >
                  {phone}
                </a>
              ) : (
                "—"
              ),
            },
          ]}
        />
      </Card>

      {/* --------------------------------------------------- attendance */}

      <Section className="mt-7" title={m.studentAttendance} language={language}>
        {summary.percent === null ? (
          <EmptyState title={m.studentAttendanceNone} language={language} />
        ) : (
          <Card className="p-5">
            <div className="flex items-baseline gap-3">
              <p className="text-[34px] font-semibold leading-none tabular-nums text-foreground">
                {summary.percent}%
              </p>
              <p className="text-[13px] text-muted-foreground">
                {summary.present} {primary(m.attendanceOf, language)}{" "}
                {summary.counted} {primary(m.registerWorkingDays, language)}
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              <Badge tone="success">
                {primary(attendanceLabels.present, language)} {counts.present}
              </Badge>
              {counts.late > 0 ? (
                <Badge tone="accent">
                  {primary(attendanceLabels.late, language)} {counts.late}
                </Badge>
              ) : null}
              {counts.absent > 0 ? (
                <Badge tone="danger">
                  {primary(attendanceLabels.absent, language)} {counts.absent}
                </Badge>
              ) : null}
              {counts.leave > 0 ? (
                <Badge tone="neutral">
                  {primary(attendanceLabels.leave, language)} {counts.leave}
                </Badge>
              ) : null}
            </div>
          </Card>
        )}
      </Section>

      {/* --------------------------------------------------------- fees */}

      {seesMoney && fees ? (
        <Section className="mt-7" title={m.studentFees} language={language}>
          {!fees.available ? (
            <Notice
              tone="warning"
              text={m.studentFeeUnavailable}
              language={language}
            />
          ) : (
            <Card className="p-5">
              <DetailList
                language={language}
                items={[
                  { label: m.studentFeeDue, value: rupees(fees.feeDue) },
                  { label: m.studentLateFee, value: rupees(fees.lateFeeDue) },
                  { label: m.studentFeePaid, value: rupees(fees.paid) },
                ]}
              />
              <p className="mt-3 text-[12px] leading-5 text-subtle-foreground">
                {primary(m.studentFeeNote, language)}
              </p>
            </Card>
          )}
        </Section>
      ) : null}

      {/* -------------------------------------------------------- notes */}

      {can(staff, "notes:view") ? (
        <Section className="mt-7" title={m.notesTitle} language={language}>
          <NoteList
            notes={notes}
            language={language}
            staffId={staff.id}
            studentId={studentId}
          />
        </Section>
      ) : null}

      {can(staff, "notes:write") ? (
        <Section
          className="mt-6"
          title={m.notesAboutStudent}
          language={language}
        >
          <NoteComposer
            kinds={kinds}
            studentId={studentId}
            classId={classId ?? ""}
          />
        </Section>
      ) : null}
    </>
  );
}

const BACK = { href: "/teach", label: m.teachTitle };
