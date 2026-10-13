import type { ReactNode } from "react";

import type { DesignView } from "../design.fixture";

import { ReceiptsDesk } from "@/vx/screens/receipts/desk";
import type { DeskProps, DeskRow, SelectedReceipt } from "@/vx/screens/receipts/types";

/*
 * Receipts & day close (design `Fees`) and Dues & calls (design `Dues`), with
 * the frames' own synthetic records. Every name and amount is the design's
 * made-up sample data; nothing here reaches a database.
 */

/*
 * Sheets and toasts portal into `#vx-layer`, which the app's shell mounts
 * beside the page. The design fixture's shell does not, so each view brings
 * its own and the reverse / write-off / call sheets draw as they do in the app.
 */
function Layered({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <div id="vx-layer" className="vxt vx-layer" />
    </>
  );
}

// ---------------------------------------------------------------- Receipts

const TODAY = "2026-10-08";
const DAY: Record<string, string> = { today: "2026-10-08", yesterday: "2026-10-07", tue: "2026-10-06" };

type R = [no: string, day: string, time: string, name: string, cls: string, sr: string, father: string, mode: string, amt: number, by: string, extra?: { reversed?: boolean; ref?: string }];

const RECEIPTS: R[] = [
  ["R-0417", "today", "10:38", "Pooja Mehta", "11 Commerce", "0933", "Dinesh Mehta", "upi", 4350, "Janmejay"],
  ["R-0416", "today", "10:21", "Kunal Verma", "Class 4", "1187", "Sanjay Verma", "cash", 2850, "Office desk"],
  ["R-0415", "today", "10:05", "Tanvi Paliwal", "LKG", "1420", "Gopal Paliwal", "upi", 2175, "Office desk"],
  ["R-0414", "today", "09:58", "Harsh Vyas", "Class 8", "1046", "Naresh Vyas", "upi", 3900, "Janmejay"],
  ["R-0413", "today", "09:44", "Meera Choudhary", "Class 2", "1361", "Ramesh Choudhary", "cash", 1500, "Office desk"],
  ["R-0412", "today", "09:31", "Kabir Solanki", "Class 6", "1219", "Suresh Solanki", "upi", 6000, "Janmejay"],
  ["R-0411", "today", "09:20", "Anaya Dave", "UKG", "1398", "Hitesh Dave", "upi", 1200, "Office desk"],
  ["R-0410", "today", "09:12", "Vivaan Trivedi", "12 Science", "0861", "Alok Trivedi", "upi", 4800, "Janmejay"],
  ["R-0409", "today", "08:58", "Sneha Bhati", "Class 9", "1030", "Manoj Bhati", "cash", 1175, "Office desk"],
  ["R-0408", "today", "08:47", "Ritika Purohit", "Class 5", "1377", "Deepak Purohit", "upi", 2500, "Office desk"],
  ["R-0407", "today", "08:39", "Arjun Rawal", "Class 3", "1314", "Bharat Rawal", "cash", 700, "Office desk"],
  ["R-0406", "today", "08:30", "Ishaan Kothari", "Class 1", "1385", "Vivek Kothari", "upi", 3150, "Janmejay"],
  ["R-0405", "today", "08:18", "Nidhi Chouhan", "Class 7", "1241", "Prem Chouhan", "cash", 1000, "Office desk"],
  ["R-0404", "today", "08:05", "Aditi Jain", "Class 10", "0975", "Rajesh Jain", "upi", 3100, "Janmejay"],
  ["R-0403", "yesterday", "16:40", "Yash Mehta", "Class 9", "1028", "Kamal Mehta", "upi", 6000, "Janmejay"],
  ["R-0402", "yesterday", "13:15", "Khushi Sharma", "Class 6", "1222", "Lokesh Sharma", "cash", 4600, "Office desk"],
  ["R-0401", "yesterday", "11:20", "Dev Rathore", "11 Science", "0912", "Ajay Rathore", "cheque", 7000, "Office desk", { ref: "Cheque 004512 · SBI Amet" }],
  ["R-0400", "yesterday", "10:05", "Manvi Joshi", "Class 4", "1190", "Sunil Joshi", "upi", 5000, "Janmejay"],
  ["R-0399", "yesterday", "09:30", "Rudra Singh", "Class 3", "1309", "Vikram Singh", "cash", 3000, "Office desk", { reversed: true }],
];

const at = (day: string, time: string) => `${DAY[day]}T${time}:00+05:30`;

const rowOf = (r: R): DeskRow => ({
  id: `synthetic-${r[0]}`,
  receiptNumber: r[0],
  paymentDate: DAY[r[1]],
  createdAt: at(r[1], r[2]),
  paymentMode: r[7],
  totalAmount: r[8],
  isReversed: Boolean(r[10]?.reversed),
  receivedBy: r[9],
  studentFullName: r[3],
  admissionNo: `SR ${r[5]}`,
  classLabel: r[4],
});

function selectedOf(no: string): SelectedReceipt {
  const r = RECEIPTS.find((x) => x[0] === no)!;
  const row = rowOf(r);
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    studentFullName: row.studentFullName,
    admissionNo: row.admissionNo,
    classLabel: row.classLabel,
    fatherName: r[6],
    fatherPhone: null,
    paymentDate: row.paymentDate,
    createdAt: row.createdAt,
    paymentMode: row.paymentMode,
    referenceNumber: r[10]?.ref ?? (r[7] === "upi" ? `4271••••${r[5]}` : null),
    totalAmount: row.totalAmount,
    reversedAmount: row.isReversed ? row.totalAmount : 0,
    isReversed: row.isReversed,
    receivedBy: row.receivedBy,
    sessionLabel: "2026-27",
    heads: [{ label: "Tuition · Installment 2", amount: row.totalAmount }],
    share: r[1] === "today" ? { status: "not_sent", at: null } : { status: "read", at: at(r[1], r[2]) },
    history: [{ at: row.createdAt, kind: "posted" }],
    pendingRequest: null,
  };
}

const todayRows = RECEIPTS.filter((r) => r[1] === "today").map(rowOf);

function desk(over: Partial<DeskProps> = {}): DeskProps {
  return {
    today: TODAY,
    anchor: TODAY,
    span: "today",
    from: TODAY,
    to: TODAY,
    view: "list",
    sessionLabel: "2026-27",
    rows: todayRows,
    truncated: false,
    lastDate: null,
    closeEvent: null,
    lastReopen: null,
    selected: null,
    sheet: null,
    initial: { mode: "", staff: "", query: "" },
    perms: { collect: true, accounts: true, reverse: true, reopen: true, print: true, dayBook: true },
    ...over,
  };
}

const receiptViews: Record<string, DesignView> = {
  Fees: { render: () => <ReceiptsDesk {...desk()} />, path: "/receipts" },
  "AC-Fees": { render: () => <ReceiptsDesk {...desk({ perms: { collect: true, accounts: true, reverse: false, reopen: false, print: true, dayBook: true } })} />, path: "/receipts", menu: "accountant" },
  "DX-Fees-Receipt": { render: () => <ReceiptsDesk {...desk({ selected: selectedOf("R-0417") })} />, path: "/receipts" },
  "DX-Fees-Close": { render: () => <ReceiptsDesk {...desk({ view: "close" })} />, path: "/receipts" },
  "M-Fees": { render: () => <ReceiptsDesk {...desk()} />, path: "/receipts" },
  "MAC-Fees": { render: () => <ReceiptsDesk {...desk({ perms: { collect: true, accounts: true, reverse: false, reopen: false, print: true, dayBook: true } })} />, path: "/receipts", menu: "accountant" },
  "M-Fees-Receipt": { render: () => <ReceiptsDesk {...desk({ selected: selectedOf("R-0417") })} />, path: "/receipts" },
  "M-Fees-Reverse": { render: () => <ReceiptsDesk {...desk({ selected: selectedOf("R-0416"), sheet: "reverse" })} />, path: "/receipts" },
  "M-Fees-Close": { render: () => <ReceiptsDesk {...desk({ view: "close" })} />, path: "/receipts" },
  // Not drawn as a frame, but the design's `reversed` and `closed` start states.
  "Fees-Reversed": { render: () => <ReceiptsDesk {...desk({ span: "yesterday", anchor: TODAY, rows: RECEIPTS.filter((r) => r[1] === "yesterday").map(rowOf), selected: selectedOf("R-0399") })} />, path: "/receipts" },
  "Fees-Closed": {
    render: () => (
      <ReceiptsDesk
        {...desk({
          view: "close",
          closeEvent: { id: "synthetic-close", paymentDate: TODAY, action: "close", cashExpected: 7225, cashCounted: 7125, upiChecked: true, receiptCount: 14, reversedCount: 0, expected: { total: 38400, cash: 7225, upi: 31175, cheque: 0, bank: 0 }, note: "₹100 given back as change", actorName: "Janmejay", createdAt: `${TODAY}T17:10:00+05:30` },
        })}
      />
    ),
    path: "/receipts",
  },
};

const layered = (all: Record<string, DesignView>): Record<string, DesignView> =>
  Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { ...v, render: () => <Layered>{v.render()}</Layered> }]));

export const views: Record<string, DesignView> = layered({
  ...receiptViews,
});
