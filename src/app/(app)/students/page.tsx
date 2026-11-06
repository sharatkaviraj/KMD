import { approvedStudentPhotos } from "@/modules/collection/data/approved-photos";
import { cookies } from "next/headers";

import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { searchStudents } from "@/modules/students/data/directory-repo";
import { normaliseQuery, pageWindow, PAGE_SIZE, resolvePage } from "@/modules/students/domain/directory";
import { parentNamesFor, studentMoneyList } from "@/modules/students-fees/vx/admin-students";
import { quickActionsFor } from "@/vx/nav";
import { listMoney, parseSegment, parseStudentFilters, quickSegment } from "@/vx/screens/admin/logic";
import { StudentsScreen, type StudentListRow, type StudentsProps } from "@/vx/screens/admin/students";
import { attendanceForStudents } from "@/vx/screens/admin/students-data";
import {
  classFromQuery,
  parseStudentSort,
  readStudentLayoutCookie,
  readStudentViewCookie,
  resolveStudentLayout,
  resolveStudentView,
  STUDENT_LAYOUT_COOKIE,
  STUDENT_VIEW_COOKIE,
  type AttendanceFacts,
  type StudentFacts,
} from "@/vx/screens/admin/students-logic";
import { T } from "@/vx/screens/admin/text";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";
import { assignmentContext } from "@/modules/teacher-tasks/data/assignment";
import { listFieldsPublic } from "@/modules/collection/data/fields-repo";
import { keptDirectoryPage } from "@/modules/teacher-tasks/data/missing-directory";
import { hasDevanagari, matchesHindiName } from "@/modules/students/domain/hindi-name-search";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";

export const runtime = "nodejs";

export const metadata = { title: "Students" };

/** A row's facts before anything is known about it: no badge, attendance filled in later. */
const noFacts = (): StudentFacts => ({ attendance: null, siblings: 0, isNew: false, route: null, yearClear: false, emi: null, concessions: [] });

/**
 * Students (P5, design F05/D01).
 *
 * Still a GET form with every filter in the URL, as the directory was: Back,
 * bookmarks and a pasted link all open the same list. Two views over the same
 * children: Fees, for `fees:view` and where such a reader starts — the
 * design's list (D01/F05): the fee app's saved views as chips and its figures,
 * fees and late fee apart (UI-89) — and School (class, attendance, a few
 * facts), everyone else's list. The last view a person chose is remembered in
 * a cookie keyed to their profile, so the first render is already right. A
 * search that is exactly a class's name filters to that class.
 *
 * With `fees:view` the list is the fee app's own student query in the
 * view-session every money screen uses, and the class filter and attendance
 * are read for that same session, so the three never name different years.
 * Without it the list is this app's directory from the session's enrolments,
 * and no money is read at all.
 */
export default async function StudentsPage(props: PageProps<"/students">) {
  const staff = await requirePermission("students:view", "/students");
  const language = staff.language;
  const params = await props.searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const q = normaliseQuery(one(params.q) ?? "");
  const classParam = one(params.class) || null;
  const page = resolvePage(one(params.page));
  const sort = parseStudentSort(one(params.sort), one(params.dir));
  const canAssignTasks = can(staff,"collection:manage");
  // Only a named missing-field filter needs this metadata before the list.
  // Capture errors immediately, then preserve the existing failure when read.
  const taskFieldsRead = (canAssignTasks ? listFieldsPublic() : Promise.resolve([]))
    .then(fields => ({ fields: fields.filter(f => f.isActive) }), error => ({ error }));
  const readTaskFields = async () => {
    const result = await taskFieldsRead;
    if ("error" in result) throw result.error;
    return result.fields;
  };
  const [directorySession, jar] = await Promise.all([resolveSessionLabel(), cookies()]);
  const askedMissing = one(params.missing) ?? "";
  const missing = canAssignTasks && (askedMissing === "photo" || (askedMissing && (await readTaskFields()).some(f=>f.key===askedMissing))) ? askedMissing : "";

  if (!directorySession) {
    return (
      <VxPage>
        <TopBar title={lead(T.students, language)} />
        <main>
          <Section>
            <EmptyState icon="calendar" title={lead(T.noSession, language)} />
          </Section>
        </main>
      </VxPage>
    );
  }

  const seesMoney = can(staff, "fees:view");
  const canonicalDirectory = usesCanonicalFees(staff, directorySession);
  const requestedStatus=one(params.status);
  const enrollment=(["active","inactive","left","graduated","all"] as const).find(value=>value===requestedStatus)??"active";
  const remembered = readStudentViewCookie(jar.get(STUDENT_VIEW_COOKIE)?.value, staff.id);
  // `?seg=` is one quick chip in an old link, or any fee filters from the phone's sheet (UI-94).
  const asked = parseStudentFilters(one(params.seg));
  const view = resolveStudentView({ param: one(params.view), seg: parseSegment(one(params.seg)), filters: asked, remembered, seesMoney });
  const readsMoney = seesMoney && view === "fees";
  const filters = view === "fees" ? asked : [];
  const seg = quickSegment(filters);
  const layout = resolveStudentLayout(one(params.look), readStudentLayoutCookie(jar.get(STUDENT_LAYOUT_COOKIE)?.value, staff.id));

  // One session for the money list, its class filter and the attendance
  // beside it: the view-session, as on every other money screen.
  const moneySession = readsMoney
    ? canonicalDirectory ? directorySession : await getViewSessionCookie()
        .then((cookieSession) => resolveViewSession({ cookieSession }))
        .then((resolved) => resolved.sessionLabel)
        .catch(() => null)
    : null;

  let rows: StudentListRow[] = [];
  let total = 0;
  let counts: StudentsProps["counts"] = null;
  let failed = readsMoney && !moneySession;
  let moneyMode = false;
  let session = directorySession;

  // Started now, awaited last unless the search names a class: the class names
  // (cached across requests) must not hold up the list read.
  const labelsRead = classLabelMap(moneySession ?? directorySession).catch((): Map<string, string> | null => null);

  // The search box finds a class too (the design's "Name, SR no., class or
  // parent"): a query that is exactly one class's name filters to that class.
  const typedClass =
    !classParam && q ? classFromQuery(q, [...((await labelsRead) ?? new Map<string, string>()).entries()].map(([id, label]) => ({ id, label }))) : null;
  const classId = classParam ?? typedClass?.id ?? null;
  const typed = typedClass ? "" : q;
  // Names are stored in Latin letters, so a name typed in Hindi is matched
  // here, by sound, over the whole list rather than in the database (A-10).
  const hindiQuery = hasDevanagari(typed) ? typed : null;
  const text = hindiQuery ? "" : typed;
  const keepRow = (id: string, names: (string | null | undefined)[]) =>
    (!missingIds || missingIds.has(id)) && (!hindiQuery || matchesHindiName(hindiQuery, names));
  const missingIds = missing
    ? new Set((await assignmentContext()).students.filter(s => missing === "photo" ? !s.hasPhoto : !s.values[missing]).map(s => s.id))
    : null;
  let taskMatchingIds: string[] | null = null;

  if (moneySession) {
    try {
      // Grouped by class, the list is read in class order so a class's children sit together across pages.
      const byClass = sort.key === "class" || layout === "class";
      const read = (page: number) => studentMoneyList({ query: text, classId: classId ?? "", filters, page, pageSize: PAGE_SIZE, sessionLabel: moneySession, sort: byClass ? "class" : "name",...(canonicalDirectory?{status:enrollment}:{}) });
      const filtered = missingIds || hindiQuery ? await keptDirectoryPage(read, row => keepRow(row.id, [row.fullName, row.parentName]), row => row.id, page) : null;
      const list = filtered ?? await read(page);
      taskMatchingIds = filtered?.matchingIds ?? null;
      rows = list.rows.map((row) => {
        const route = row.routeLabel && row.routeLabel !== "No Transport" ? row.routeLabel : null;
        return {
          id: row.id,
          name: row.fullName,
          sr: row.admissionNo || null,
          photoUrl: row.photoUrl,
          classLabel: row.classLabel,
          rollNo: null,
          route,
          parent: row.parentName,
          phone: row.phone,
          money: listMoney(row),
          facts: { ...noFacts(), siblings: row.siblingCount, isNew: row.isNew, route, yearClear: row.yearClear, emi: row.emi, concessions: row.concessions },
        };
      });
      total = list.total;
      // On the All list the chip counts what the list holds, so "All 510" never sits over "1–50 of 538" (school-day run B11).
      counts = filters.length === 0 ? { ...list.counts, all: hindiQuery ? list.total : (filtered?.sourceTotal ?? list.total) } : list.counts;
      session = list.sessionLabel;
      moneyMode = true;
    } catch (error) {
      // A failed fee query must not broaden a reviewed missing-field selection.
      if (missingIds) throw error;
      failed = true;
    }
  }

  let directoryLabels: Map<string, string> | null = null;
  if (!moneyMode) {
    if (missingIds && readsMoney && !moneySession) throw new Error("directory_unavailable");
    const read = (page: number) => searchStudents({ text, classId, page }, directorySession);
    const filtered = missingIds || hindiQuery ? await keptDirectoryPage(read, row => keepRow(row.studentId, [row.fullName, row.fatherName]), row => row.studentId, page) : null;
    const [labels, results] = await Promise.all([
      moneySession ? classLabelMap(directorySession) : labelsRead.then((l) => l ?? classLabelMap(directorySession)),
      filtered ?? read(page),
    ]);
    taskMatchingIds = filtered?.matchingIds ?? null;
    directoryLabels = labels;
    rows = results.rows.map((row) => ({
      id: row.studentId,
      name: row.fullName,
      sr: row.admissionNo,
      classLabel: row.classId ? (labels.get(row.classId) ?? "—") : "—",
      rollNo: row.rollNo,
      route: null,
      parent: row.fatherName,
      phone: row.guardianPhone,
      money: null,
      facts: noFacts(),
    }));
    total = results.total;
    session = directorySession;
  }

  const ids = rows.map((row) => row.id);
  const [labels, attendance, parents, portraits, taskFields] = await Promise.all([
    (async () => directoryLabels ?? (moneyMode ? await labelsRead : null) ?? (await classLabelMap(session)))(),
    attendanceForStudents(ids, session).catch((): Map<string, AttendanceFacts> | null => null),
    // The fee list carries no parent name; the design shows it under each child.
    moneyMode && !canonicalDirectory && ids.length ? parentNamesFor(ids).catch((): Map<string, string> | null => null) : Promise.resolve(null),
    !canonicalDirectory || !moneyMode ? approvedStudentPhotos(ids).catch(() => new Map<string,string>()) : Promise.resolve(null),
    readTaskFields(),
  ]);
  const classOrder = new Map([...labels.values()].map((label, i) => [label, i]));
  for (const row of rows) {
    if (attendance) row.facts.attendance = attendance.get(row.id) ?? null;
    if (parents && !row.parent) row.parent = parents.get(row.id) ?? null;
    row.classOrder = classOrder.get(row.classLabel);
  }

  if (portraits) {
    for (const row of rows) row.photoUrl = portraits.get(row.id) ?? null;
  }
  const window = pageWindow(page, total);

  return (
    <VxPage label={lead(T.students, language)}>
      <StudentsScreen
        session={session}
        rows={rows}
        total={total}
        window={{ page: window.page, pages: window.pages, firstRow: window.firstRow, lastRow: window.lastRow }}
        q={q}
        classId={classParam}
        classLabel={classParam ? (labels.get(classParam) ?? null) : null}
        view={moneyMode ? view : "school"}
        seg={moneyMode ? seg : "all"}
        filters={moneyMode ? filters : []}
        layout={layout}
        sort={sort}
        classes={[...labels.entries()].map(([id, label]) => ({ id, label }))}
        counts={counts}
        seesMoney={moneyMode}
        attendanceRead={attendance !== null}
        viewKey={staff.id}
        canCollect={can(staff, "fees:collect")}
        canAdmit={staff.role === "admin"}
        canRemind={readsMoney && !canonicalDirectory}
        enrollment={canonicalDirectory&&moneyMode?enrollment:undefined}
        sourceData={canonicalDirectory&&moneyMode}
        quick={quickActionsFor((p) => can(staff, p))}
        failed={failed}
        taskAssignment={canAssignTasks?{matchingIds:taskMatchingIds??ids,missing,fields:taskFields.map(f=>({key:f.key,hi:f.labelHi,en:f.labelEn}))}:undefined}
      />
    </VxPage>
  );
}
