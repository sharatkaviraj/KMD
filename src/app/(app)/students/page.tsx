import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { searchStudents } from "@/modules/students/data/directory-repo";
import { normaliseQuery, pageWindow, PAGE_SIZE, resolvePage } from "@/modules/students/domain/directory";
import { studentMoneyList } from "@/modules/students-fees/vx/admin-students";
import { listMoney, parseSegment } from "@/vx/screens/admin/logic";
import { StudentsScreen, type StudentListRow, type StudentsProps } from "@/vx/screens/admin/students";
import { T } from "@/vx/screens/admin/text";
import { lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";

export const runtime = "nodejs";

export const metadata = { title: "Students" };

/**
 * Students (P5, design F05/D01).
 *
 * Still a GET form with every filter in the URL, as the directory was: Back,
 * bookmarks and a pasted link all open the same list. With `fees:view` the
 * list is the fee app's own student query — the chips are its saved views and
 * the money columns its figures, fees and late fee apart. Without it the list
 * is this app's directory from the session's enrolments, and no money is read
 * at all.
 */
export default async function StudentsPage(props: PageProps<"/students">) {
  const staff = await requirePermission("students:view", "/students");
  const language = staff.language;
  const params = await props.searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const q = normaliseQuery(one(params.q) ?? "");
  const classId = one(params.class) || null;
  const page = resolvePage(one(params.page));
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
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
  const seg = seesMoney ? parseSegment(one(params.seg)) : "all";
  // Started now, awaited last: the class names are only needed for the
  // filter and the no-money list, and must not hold up the money read.
  const labelsPromise = classLabelMap(sessionLabel);

  let rows: StudentListRow[] = [];
  let total = 0;
  let counts: StudentsProps["counts"] = null;
  let failed = false;
  let moneyMode = false;
  let session = sessionLabel;

  if (seesMoney) {
    try {
      const list = await studentMoneyList({ query: q, classId: classId ?? "", segment: seg, page, pageSize: PAGE_SIZE });
      rows = list.rows.map((row) => ({
        id: row.id,
        name: row.fullName,
        sr: row.admissionNo || null,
        classLabel: row.classLabel,
        rollNo: null,
        route: row.routeLabel && row.routeLabel !== "No Transport" ? row.routeLabel : null,
        parent: row.parentName,
        phone: row.phone,
        money: listMoney(row),
      }));
      total = list.total;
      counts = list.counts;
      session = list.sessionLabel;
      moneyMode = true;
    } catch {
      failed = true;
    }
  }

  const labels = await labelsPromise;

  if (!moneyMode) {
    const results = await searchStudents({ text: q, classId, page }, sessionLabel);
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
    }));
    total = results.total;
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
        classId={classId}
        seg={seg}
        classes={[...labels.entries()].map(([id, label]) => ({ id, label }))}
        counts={counts}
        seesMoney={moneyMode}
        canCollect={can(staff, "fees:collect")}
        canAdmit={staff.role === "admin"}
        canRemind={seesMoney}
        failed={failed}
      />
    </VxPage>
  );
}
