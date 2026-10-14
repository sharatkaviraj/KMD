import type { DesignView } from "../design.fixture";
import { StudentsScreen, type StudentListRow, type StudentsProps } from "@/vx/screens/admin/students";
import type { StudentFacts } from "@/vx/screens/admin/students-logic";
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

export const views: Record<string, DesignView> = {
  "F05-Students": { render: () => <StudentsFrame />, path: "/students" },
  "D01-Students": { render: () => <StudentsFrame picked={PICKED} />, path: "/students" },
};
