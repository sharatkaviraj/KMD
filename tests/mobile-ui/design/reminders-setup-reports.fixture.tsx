import type { AudienceFamily } from "@/modules/whatsapp/vx/domain/reminders";
import { RemindersScreen } from "@/vx/screens/reminders/screen";
import type { BatchRow, RemindersProps, RuleRow, RunView } from "@/vx/screens/reminders/types";

import type { DesignView } from "../design.fixture";

/*
 * Fee reminders, Fee setup and Reports beside their design frames
 * (docs/design-handoff/screenshots/money). Every name and amount is the
 * design's own synthetic sample; nothing here reaches a database.
 */

// Sheets and toasts portal into #vx-layer, which the production shell mounts.
if (typeof document !== "undefined" && !document.getElementById("vx-layer")) {
  const layer = document.createElement("div");
  layer.id = "vx-layer";
  layer.className = "vxt vx-layer";
  document.body.appendChild(layer);
}

/* ---------------------------------------------------------------- Reminders */

const TODAY = "2026-10-08";

const run = (runId: string, name: string, day: string, messaged: number, delivered: number, read: number, familiesPaid: number, moneyCollected: number, auto = false): RunView => ({
  runId, name, startedAt: `${day}T10:00:00+05:30`, messaged, delivered, read, failed: messaged - delivered, familiesPaid, moneyCollected, moneyQuoted: moneyCollected * 2, source: auto ? "cron" : "manual",
});

const RUNS: RunView[] = [
  run("c1", "Inst 2 · last reminder before calls", "2026-10-05", 124, 121, 97, 22, 89450),
  run("c0", "Every Monday · 90+ days overdue", "2026-10-05", 8, 8, 6, 0, 0, true),
  run("c2", "Inst 2 · one week late", "2026-09-22", 212, 204, 171, 38, 210600),
  run("c3", "Inst 2 is due today", "2026-09-15", 268, 259, 222, 11, 39950, true),
  run("c4", "Bus fee · Routes 3 and 4", "2026-09-01", 46, 45, 39, 17, 31200),
];

const rule = (ruleKey: string, titleEn: string, icon: string, timingOptions: string[], timingChoice: string, template: RuleRow["template"], enabled: boolean): RuleRow => ({
  ruleKey, titleEn, titleHi: null, icon, timingOptions, timingChoice, sendTime: "10", audience: "all", template, quietHours: true, enabled, updatedAt: "2026-10-01T10:00:00+05:30",
});

const RULES: RuleRow[] = [
  rule("before_due", "3 days before a due date", "calendar", ["1", "3", "7"], "3", "upcoming", true),
  rule("on_due", "On the due date", "bell", ["0"], "0", "gentle", true),
  rule("after_due", "7 days after a due date", "alert", ["3", "7", "15"], "7", "gentle", false),
  rule("weekly_90", "Every Monday for 90+ days overdue", "refresh", ["mon", "thu"], "mon", "final", true),
];

/** The design's pool: 336 families on the roll and 7 who left, made the same way each time. */
function audience(): AudienceFamily[] {
  const PER = [4350, 5100, 6450, 7800, 8700];
  const CLASS = ["UKG", "Class 3", "Class 7", "Class 9", "Class 11 Science"];
  const named: [string, string, number, number][] = [
    ["Rakesh Sharma", "Aarav · Class 7, Diya · Class 3", 2, 12840],
    ["Prakash Joshi", "Neha · Class 8, Rohit · Class 5", 2, 22080],
    ["Mohan Kumawat", "Aarti · Class 10", 3, 15600],
    ["Anil Agarwal", "Mohit · Class 9", 3, 9375],
    ["Suresh Meena", "Pihu · UKG", 0, 4350],
    ["Dinesh Sen", "Ayaan · Class 1", 1, 7125],
    ["Gopal Purohit", "Tanya · 11 Commerce", 4, 17400],
  ];
  const pool: AudienceFamily[] = [];
  for (let i = 0; i < 336; i += 1) {
    const r = (i * 53) % 336;
    const b = (i * 97) % 336;
    const band = b < 47 ? 0 : b < 145 ? 1 : b < 212 ? 2 : b < 257 ? 3 : 4;
    const bus = (i * 31) % 336 < 118;
    const pend = r < 112;
    pool.push({
      key: `f${i}`, studentIds: [`s${i}`], fatherName: `Test Parent ${i + 1}`, kidsLine: `Child ${i + 1} · ${CLASS[band]}`, classLabels: [CLASS[band]],
      pendingToday: pend ? PER[band] * (r < 40 ? 2 : 1) + (bus ? 1575 : 0) : 0, notDueYet: PER[band], usesBus: bus,
      overdueInstallments: r < 104 ? [1, 2] : pend ? [1] : [], promised: pend && r % 8 === 3, paidLast3Days: pend && r % 19 === 6, left: false,
    });
  }
  for (let i = 0; i < 7; i += 1) {
    pool.push({ key: `l${i}`, studentIds: [`l${i}`], fatherName: `Left Parent ${i + 1}`, kidsLine: `Left child · ${CLASS[i % 5]}`, classLabels: [CLASS[i % 5]], pendingToday: 6000 + i * 500, notDueYet: 0, usesBus: false, overdueInstallments: [1, 2], promised: false, paidLast3Days: false, left: true });
  }
  // The design's named families stand in for the first plain matches, so the sample list reads as drawn.
  let n = 0;
  const plain = pool.filter((f) => f.pendingToday > 0 && !f.promised && !f.paidLast3Days && !f.left);
  for (const f of plain.slice(0, named.length)) {
    const [father, kids, band, amt] = named[n++];
    Object.assign(f, { fatherName: father, kidsLine: kids, classLabels: [CLASS[band]], pendingToday: amt });
  }
  const first = new Set(plain.slice(0, named.length).map((f) => f.key));
  return [...pool.filter((f) => first.has(f.key)), ...pool.filter((f) => !first.has(f.key))];
}

const BATCH: BatchRow = {
  id: "b1", name: "Pending today · all classes · gentle", template: "gentle", language: "both",
  audience: { pendingToday: true, inst2: false, big: false, bus: false, bands: [], excludePromised: true, excludePaidRecently: true, excludeLeft: true },
  audienceLine: "Pending today · all classes", studentIds: [], familyCount: 92, moneyQuoted: 612300, costEstimate: 81, status: "queued", scheduledFor: null, createdByName: "Janmejay", createdAt: `${TODAY}T09:40:00+05:30`,
};

const base: RemindersProps = {
  today: TODAY, sessionLabel: "2026-27", view: "list", step: 1, runs: RUNS, batches: [], rules: RULES, audience: [], batch: null, result: null, ruleOpen: null, perms: { queue: true, rules: true },
};

const FAILED: [string, string, string][] = [
  ["Tisha Rawal", "Class 4", "Invalid number"], ["Lakshya Gurjar", "Class 6", "Invalid number"], ["Riddhi Jain", "UKG", "Not on WhatsApp"], ["Aryan Regar", "Class 9", "Not on WhatsApp"],
  ["Dhruvi Vyas", "Class 2", "Invalid number"], ["Kavya Kanwar", "11 Arts", "Not on WhatsApp"], ["Ishaan Sen", "Class 5", "Not on WhatsApp"], ["Pari Bhati", "LKG", "Invalid number"],
];

const reminders = (patch: Partial<RemindersProps>) =>
  function RemindersView() {
    return <RemindersScreen {...base} {...patch} />;
  };
const wizard = (step: 1 | 2 | 3) => reminders({ view: "wizard", step, audience: audience() });
const results = reminders({
  view: "results",
  result: {
    run: RUNS[2],
    notDelivered: FAILED.map(([studentName, classLabel, error], i) => ({ studentId: `x${i}`, studentName, classLabel, error })),
    byClass: [["Nursery–UKG", 28, 52200], ["Class 1–5", 61, 113400], ["Class 6–8", 47, 104400], ["Class 9–10", 34, 85800], ["Class 11–12", 42, 65400]].map(([classLabel, messaged, quoted]) => ({ classLabel: String(classLabel), messaged: Number(messaged), quoted: Number(quoted) })),
  },
});

const R = "/reminders";
export const views: Record<string, DesignView> = {
  Reminders: { render: reminders({}), path: R },
  "AC-Reminders": { render: reminders({ perms: { queue: true, rules: false } }), path: R, menu: "accountant" },
  "MAC-Reminders": { render: reminders({ perms: { queue: true, rules: false } }), path: R, menu: "accountant" },
  "M-Reminders": { render: reminders({}), path: R },
  "DX-Reminders-Message": { render: wizard(2), path: R },
  "M-Reminders-Audience": { render: wizard(1), path: R },
  "M-Reminders-Review": { render: wizard(3), path: R },
  "DX-Reminders-Results": { render: results, path: R },
  "DX-Reminders-Sending": { render: reminders({ view: "sending", batch: BATCH }), path: R },
  "M-Reminders-Rule": { render: reminders({ ruleOpen: "before_due" }), path: R },
  "M-Reminders-Empty": { render: reminders({ view: "empty", runs: [], batches: [] }), path: R },
};
