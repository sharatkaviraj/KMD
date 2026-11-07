import type { DesignView } from "../design.fixture";
import { views as adminViews } from "./admin.fixture";
import { menuGroups } from "@/app/(app)/menu/menu-items";
import { MenuScreen } from "@/app/(app)/menu/menu-screen";
import { bottomFor, groupsFor, PREVIEW_LABEL } from "@/vx/nav";
import { StudentsScreen, type StudentListRow, type StudentsProps } from "@/vx/screens/admin/students";
import type { StudentFacts } from "@/vx/screens/admin/students-logic";
import { QuickActions } from "@/vx/shell/bottom-bar";
import { SearchPalette, type PaletteItem } from "@/vx/shell/palette";
import type { SearchResult } from "@/vx/shell/search-actions";
import { VxPage } from "@/vx/ui/page";

/*
 * The admin core's list, search, menu and quick-action frames (App.dc.html
 * F03/F04/F05/F13, Desktop.dc.html D01/D07), drawn with the design's own
 * sample records. Every name, number and amount below is the design's
 * synthetic data, not a real child or parent.
 */

const facts = (over: Partial<StudentFacts> = {}): StudentFacts => ({
  attendance: null,
  siblings: 0,
  isNew: false,
  route: null,
  yearClear: false,
  emi: null,
  concessions: [],
  ...over,
});

/** name, SR, father, class, route, pending today, not due yet, year paid %, new this year */
const SAMPLE: [string, string, string, string, string | null, number, number, number, boolean][] = [
  ["Aarav Sharma", "1234", "Rakesh Sharma", "Class 7", "Route 3", 4200, 13200, 34, false],
  ["Aarti Kumawat", "0981", "Mahesh Kumawat", "Class 10", null, 0, 0, 100, false],
  ["Aarush Jain", "1402", "Nitin Jain", "UKG", null, 0, 9300, 50, true],
  ["Diya Sharma", "1311", "Rakesh Sharma", "Class 3", "Route 3", 4200, 10800, 31, false],
  ["Ishita Rathore", "0874", "Vikram Rathore", "Class 12 Science", null, 0, 19200, 50, false],
  ["Kunal Verma", "1187", "Sanjay Verma", "Class 4", "Route 1", 0, 0, 100, false],
  ["Mohit Agarwal", "1022", "Anil Agarwal", "Class 9", "Route 2", 6900, 13800, 25, false],
  ["Neha Joshi", "1099", "Prakash Joshi", "Class 8", null, 0, 0, 100, false],
  ["Pooja Mehta", "0933", "Dinesh Mehta", "Class 11 Commerce", null, 0, 17400, 50, false],
  ["Riya Singh", "1250", "Mahendra Singh", "Class 6", "Route 1", 6150, 12300, 25, false],
  ["Rohit Joshi", "1376", "Prakash Joshi", "Class 5", "Route 2", 11700, 11700, 0, false],
  ["Tanvi Paliwal", "1420", "Gopal Paliwal", "LKG", null, 0, 8700, 50, true],
];

export const sampleStudents: StudentListRow[] = SAMPLE.map(([name, sr, father, classLabel, route, pendingToday, notDueYet, percent, isNew], i) => ({
  id: `00000000-0000-4000-8000-0000000b${String(i + 1).padStart(4, "0")}`,
  name,
  sr,
  classLabel,
  rollNo: null,
  route,
  parent: father,
  phone: `98290${String(41120 + i * 7).padStart(5, "0")}`,
  money: { pendingToday, notDueYet, lateFee: 0, percent },
  facts: facts({ isNew, route, yearClear: percent >= 100 }),
}));

const studentsProps = (over: Partial<StudentsProps> = {}): StudentsProps => ({
  session: "2026–27",
  rows: sampleStudents,
  total: sampleStudents.length,
  window: { page: 1, pages: 1, firstRow: 1, lastRow: sampleStudents.length },
  q: "",
  classId: null,
  view: "fees",
  seg: "all",
  classes: [],
  counts: { all: 12, pending: 5, bus: 6, new: 2, paid: 3 },
  seesMoney: true,
  attendanceRead: true,
  viewKey: "fixture",
  canCollect: true,
  canAdmit: true,
  canRemind: true,
  quick: ["collect", "mark", "notice", "admit", "cover", "note"],
  failed: false,
  ...over,
});

function StudentsFrame({ picked }: { picked?: string[] }) {
  return (
    <VxPage>
      <StudentsScreen {...studentsProps()} initialPicked={picked} />
    </VxPage>
  );
}

const PICKED = ["Mohit Agarwal", "Riya Singh", "Rohit Joshi"].map((n) => sampleStudents.find((s) => s.name === n)!.id);

/* ----------------------------------------------------------------- search */

const pages: PaletteItem[] = groupsFor("admin", () => true).flatMap((g) => g.items.map((i) => ({ label: i.label, icon: i.icon, href: i.href, group: g.title?.en ?? "" })));
const id = (name: string) => sampleStudents.find((s) => s.name === name)!.id;

/**
 * What `searchEverythingAction` answers for "aar" to the admin: the design's
 * three children with their money words, Collect and Call for the first, and
 * that child's two latest receipts (listed on a phone, F04; a desk lists
 * receipts by number only, D07). Receipt numbers only when a digit is typed.
 */
async function sampleSearch(q: string): Promise<SearchResult> {
  const t = q.trim().toLowerCase();
  const kids = [
    { name: "Aarav Sharma", classLabel: "Class 7", sr: "1234", parent: "Rakesh Sharma", money: { kind: "pending" as const, amount: 4200 } },
    { name: "Aarti Kumawat", classLabel: "Class 10", sr: "0981", parent: "Mahesh Kumawat", money: { kind: "paid" as const } },
    { name: "Aarush Jain", classLabel: "UKG", sr: "1402", parent: "Nitin Jain", money: { kind: "track" as const, amount: 9300 } },
  ].filter((k) => k.name.toLowerCase().includes(t));
  const students = kids.map((k) => ({ ...k, id: id(k.name), href: `/students/${id(k.name)}` }));
  const first = students[0];
  return {
    students,
    actions: first
      ? [
          { kind: "collect", href: `/payments?student=${first.id}`, student: first.name, pending: first.money.kind === "pending" ? first.money.amount : null },
          { kind: "call", tel: "9829041120", who: first.parent, relation: "father", child: first.name },
        ]
      : [],
    receipts: first
      ? [
          { id: "r412", number: "R-0412", amount: 2400, student: first.name, date: "2026-10-02", mode: "upi", reversed: false, byChild: true, href: "/receipts/R-0412" },
          { id: "r127", number: "R-0127", amount: 6600, student: first.name, date: "2026-07-12", mode: "cash", reversed: false, byChild: true, href: "/receipts/R-0127" },
        ]
      : [],
  };
}

function SearchFrame({ behind }: { behind?: boolean }) {
  return (
    <>
      {behind ? adminViews.Desktop.render() : null}
      <SearchPalette items={pages} initialOpen initialQuery="aar" search={sampleSearch} />
    </>
  );
}

/* ---------------------------------------------------------- quick actions */

function QuickFrame() {
  // The design's sheet repeats the last thing done; on this phone that was Collect fee.
  try {
    window.localStorage.setItem("vx.quick.last", "collect");
  } catch {
    // No storage: the sheet draws without "Repeat last".
  }
  return (
    <>
      {adminViews["F01-Today"].render()}
      <QuickActions open onClose={() => {}} keys={["collect", "mark", "notice", "admit", "cover", "note"]} />
    </>
  );
}

/* ------------------------------------------------------------------- menu */

function MenuFrame() {
  return (
    <VxPage>
      <MenuScreen
        menu="admin"
        name="Janmejay Singh"
        initials="JS"
        sub="Admin · every workspace"
        groups={menuGroups("admin", () => true)}
        schoolSettings
        previews={[
          { key: "teacher", label: PREVIEW_LABEL.teacher, icon: "grad" },
          { key: "accountant", label: PREVIEW_LABEL.accountant, icon: "rupee" },
          { key: "academic", label: PREVIEW_LABEL.academic, icon: "chart" },
          { key: "exam", label: PREVIEW_LABEL.exam, icon: "clipboard" },
        ]}
        previewing={null}
      />
    </VxPage>
  );
}

/** The accountant's Menu: one "Your work" group, and My settings instead of the school's (D-519). */
function AccountantMenuFrame() {
  return (
    <VxPage>
      <MenuScreen
        menu="accountant"
        name="Ms. Neelam Sharma"
        initials="NS"
        sub="Accountant"
        groups={menuGroups("accountant", () => true)}
        onBar={bottomFor("accountant", () => true).map((t) => t.href)}
        previews={[]}
        previewing={null}
      />
    </VxPage>
  );
}

export const views: Record<string, DesignView> = {
  "F13-Menu": { render: () => <MenuFrame />, path: "/menu" },
  "F13-Menu-Accountant": { render: () => <AccountantMenuFrame />, path: "/menu", menu: "accountant" },
  "F03-QuickActions": { render: () => <QuickFrame />, path: "/" },
  "F05-Students": { render: () => <StudentsFrame />, path: "/students" },
  "D01-Students": { render: () => <StudentsFrame picked={PICKED} />, path: "/students" },
  "F04-Search": { render: () => <SearchFrame />, path: "/students" },
  "D07-Search": { render: () => <SearchFrame behind />, path: "/" },
};
