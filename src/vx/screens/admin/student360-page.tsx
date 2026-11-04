import "server-only";

import { requirePermission } from "@/platform/auth/current-staff";
import { getViewer } from "@/vx/view-as";
import { can } from "@/platform/auth/permissions";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { documentKindLabels, humanSize } from "@/modules/collection/domain/review";
import { documentUploadMode } from "@/modules/collection/data/storage-settings";
import { approvedStudentPhotos } from "@/modules/collection/data/approved-photos";
import { studentFees } from "@/modules/students-fees/vx/admin-students";
import { schoolToday } from "@/vx/format";
import {
  installmentState,
  moneyFromInstallments,
  monthGrid,
  parseTab,
  recentWeeks,
  tabsFor,
  type MarkStatus,
} from "@/vx/screens/admin/logic";
import { loadStudentSchool } from "@/vx/screens/admin/data";
import { canWriteNotes, notesForStudentTab } from "@/vx/screens/admin/notes-tab";
import { familyContactAccess, familyContacts } from "@/vx/screens/family-contact/data";
import { Student360, Student360Missing, type Student360Fees } from "@/vx/screens/admin/student360";
import { studentReturnHref } from "@/vx/screens/admin/students-logic";
import { T } from "@/vx/screens/admin/text";
import { lead } from "@/vx/text";
import { assertStudentVisible, notFoundUnlessVisible } from "@/platform/auth/test-session-access";
import { usesCanonicalFees, FEES_ORIGIN } from "@/platform/fees-bridge/policy";
import { getBridgeStudentView } from "@/platform/fees-bridge/client";
import { bridgeStudentPhotoHref } from "@/platform/fees-bridge/student-photo";
import { feesFromBridge } from "@/modules/students-fees/vx/canonical-students";
import { shownTransportLabel } from "@/modules/fees/domain/transport-route-key";
import { resolvePage } from "@/modules/students/domain/directory";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Student 360 (P5, design F06–F08/D02). Overview, attendance, marks,
 * documents, notes, history and info from this app's own records; fees and
 * family from the fee app's, and only for `fees:view`.
 *
 * One reader for both doors: the page at `/students/[id]` and the drawer the
 * Students list opens over itself (`students/@drawer/(.)[id]`). Both draw the
 * same layer; only what sits behind it differs.
 */
export async function Student360Content({ id, search }: { id: string; search: Record<string, string | string[] | undefined> }) {
  const staff = await requirePermission("students:view", "/students");
  const { previewing } = await getViewer();
  const language = staff.language;
  const returnTo = studentReturnHref(typeof search.returnTo === "string" ? search.returnTo : null);
  const sessionLabel = await resolveSessionLabel();
  // A child in a session this viewer cannot open reads as not found (Phase 3).
  if (UUID.test(id)) await notFoundUnlessVisible(() => assertStudentVisible(staff, id));

  const valid = UUID.test(id) && Boolean(sessionLabel);
  const seesMoney = can(staff, "fees:view");
  const canonical=valid&&usesCanonicalFees(staff,sessionLabel);
  const page=(key:string)=>resolvePage(typeof search[key]==="string"?search[key]:undefined);
  // Fees' single-purpose reads in parallel (review P02), only the sections this reader may see.
  const sourcePromise=canonical&&sessionLabel?getBridgeStudentView(id,sessionLabel,{receiptsPage:page("receiptsPage"),ledgerPage:page("ledgerPage"),financePage:page("financePage"),contactsPage:page("contactsPage"),attemptsPage:page("attemptsPage"),remindersPage:page("remindersPage"),noticesPage:page("noticesPage"),documentsPage:page("documentsPage")}).catch(()=>"unavailable" as const):Promise.resolve(null);

  // Everything this card shows is independent of everything else, so it all
  // starts at once: the fee side (the fee app's own reads) and the notes no
  // longer wait for the school side to finish first. On a phone that was the
  // difference between one round of queries and three in a row.
  const feesPromise = canonical ? sourcePromise.then(source=>source==="unavailable"?source:source&&seesMoney?feesFromBridge(source):null)
    : valid && seesMoney ? studentFees(id).catch(() => "unavailable" as const) : Promise.resolve(null);
  const unavailable: string[] = [];
  const notesPromise = valid && sessionLabel ? notesForStudentTab(staff, id, sessionLabel).catch(() => { unavailable.push("notes"); return []; }) : Promise.resolve([]);
  // The portrait reader enforces its own current permission/class scope. It
  // can run beside the school model once the session visibility fence passed.
  const photoPromise = valid ? approvedStudentPhotos([id]).then(photos => photos.get(id) ?? null).catch(() => null) : Promise.resolve(null);
  const school = valid && sessionLabel ? await loadStudentSchool(staff, id, sessionLabel) : null;
  if (!school || !sessionLabel) {
    return <Student360Missing returnTo={returnTo} title={lead(sessionLabel ? T.notFound : T.noSession, language)} action={lead(T.backToStudents, language)} />;
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

  // Family contact (D-265): the class teacher and the school-wide readers
  // see and record it; nobody else is shown the strip at all.
  const [notes, contactAccess, photoUrl, uploadMode] = await Promise.all([
    notesPromise,
    familyContactAccess(staff, sessionLabel, school.classId).catch(() => { unavailable.push("contacts"); return false; }),
    photoPromise,
    can(staff, "documents:manage") && !previewing ? documentUploadMode(staff.id).catch(() => "unavailable" as const) : Promise.resolve("unavailable" as const),
  ]);
  const contacts = contactAccess ? await familyContacts(id, sessionLabel).catch(() => { unavailable.push("contacts"); return null; }) : null;

  // Not awaited: the card goes out with the school side, and the fee side
  // streams into it when the fee app's reads finish (Student360's Suspense).
  const feesView: Promise<Student360Fees | null> | undefined = seesMoney||canonical
    ? Promise.all([feesPromise,sourcePromise]).then(([fees,source]): Student360Fees | null => {
        const profile:Student360Fees=source&&source!=="unavailable"?{
          source,name:source.student.fullName,classLabel:source.student.classLabel,sr:source.student.admissionNo,rollNo:source.student.rollNo,
          father:source.student.fatherName,mother:source.student.motherName,phone:source.student.guardianPhone||source.student.fatherPhone||source.student.motherPhone,
          fatherPhone:source.student.fatherPhone,motherPhone:source.student.motherPhone,
          // The ring keeps the thumbnail the first paint already shows (the same address, so no second
          // download when the fees land, review P01); the photo viewer asks for the full image itself.
          photoUrl:source.student.hasPhoto?bridgeStudentPhotoHref(id,source.sessionLabel):null,
          status:source.student.status,address:source.student.address,dob:source.student.dateOfBirth,joined:source.student.joinedOn,route:shownTransportLabel(source.student.transportRouteLabel),
        }:{};
        return fees === "unavailable" ? { ...profile,unavailable: true } : fees
          ? {
              ...profile,
              status: fees.status ?? school.card.status,
              address: fees.address,
              dob: fees.dateOfBirth,
              joined: fees.joinedOn,
              route: fees.routeLabel,
              money: moneyFromInstallments(fees.installments, source&&source!=="unavailable"?source.asOfDate:today),
              installments: fees.installments.map((row) => ({
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
              })),
              feeSummary: fees.summary,
              feeBreakup: fees.breakup,
              feeSession: fees.sessionLabel,
              receipts: fees.receipts,
              family: fees.family.map((m) => ({ id: m.id, name: m.fullName, sr: m.admissionNo, classLabel: m.classLabel, self: m.isSelf, total: m.totalDue, paid: m.totalPaid, remaining: m.outstanding })),
              familyGroupId: fees.familyGroupId,
            }
          : source&&source!=="unavailable"?profile:null;
      })
    : undefined;

  const closed = new Set(school.closedDays);
  const counts: Record<MarkStatus, number> = { present: 0, absent: 0, half_day: 0, late: 0, leave: 0 };
  for (const row of school.attendance) counts[row.status] += 1;

  return (
    <>
      {/* Keyed by child: the tab is client state now, and a sibling opened
          from the family tab must start on its own overview. */}
      <Student360
        key={`${staff.id}:${sessionLabel}:${id}`}
        p={{
          id,
          sourceExpected:canonical,
          returnTo,
          name: school.card.fullName,
          photoUrl,
          canEditPhoto: !canonical && !previewing && (((staff.role === "admin" || staff.role === "office") && can(staff,"collection:manage")) || (staff.role === "teacher" && contactAccess)),
          sourcePhotoEditHref:canonical&&!previewing&&can(staff,"fees:manage")?`${FEES_ORIGIN}/protected/students/${id}/edit?${new URLSearchParams({session:sessionLabel})}`:undefined,
          unavailable: [...(school.unavailable ?? []), ...unavailable],
          classLabel: school.classLabel,
          sr: school.card.admissionNo,
          rollNo: school.rollNo,
          status: school.card.status,
          father: school.card.fatherName,
          mother: school.card.motherName,
          phone: school.card.guardianPhone ?? school.card.primaryPhone,
          address: null,
          dob: null,
          joined: null,
          route: null,
          tab,
          tabs,
          money: null,
          installments: null,
          feeSummary: null,
          feeBreakup: null,
          feeSession: null,
          receipts: null,
          family: null,
          attendance: {
            percent: school.attendancePercent,
            counted: school.attendanceCounted,
            counts,
            weeks: recentWeeks(school.attendance, today, 4, (day) => closed.has(day)),
            month: monthGrid(school.attendance, today, (day) => closed.has(day), school.halfDayCredit),
          },
          terms: school.terms.map((t) => ({
            term: t.term,
            percent: t.totals.percent,
            grade: t.grade,
            missing: t.totals.missing,
            // Every paper but the excused ones: what "provisional" is out of.
            papers: t.totals.counted + t.totals.absent + t.totals.missing,
            scored: t.totals.scored,
            outOf: t.totals.outOf,
            subjects: t.subjects,
          })),
          documents: school.documents.map((d) => ({
            id: d.id,
            kind: lead(documentKindLabels[d.kind], language),
            fileName: d.fileName,
            size: humanSize(d.byteSize),
            createdAt: d.createdAt,
            by: d.uploadedByName,
          })),
          notes: notes.map((n) => ({
            id: n.id,
            body: n.body,
            tags: n.tags,
            status: n.status,
            needsFollowUp: n.needsFollowUp,
            followUpOn: n.followUpOn,
            followUpOwner: n.followUpOwner,
            followUpName: n.followUpName,
            by: n.writtenByName,
            createdAt: n.createdAt,
            canWork: n.canWork,
          })),
          today,
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
          canAssignTasks: can(staff, "collection:manage") && !previewing,
          canManageDocuments: can(staff, "documents:manage") && !previewing,
          documentUploadMode: uploadMode,
          schoolOffice: can(staff, "certificates:view") && sessionLabel ? { sessionLabel, canIssue: can(staff, "certificates:issue") && !previewing, editHref: can(staff, "fees:manage") ? `/admissions/${id}` : undefined } : undefined,
          officialResultsHref: can(staff, "outcomes:view") ? `/exam-office/official-results?student=${id}` : undefined,
          canManageFees: can(staff, "fees:manage"),
          canAddNote: tabs.includes("notes") && canWriteNotes(staff),
          contacts,
          contactRecoveryScope: { owner: staff.id, sessionLabel, previewing: !!previewing },
        }}
        fees={feesView}
      />
    </>
  );
}
