import Link from "@/ui/link";
import { ArrowRight, FileText, Image as ImageIcon } from "lucide-react";

import * as m from "@/messages/pairs";
import { ms } from "@/messages/setup";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { countOf, primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { dayLabel, toSchoolDay } from "@/platform/dates";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { attendanceRules, studentAttendance } from "@/modules/attendance/data/attendance-repo";
import { classScopeFor, ownClassIds } from "@/modules/attendance/data/teaching-repo";
import { scopeIncludes } from "@/modules/attendance/domain/class-scope";
import { NotYourClass } from "@/modules/attendance/ui/not-your-class";
import {
  attendanceLabels,
  attendancePercent,
  type AttendanceStatus,
} from "@/modules/attendance/domain/attendance";
import { termSummaries } from "@/modules/assessments/data/reports-repo";
import {
  documentsForStudent,
  historyForStudent,
  recordsForStudent,
} from "@/modules/collection/data/documents-repo";
import {
  documentKindLabels,
  recordChangeNote,
  recordSourceLabel,
} from "@/modules/collection/domain/review";
import { DocumentForm } from "@/modules/collection/ui/office-forms";
import { RemoveDocument } from "@/modules/collection/ui/remove-document";
import { documentUploadMode } from "@/modules/collection/data/storage-settings";
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
import { PageHeader } from "@/ui/page-header-localized";
import { assertStudentVisible, notFoundUnlessVisible } from "@/platform/auth/test-session-access";

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
 * Marks arrived in Phase 6 and are one row per term rather than a grid: the
 * question this card answers is "how is this child doing", and the subject by
 * subject answer is the report card, one tap away.
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
        <PageHeader eyebrow={m.eyebrowMyClass} title={m.studentTitle} language={language} back={BACK} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId)) await notFoundUnlessVisible(() => assertStudentVisible(staff, studentId));
  const student = await getStudentCard(studentId);

  if (!student) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowMyClass} title={m.studentTitle} language={language} back={BACK} />
        <EmptyState title={m.notFound} language={language} />
      </>
    );
  }

  // A teacher opens the children of her own classes, not any child whose id
  // she can type. The card above carries guardian names and phone numbers and
  // is read through the service role, so this check is the boundary (P1).
  const [scope, placement] = await Promise.all([
    classScopeFor(staff, sessionLabel),
    enrolmentForStudent(studentId, sessionLabel),
  ]);
  if (
    !scopeIncludes(scope, placement?.classId) &&
    !scopeIncludes(scope, student.classId)
  ) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowMyClass} title={m.studentTitle} language={language} back={BACK} />
        <NotYourClass language={language} title={m.notYourStudentTitle} />
      </>
    );
  }

  // Dues are fee data, so they are read — not merely hidden — only for
  // `fees:view`, the permission the directory, Home, the dues badge and the
  // Student 360 money panel already use. `collection:view` was the gate here
  // and is the wrong one: it means "see details asked from parents" in the
  // role matrix and can be granted with no fee access at all, and the rule
  // that a teacher never holds a `fees:` permission does not reach it.
  const seesMoney = can(staff, "fees:view");

  const [enrolment, history, rules, labels, own, kinds, fees, records, documents, changes, uploadMode] =
    await Promise.all([
      enrolmentForStudent(studentId, sessionLabel),
      studentAttendance(studentId, sessionLabel),
      attendanceRules(sessionLabel),
      classLabelMap(sessionLabel),
      ownClassIds(staff.id, sessionLabel),
      listNoteKinds(),
      seesMoney ? feeStanding(studentId) : Promise.resolve(null),
      can(staff, "collection:view")
        ? recordsForStudent(studentId)
        : Promise.resolve([]),
      can(staff, "documents:view")
        ? documentsForStudent(studentId)
        : Promise.resolve([]),
      can(staff, "collection:view")
        ? historyForStudent(studentId)
        : Promise.resolve([]),
      can(staff, "documents:manage")
        ? documentUploadMode(staff.id)
        : Promise.resolve("supabase" as const),
    ]);

  const statuses = history.map((entry) => entry.status);
  const summary = attendancePercent(statuses, rules);

  const counts = statuses.reduce<Record<AttendanceStatus, number>>(
    (totals, status) => {
      totals[status] += 1;
      return totals;
    },
    { present: 0, absent: 0, half_day: 0, late: 0, leave: 0 },
  );

  // One row per term, so the card says how the child is doing without making
  // anybody open a report to find out.
  const termTotals = can(staff, "marks:view")
    ? await termSummaries(studentId, sessionLabel)
    : [];

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
      <PageHeader eyebrow={m.eyebrowMyClass}
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
                {countOf(summary.present, summary.counted, language)}{" "}
                {primary(m.registerWorkingDays, language)}
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              <Badge tone="success">
                {primary(attendanceLabels.present, language)} {counts.present}
              </Badge>
              {counts.half_day > 0 ? (
                <Badge tone="warning">
                  {primary(attendanceLabels.half_day, language)} {counts.half_day}
                </Badge>
              ) : null}
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

      {seesMoney ? (
        <Section className="mt-7" title={m.studentFees} language={language}>
          {fees ? (!fees.available ? (
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
          )) : null}
          <Link href={`/fees/students/${studentId}`} className={buttonClasses({ variant: "outline", className: "mt-4 w-full" })}>
            {primary(m.nativeStudentFees, language)}<ArrowRight aria-hidden />
          </Link>
        </Section>
      ) : null}

      {/* --------------------------------------------------- the marks */}

      {can(staff, "marks:view") && termTotals.length > 0 ? (
        <Section className="mt-7" title={m.marksTitle} language={language}>
          <ul className="space-y-2">
            {termTotals.map((entry) => (
              <li key={entry.term}>
                <Link
                  href={`/assessments/report/${studentId}?term=${encodeURIComponent(entry.term)}`}
                  className="focus-ring flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-foreground">
                      {entry.term}
                    </span>
                    <span className="block truncate text-[12px] text-subtle-foreground">
                      {entry.totals.scored} / {entry.totals.outOf}
                      {entry.totals.missing > 0
                        ? ` · ${entry.totals.missing} ${primary(m.progressMissing, language)}`
                        : ""}
                    </span>
                  </span>
                  <Badge tone={(entry.totals.percent ?? 0) >= 33 ? "success" : "warning"}>
                    {entry.totals.percent === null ? "—" : `${entry.totals.percent}%`}
                  </Badge>
                  {entry.grade ? <Badge tone="accent">{entry.grade}</Badge> : null}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* ------------------------------------------------- what we hold */}

      {can(staff, "collection:view") && records.length > 0 ? (
        <Section
          className="mt-7"
          title={m.recordsTitle}
          description={m.recordsSourceHint}
          language={language}
        >
          <Card className="p-5">
            <DetailList
              language={language}
              items={records.map((record) => ({
                label: { hi: record.labelHi, en: record.labelEn },
                // **Where the value came from, beside the value.** An approved
                // human correction and an imported figure look identical once
                // they are both just text on a card, and which one it is
                // decides whether somebody rings the parent to check (S-10).
                value: (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span>{record.value ?? "—"}</span>
                    <Badge tone={record.source === "teacher" ? "success" : "neutral"}>
                      {primary(recordSourceLabel(record.source), language)}
                    </Badge>
                  </span>
                ),
              }))}
            />
          </Card>

          {/* How each value came to be what it is, and what was refused on
              the way (P10): the question somebody asks before ringing a
              parent on a number that "was corrected in September". */}
          {changes.length > 0 ? (
            <details className="mt-3" data-record-history>
              <summary className="cursor-pointer text-[13px] font-semibold text-foreground">
                {primary(ms.recordsHistoryTitle, language)} ({changes.length})
              </summary>
              <ul className="mt-2 space-y-2">
                {changes.map((change) => {
                  const note = recordChangeNote(change);
                  return (
                    <li key={change.id} className="rounded-xl bg-surface-2 px-3 py-2 text-[13px]" data-outcome={change.outcome}>
                      <p className="font-medium text-foreground">
                        {language === "en" ? change.labelEn : change.labelHi}
                      </p>
                      <p className="flex flex-wrap items-center gap-1.5">
                        <span className="text-muted-foreground line-through">{change.oldValue ?? "—"}</span>
                        <span aria-hidden className="text-subtle-foreground">→</span>
                        <span className={change.outcome === "blocked" ? "text-muted-foreground" : "font-semibold text-foreground"}>
                          {change.newValue ?? "—"}
                        </span>
                        <Badge tone={change.source === "teacher" ? "success" : "neutral"}>
                          {primary(recordSourceLabel(change.source), language)}
                          {change.sourceDetail ? ` · ${change.sourceDetail}` : ""}
                        </Badge>
                      </p>
                      <p className="text-[12px] text-subtle-foreground">
                        {change.actorName ?? "—"} · {primary(dayLabel(toSchoolDay(new Date(change.recordedAt))), language)}
                        {note ? <> · {primary(note, language)}</> : null}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
        </Section>
      ) : null}

      {can(staff, "collection:view") ? (
        <Section className="mt-7" title={m.navCollection} language={language}>
          <Link href="/collection" className={buttonClasses({ variant: "outline", className: "w-full" })}>
            {primary(m.nativeCollection, language)}<ArrowRight aria-hidden />
          </Link>
        </Section>
      ) : null}

      {/* ---------------------------------------------------- documents */}

      {can(staff, "documents:view") ? (
        <Section className="mt-7" title={m.documentsTitle} language={language}>
          {/* Adding comes first: with a long list, the form used to sit
              below every document, out of sight. */}
          {can(staff, "documents:manage") ? (
            <div className="mb-3">
              <DocumentForm studentId={studentId} mode={uploadMode} />
            </div>
          ) : null}

          {documents.length === 0 ? (
            <EmptyState title={m.documentsNone} language={language} />
          ) : (
            <ul className="space-y-2">
              {documents.map((document) => {
                const KindIcon = document.contentType.startsWith("image/") ? ImageIcon : FileText;
                return (
                  <li
                    key={document.id}
                    className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface px-3 py-2.5"
                  >
                    <KindIcon aria-hidden className="size-6 shrink-0 text-subtle-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-foreground">
                        {primary(documentKindLabels[document.kind], language)}
                      </span>
                      {document.note ? (
                        <span className="block truncate text-[13px] text-foreground">{document.note}</span>
                      ) : null}
                      <span className="block truncate text-[12px] text-subtle-foreground">{document.fileName}</span>
                      <span className="block truncate text-[12px] text-subtle-foreground">
                        {primary(dayLabel(toSchoolDay(new Date(document.createdAt))), language)}
                        {document.uploadedByName ? ` · ${document.uploadedByName}` : ""}
                      </span>
                    </span>

                    {/* Opened through a route that checks the permission
                        again. Never a public path: a birth certificate with
                        a guessable URL is a birth certificate anybody has. */}
                    <Link
                      href={`/documents/${document.id}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={buttonClasses({ variant: "outline", size: "sm" })}
                    >
                      {primary(m.documentsOpen, language)}
                    </Link>

                    {can(staff, "documents:manage") ? (
                      <RemoveDocument documentId={document.id} studentId={studentId} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
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
