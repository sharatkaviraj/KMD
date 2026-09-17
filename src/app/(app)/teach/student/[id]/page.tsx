import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { countOf, primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { appsFor, schoolApp, studentLinkLabel } from "@/platform/config/apps";
import { getVppsOneEnvironment } from "@/platform/env";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { studentAttendance } from "@/modules/attendance/data/attendance-repo";
import { ownClassIds } from "@/modules/attendance/data/teaching-repo";
import { externalIdFor } from "@/modules/students/data/external-ids-repo";
import {
  attendanceLabels,
  attendancePercent,
  type AttendanceStatus,
} from "@/modules/attendance/domain/attendance";
import { deleteDocumentAction } from "@/app/(app)/collection/actions";
import { termSummaries } from "@/modules/assessments/data/reports-repo";
import {
  documentsForStudent,
  recordsForStudent,
} from "@/modules/collection/data/documents-repo";
import {
  documentKindLabels,
  humanSize,
  recordSourceLabel,
} from "@/modules/collection/domain/review";
import { DocumentForm } from "@/modules/collection/ui/office-forms";
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

  const [enrolment, history, labels, own, kinds, fees, records, documents] =
    await Promise.all([
      enrolmentForStudent(studentId, sessionLabel),
      studentAttendance(studentId, sessionLabel),
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
    ]);

  // The registry decides whether an id may travel to the fee app at all.
  // Today it may not - this app is on dev data and the fee app is live - so
  // this comes back as a search link and the button says so (D-122).
  const feeLink = schoolApp("schoolfees").student(
    { studentId, search: student.admissionNo ?? student.fullName },
    getVppsOneEnvironment(),
  );

  // SamPark keeps its own text ids, so this one needs a mapping row as well as
  // matching datasets (S-10). Nothing writes the mapping table yet, so today
  // this is always null and the link is a search — asked for anyway, because
  // the day a mapping lands the card should already know what to do with it.
  const seesSampark = appsFor(staff.role).some((app) => app.id === "sampark");
  const samparkLink = seesSampark
    ? schoolApp("sampark").student(
        {
          studentId,
          search: student.admissionNo ?? student.fullName,
          externalId: await externalIdFor("sampark", studentId),
        },
        getVppsOneEnvironment(),
      )
    : null;

  const statuses = history.map((entry) => entry.status);
  const summary = attendancePercent(statuses);

  const counts = statuses.reduce<Record<AttendanceStatus, number>>(
    (totals, status) => {
      totals[status] += 1;
      return totals;
    },
    { present: 0, absent: 0, late: 0, leave: 0 },
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
                {countOf(summary.present, summary.counted, language)}{" "}
                {primary(m.registerWorkingDays, language)}
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
        </Section>
      ) : null}

      {/* ------------------------------------------ the fee app, for this child */}

      {seesMoney ? (
        <Section className="mt-7" title={m.appSchoolFees} language={language}>
          <Card className="p-4">
            {/* **Search, not a deep link, while the datasets differ.** This app
                is on schoolfees-dev and the fee app is on live records, so an
                id from here means nothing there — the registry falls back and
                the button says which it is doing (D-122). */}
            <p className="text-[14px] leading-6 text-muted-foreground">
              {primary(
                feeLink.kind === "detail" ? m.appOpenThisChild : m.appSearchInstead,
                language,
              )}
            </p>
            <a
              href={feeLink.href}
              className={buttonClasses({ variant: "outline", className: "mt-3 w-full" })}
            >
              {primary(studentLinkLabel(feeLink.kind), language)}
              <ExternalLink aria-hidden />
            </a>
            <p className="mt-2 text-center font-mono text-[12px] text-subtle-foreground">
              {new URL(feeLink.href).host}
            </p>
          </Card>
        </Section>
      ) : null}

      {/* --------------------------------------------- SamPark, for this child */}

      {samparkLink ? (
        <Section className="mt-7" title={m.appSampark} language={language}>
          <Card className="p-4">
            {/* **A different app's ids, not a different environment.** SamPark
                keys its students on its own text id, so this is a search until
                somebody loads the mapping — and then a deep link, with no
                change here (S-10). */}
            <p className="text-[14px] leading-6 text-muted-foreground">
              {primary(
                samparkLink.kind === "detail" ? m.appOpenThisChild : m.appSearchInstead,
                language,
              )}
            </p>
            <a
              href={samparkLink.href}
              className={buttonClasses({ variant: "outline", className: "mt-3 w-full" })}
            >
              {primary(studentLinkLabel(samparkLink.kind), language)}
              <ExternalLink aria-hidden />
            </a>
            <p className="mt-2 text-center font-mono text-[12px] text-subtle-foreground">
              {new URL(samparkLink.href).host}
            </p>
          </Card>
        </Section>
      ) : null}

      {/* ---------------------------------------------------- documents */}

      {can(staff, "documents:view") ? (
        <Section className="mt-7" title={m.documentsTitle} language={language}>
          {documents.length === 0 ? (
            <EmptyState title={m.documentsNone} language={language} />
          ) : (
            <ul className="space-y-2">
              {documents.map((document) => (
                <li
                  key={document.id}
                  className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-foreground">
                      {primary(documentKindLabels[document.kind], language)}
                    </span>
                    <span className="block truncate text-[12px] text-subtle-foreground">
                      {document.fileName} · {humanSize(document.byteSize)}
                      {document.uploadedByName ? ` · ${document.uploadedByName}` : ""}
                    </span>
                  </span>

                  {/* A short-lived signed URL, minted by a route that checks
                      the permission again. Never a public path: a birth
                      certificate with a guessable URL is a birth certificate
                      anybody has. */}
                  <Link
                    href={`/documents/${document.id}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={buttonClasses({ variant: "outline", size: "sm" })}
                  >
                    {primary(m.documentsOpen, language)}
                  </Link>

                  {can(staff, "documents:manage") ? (
                    <form action={deleteDocumentAction}>
                      <input type="hidden" name="id" value={document.id} />
                      <input type="hidden" name="studentId" value={studentId} />
                      <button
                        type="submit"
                        className="focus-ring rounded-lg px-2 py-1 text-[13px] font-medium text-destructive-soft-foreground hover:bg-destructive-soft"
                      >
                        {primary(m.documentsRemove, language)}
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {can(staff, "documents:manage") ? (
            <Card className="mt-3 p-4">
              <DocumentForm studentId={studentId} />
            </Card>
          ) : null}
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
