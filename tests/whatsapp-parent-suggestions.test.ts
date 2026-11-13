import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  decidedLabel,
  decidedMessage,
  decideRefusal,
  inNeedsYou,
  normaliseChange,
  registerAskLine,
  suggestionCard,
  suggestionDays,
  undoneMessage,
  undoRefusal,
  wordsForCard,
  type SuggestionReader,
} from "@/modules/whatsapp/domain/parent-suggestions";
import { markAllLabel, SUGGESTION_WORDS } from "@/modules/whatsapp/domain/parent-suggestion-words";
import { inboxBadgeCount } from "@/vx/shell/badge-count";
import { decideParentSuggestions, readHandoffNote, waitingAbsencesOn } from "@/modules/whatsapp/data/parent-suggestions";

/**
 * A parent's suggestions (D-598): what Veer Patta AI reads on WhatsApp that
 * may belong in a record waits for a person. These are the checks and the
 * words around that: which changes are ever offered, who sees which in Needs
 * you, and that no message claims more than happened. Every name and number
 * here is made up (rule 6).
 */

const TODAY = "2026-11-12";

describe("normaliseChange: only a value the school would take is ever offered", () => {
  it("keeps a whole Indian mobile number, written any usual way", () => {
    expect(normaliseChange({ field: "guardian_phone", value: "98765 43210" }, TODAY)).toEqual({ field: "guardian_phone", value: "9876543210" });
    expect(normaliseChange({ field: "mother_phone", value: "+91 98765-43210" }, TODAY)).toEqual({ field: "mother_phone", value: "9876543210" });
    expect(normaliseChange({ field: "guardian_phone", value: "09876543210" }, TODAY)).toEqual({ field: "guardian_phone", value: "9876543210" });
  });

  it("never cuts a number down to fit", () => {
    expect(normaliseChange({ field: "guardian_phone", value: "98765 4321" }, TODAY)).toBeNull();
    expect(normaliseChange({ field: "guardian_phone", value: "198765432101" }, TODAY)).toBeNull();
    expect(normaliseChange({ field: "guardian_phone", value: "5876543210" }, TODAY)).toBeNull();
  });

  it("reads a date of birth day first, and only at a school child's age", () => {
    expect(normaliseChange({ field: "date_of_birth", value: "9/3/2015" }, TODAY)).toEqual({ field: "date_of_birth", value: "2015-03-09" });
    expect(normaliseChange({ field: "date_of_birth", value: "2015-03-09" }, TODAY)).toEqual({ field: "date_of_birth", value: "2015-03-09" });
    expect(normaliseChange({ field: "date_of_birth", value: "31/2/2015" }, TODAY)).toBeNull();
    expect(normaliseChange({ field: "date_of_birth", value: "2026-12-01" }, TODAY)).toBeNull();
    expect(normaliseChange({ field: "date_of_birth", value: "1980-01-01" }, TODAY)).toBeNull();
  });

  it("knows the eight blood groups however they are written", () => {
    expect(normaliseChange({ field: "blood_group", value: "b positive" }, TODAY)).toEqual({ field: "blood_group", value: "B+" });
    expect(normaliseChange({ field: "blood_group", value: "0 -ve" }, TODAY)).toEqual({ field: "blood_group", value: "O-" });
    expect(normaliseChange({ field: "blood_group", value: "C+" }, TODAY)).toBeNull();
  });

  it("takes an address only at an address's length, and nothing outside the five fields", () => {
    expect(normaliseChange({ field: "address", value: "  12 Test Lane,   Test Nagar  " }, TODAY)).toEqual({ field: "address", value: "12 Test Lane, Test Nagar" });
    expect(normaliseChange({ field: "address", value: "Test" }, TODAY)).toBeNull();
    expect(normaliseChange({ field: "fee_amount", value: "0" }, TODAY)).toBeNull();
    expect(normaliseChange(null, TODAY)).toBeNull();
  });
});

describe("suggestionCard: one card a person can decide from", () => {
  it("says the days, why and the class, and is urgent when it covers today", () => {
    const card = suggestionCard({ kind: "absence", payload: { days: ["2026-11-13", TODAY], reason: "sick" }, childName: "Test Child", classLabel: "Class 6", today: TODAY });
    expect(card.title.en).toBe("Parent says Test Child is sick");
    expect(card.line.en).toBe("Today – Tomorrow · Sick · Class 6");
    expect(card.urgent).toBe(true);
    expect(card.change).toBeNull();
    const later = suggestionCard({ kind: "absence", payload: { days: ["2026-11-16"], reason: "other" }, childName: "Test Child", classLabel: null, today: TODAY });
    expect(later.urgent).toBe(false);
    expect(later.title.en).toBe("Parent says Test Child will be away");
  });

  it("names a visit's day, time and the class asked for", () => {
    const card = suggestionCard({ kind: "visit", payload: { day: "2026-11-13", part: "afternoon", child_name: "Test Visitor", class_label: "Class 3" }, childName: "Test Visitor", classLabel: null, today: TODAY });
    expect(card.title.en).toBe("School visit · Test Visitor");
    expect(card.line.en).toBe("Tomorrow · Afternoon · Class 3");
  });

  it("puts a record change side by side: the value now and the one asked for", () => {
    const card = suggestionCard({ kind: "record", payload: { field: "guardian_phone", value: "9876543210", was: "9000000001" }, childName: "Test Child", classLabel: "Class 6", today: TODAY });
    expect(card.change).toEqual({ field: expect.objectContaining({ en: "Guardian phone" }), was: "9000000001", becomes: "9876543210" });
    expect(card.title.en).toBe("Change guardian phone? · Test Child");
  });

  it("keeps only whole days, in order", () => {
    expect(suggestionDays({ days: ["2026-11-14", "nonsense", 3, "2026-11-13"] })).toEqual(["2026-11-13", "2026-11-14"]);
    expect(suggestionDays({})).toEqual([]);
  });

  it("shows the parent's words as one short paragraph", () => {
    expect(wordsForCard("  Riya   is\n\nunwell  ")).toBe("Riya is unwell");
    expect(wordsForCard("a".repeat(400), 20)).toHaveLength(20);
    expect(wordsForCard(null)).toBeNull();
  });
});

describe("inNeedsYou: the right person gets it", () => {
  const nobody: SuggestionReader = { admin: false, correctsAttendance: false, office: false, feeDesk: false };

  it("shows the admin every one", () => {
    const admin = { ...nobody, admin: true };
    for (const kind of ["absence", "visit", "record"] as const) {
      for (const route of ["class_teacher", "office"] as const) expect(inNeedsYou({ kind, route }, admin)).toBe(true);
    }
  });

  it("leaves a class's absences to its class teacher, and gives the office those with none", () => {
    const corrector = { ...nobody, correctsAttendance: true };
    expect(inNeedsYou({ kind: "absence", route: "class_teacher" }, corrector)).toBe(false);
    expect(inNeedsYou({ kind: "absence", route: "office" }, corrector)).toBe(true);
    expect(inNeedsYou({ kind: "absence", route: "office" }, { ...nobody, office: true })).toBe(false);
  });

  it("sends visits to the office and the fee desk, and record changes to the office only", () => {
    expect(inNeedsYou({ kind: "visit", route: "office" }, { ...nobody, office: true })).toBe(true);
    expect(inNeedsYou({ kind: "visit", route: "office" }, { ...nobody, feeDesk: true })).toBe(true);
    expect(inNeedsYou({ kind: "record", route: "office" }, { ...nobody, office: true })).toBe(true);
    expect(inNeedsYou({ kind: "record", route: "office" }, { ...nobody, feeDesk: true })).toBe(false);
    expect(inNeedsYou({ kind: "record", route: "office" }, { ...nobody, correctsAttendance: true })).toBe(false);
  });
});

describe("the words never claim more than happened", () => {
  it("says how the register starts the child, never that it is saved", () => {
    const one = decidedMessage({ decision: "apply", kind: "absence", mark: "leave", count: 1, childName: "Test Child" });
    expect(one.en).toBe("Leave noted for the register · Test Child");
    const many = decidedMessage({ decision: "apply", kind: "absence", mark: "absent", count: 3 });
    expect(many.en).toBe("3 noted as Absent for the register");
    for (const pair of [one, many]) expect(`${pair.en} ${pair.hi}`).not.toMatch(/saved|सहेज/i);
  });

  it("says that letting go changed nothing", () => {
    expect(decidedMessage({ decision: "dismiss", kind: "record", count: 1 }).en).toBe("Let go · nothing was changed");
    expect(decidedMessage({ decision: "dismiss", kind: "visit", count: 2 }).en).toBe("2 let go · nothing was changed");
  });

  it("names what a visit and a record change did", () => {
    expect(decidedMessage({ decision: "apply", kind: "visit", count: 1 }).en).toBe("Added to Admissions");
    expect(decidedMessage({ decision: "apply", kind: "record", count: 1, childName: "Test Child" }).en).toBe("Changed in the child's record · Test Child");
  });

  it("says whether an undone one waits again", () => {
    expect(undoneMessage("pending").en).toContain("waits for a decision again");
    expect(undoneMessage("undone").en).toContain("no longer waits");
    expect(undoneMessage("pending", 2).en).toBe("2 undone");
  });

  it("names the decision and who took it", () => {
    expect(decidedLabel({ status: "applied", kind: "absence", mark: "leave", by: "Test Teacher" }).en).toBe("Leave · Test Teacher");
    expect(decidedLabel({ status: "dismissed", kind: "record", by: null }).en).toBe("Not now");
    expect(decidedLabel({ status: "applied", kind: "visit", by: "Test Office" }).en).toBe("Added to Admissions · Test Office");
  });

  it("gives a reason a person can act on for every refusal", () => {
    for (const outcome of ["already", "expired", "not_permitted", "not_found", "failed"]) {
      const pair = decideRefusal(outcome);
      expect(pair.en.length).toBeGreaterThan(10);
      expect(pair.hi).toBeTruthy();
    }
    expect(decideRefusal("failed", "handoff_gone").en).toContain("visit could not be added");
    expect(undoRefusal("enquiry_moved").en).toContain("Admissions board");
    expect(undoRefusal("record_moved").en).toContain("changed this detail since");
  });

  it("offers Mark all in both languages, and every button word has its Hindi", () => {
    expect(markAllLabel(4, "leave")).toEqual({ en: "Mark all 4 as Leave", hi: "सभी 4 की छुट्टी लगाएँ" });
    for (const pair of Object.values(SUGGESTION_WORDS)) expect(pair.hi).toBeTruthy();
  });
});

describe("Needs you counts what it shows", () => {
  it("adds a parent's suggestions to the badge, one each", () => {
    const base = { notMarked: false, coverNeeded: 0, changes: 0, confirmations: 0, refunds: 0, failedJobs: 0 };
    expect(inboxBadgeCount({ ...base, parents: 3 })).toBe(3);
    expect(inboxBadgeCount({ ...base, leave: 1, parents: 2 })).toBe(3);
    expect(inboxBadgeCount(base)).toBe(0);
  });
});

describe("the doors that decide a suggestion", () => {
  const actions = readFileSync(join(process.cwd(), "src/app/(app)/inbox/parent-actions.ts"), "utf8");

  it("check who is asking, refuse a preview, and take nothing but ids and a choice from the browser", () => {
    expect(actions.startsWith('"use server"')).toBe(true);
    for (const name of ["decideParentSuggestionsAction", "undoParentSuggestionsAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`));
      const head = body.slice(0, body.indexOf("\n}\n"));
      expect(head).toContain("await assertStaff()");
      expect(head).toContain("canAny(staff, MAY_DECIDE)");
      expect(head).toContain("await assertNotPreviewing()");
      expect(head).toContain("actorStaffId: staff.id");
    }
  });

  it("keeps the Parents' notes card out of /teach's first load: it comes in its own chunk", () => {
    const server = readFileSync(join(process.cwd(), "src/vx/screens/parents/parent-notes.tsx"), "utf8");
    expect(server).toContain('import { ParentNotesLazy } from "./parent-notes-lazy"');
    expect(server).not.toMatch(/import \{[^}]*\bParentNotesCard\b[^}]*\} from "\.\/parent-notes-card"/);
    const lazy = readFileSync(join(process.cwd(), "src/vx/screens/parents/parent-notes-lazy.tsx"), "utf8");
    expect(lazy).toContain('dynamic(() => import("./parent-notes-card")');
  });

  it("never writes a record itself: every decision is the database's", () => {
    const data = readFileSync(join(process.cwd(), "src/modules/whatsapp/data/parent-suggestions.ts"), "utf8");
    expect(data).not.toMatch(/\.from\("(parent_absence_notes|enquiries|student_values|attendance_alerts)"\)/);
    expect(data).toContain('db.rpc("decide_parent_suggestions"');
    expect(data).toContain('db.rpc("undo_parent_suggestion"');
  });
});

describe("Undo keeps every row (D-599)", () => {
  const dir = join(process.cwd(), "supabase/migrations");
  const files = readdirSync(dir).filter((name) => name.endsWith("_parent_suggestion_undo.sql"));
  const sql = readFileSync(join(dir, files[0] ?? "missing"), "utf8").replace(/--[^\n]*/g, "");

  it("is one file that removes nothing, so it goes in without asking anyone", () => {
    expect(files).toHaveLength(1);
    expect(sql).not.toMatch(/\b(drop|truncate)\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).toMatch(/^\s*begin;/);
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });

  it("withdraws a note, closes an enquiry and puts a record back, and applying again brings them back", () => {
    expect(sql).toContain("add column withdrawn_at timestamptz");
    expect(sql).toContain("set withdrawn_at = now(), withdrawn_by = v_actor");
    expect(sql).toContain("withdrawn_at = null, withdrawn_by = null\n            where n.withdrawn_at is not null;");
    expect(sql).toContain("set stage = 'closed', stage_changed_at = now(), updated_at = now()");
    expect(sql).toContain("where e.stage = 'closed' and e.student_id is null");
    expect(sql).toContain("perform vppsone.write_student_value(");
  });

  it("the register reads only notes nobody took back", () => {
    const register = readFileSync(join(process.cwd(), "src/modules/attendance/data/parent-notes.ts"), "utf8");
    expect(register).toContain('.is("withdrawn_at", null)');
  });
});

describe("the register's line and read for a note still waiting (D-601)", () => {
  it("says what the parent said, never that anyone applied it", () => {
    const sick = registerAskLine({ payload: { days: [TODAY], reason: "sick" }, day: TODAY, practice: false });
    expect(sick).toEqual({ en: "Parent says sick", hi: "अभिभावक कहते हैं: बीमार" });
    const away = registerAskLine({ payload: { days: [TODAY], reason: "other" }, day: TODAY, practice: false });
    expect(away.en).toBe("Parent says away");
    for (const line of [sick, away]) expect(`${line.en} ${line.hi}`).not.toMatch(/informed|बताया/);
  });

  it("names the last day only while more days follow, and tags a practice note", () => {
    const days = [TODAY, "2026-11-13", "2026-11-14"];
    expect(registerAskLine({ payload: { days, reason: "sick" }, day: TODAY, practice: false }).en).toMatch(/^Parent says sick · till .*14 Nov/);
    expect(registerAskLine({ payload: { days, reason: "sick" }, day: "2026-11-14", practice: false }).en).toBe("Parent says sick");
    const practice = registerAskLine({ payload: { days: [TODAY], reason: "sick" }, day: TODAY, practice: true });
    expect(practice.en).toBe("Parent says sick · Practice");
    expect(practice.hi).toContain("अभ्यास");
  });

  /** Just enough of a database for one read, recording what it was asked. */
  function fakeDb(rows: unknown[], error: { message: string } | null = null) {
    const asked: Array<[string, ...unknown[]]> = [];
    const chain = {
      from: (table: string) => (asked.push(["from", table]), chain),
      select: (columns: string) => (asked.push(["select", columns]), chain),
      eq: (column: string, value: unknown) => (asked.push(["eq", column, value]), chain),
      gt: (column: string, value: unknown) => (asked.push(["gt", column, value]), chain),
      order: () => chain,
      returns: async () => ({ data: error ? null : rows, error }),
    };
    return { db: chain as never, asked };
  }
  const CLASS = "00000000-0000-4000-8000-0000000000c1";
  const KID = "00000000-0000-4000-8000-0000000000a1";
  const OTHER = "00000000-0000-4000-8000-0000000000a2";

  it("reads only the class's waiting absences, never the parent's words, and keeps one per child that covers the day", async () => {
    const { db, asked } = fakeDb([
      { id: "s1", student_id: KID, payload: { days: [TODAY], reason: "sick" }, practice: false },
      { id: "s2", student_id: KID, payload: { days: [TODAY], reason: "other" }, practice: false },
      { id: "s3", student_id: OTHER, payload: { days: ["2026-11-13"], reason: "sick" }, practice: false },
      { id: "s4", student_id: null, payload: { days: [TODAY], reason: "sick" }, practice: false },
    ]);
    const waiting = await waitingAbsencesOn("TEST-2026-27", CLASS, TODAY, { now: new Date("2026-11-12T03:00:00Z") }, db);
    expect(waiting.map((row) => row.id)).toEqual(["s1"]);
    expect(asked).toContainEqual(["from", "parent_suggestions"]);
    expect(asked).toContainEqual(["eq", "class_id", CLASS]);
    expect(asked).toContainEqual(["eq", "kind", "absence"]);
    expect(asked).toContainEqual(["eq", "status", "pending"]);
    expect(asked).toContainEqual(["gt", "expires_at", "2026-11-12T03:00:00.000Z"]);
    const columns = asked.find(([what]) => what === "select")?.[1];
    expect(columns).not.toMatch(/parent_replies|body/);
  });

  it("asks nothing for a bad class or day, and lets a failed read fail for its caller", async () => {
    const quiet = fakeDb([]);
    expect(await waitingAbsencesOn("TEST-2026-27", "not-a-class", TODAY, {}, quiet.db)).toEqual([]);
    expect(await waitingAbsencesOn("TEST-2026-27", CLASS, "12/11/2026", {}, quiet.db)).toEqual([]);
    expect(quiet.asked).toEqual([]);
    await expect(waitingAbsencesOn("TEST-2026-27", CLASS, TODAY, {}, fakeDb([], { message: "down" }).db)).rejects.toMatchObject({ message: "down" });
  });

  it("is read only for a reader who may decide it, never in a preview, and leaves the register working when it fails", () => {
    const data = readFileSync(join(process.cwd(), "src/vx/screens/teach/data.ts"), "utf8");
    const body = data.slice(data.indexOf("async function registerAsks"), data.indexOf("export async function loadAttendance"));
    expect(body).toContain('can(staff, "attendance:correct")');
    expect(body).toContain('owner && can(staff, "attendance:mark")');
    expect(body).toContain("staffBelongsToSession(staff.isTestAccount, sessionLabel)");
    expect(body).toContain("(await getViewer()).previewing");
    expect(body).toContain("asks.clear()");
  });

  it("keeps the note's buttons and the register's help out of /teach/attendance's first load", () => {
    const attend = readFileSync(join(process.cwd(), "src/vx/screens/teach/ui/attend.tsx"), "utf8");
    expect(attend).toContain('dynamic(() => import("./register-ask")');
    expect(attend).toContain('dynamic(() => import("./register-help")');
    expect(attend).not.toMatch(/from "\.\/register-(ask|help)"/);
    expect(attend).not.toContain("const HELP");
  });
});

describe("deciding from WhatsApp: the note a hand-off came with, and its reminders (D-602)", () => {
  const REPLY = "00000000-0000-4000-8000-0000000000b1";
  const NOTE = "00000000-0000-4000-8000-0000000000d1";
  const STAFF = "00000000-0000-4000-8000-0000000000e1";

  type Op = [string, ...unknown[]];
  /** Enough of a database for these reads and writes, recording each call by table. */
  function recordingDb(answers: { rpc?: unknown; rows?: Record<string, unknown[]>; readError?: { message: string }; updateError?: { message: string } } = {}) {
    const calls: Array<{ table: string; ops: Op[] }> = [];
    const rpcs: Array<[string, unknown]> = [];
    const db = {
      rpc: (name: string, args: unknown) => {
        rpcs.push([name, args]);
        return Promise.resolve({ data: answers.rpc ?? null, error: null });
      },
      from: (table: string) => {
        const call = { table, ops: [] as Op[] };
        calls.push(call);
        const query: Record<string, unknown> = {};
        for (const op of ["select", "eq", "in", "is", "not", "order", "limit", "update", "returns"]) {
          query[op] = (...args: unknown[]) => (call.ops.push([op, ...args]), query);
        }
        query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          const updating = call.ops.some(([op]) => op === "update");
          const answer = updating
            ? { data: null, error: answers.updateError ?? null }
            : { data: answers.readError ? null : (answers.rows?.[table] ?? []), error: answers.readError ?? null };
          return Promise.resolve(answer).then(resolve, reject);
        };
        return query;
      },
    };
    return { db: db as never, calls, rpcs };
  }

  it("reads the newest absence that came with the message, never the parent's words", async () => {
    const { db, calls } = recordingDb({
      rows: {
        parent_suggestions: [
          { id: NOTE, status: "pending", payload: { days: ["2026-11-13", TODAY], reason: "sick" }, expires_at: "2026-11-13T18:30:00Z", practice: true, decided_by: null, decision: null },
        ],
      },
    });
    expect(await readHandoffNote(REPLY, db)).toEqual({
      id: NOTE,
      status: "pending",
      days: [TODAY, "2026-11-13"],
      reason: "sick",
      expiresAt: "2026-11-13T18:30:00Z",
      practice: true,
      mark: null,
      decidedByName: null,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe("parent_suggestions");
    expect(calls[0]!.ops).toContainEqual(["eq", "parent_reply_id", REPLY]);
    expect(calls[0]!.ops).toContainEqual(["eq", "kind", "absence"]);
    expect(calls[0]!.ops).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls[0]!.ops).toContainEqual(["limit", 1]);
    const columns = calls[0]!.ops.find(([op]) => op === "select")?.[1];
    expect(columns).not.toMatch(/parent_replies|body/);
  });

  it("says how a decided note was decided, and by whom", async () => {
    const { db, calls } = recordingDb({
      rows: {
        parent_suggestions: [
          { id: NOTE, status: "applied", payload: { days: [TODAY], reason: "other" }, expires_at: "2026-11-12T18:30:00Z", practice: false, decided_by: STAFF, decision: { mark: "absent", noted: 1 } },
        ],
        staff_profiles: [{ id: STAFF, short_name: "TEST Teacher", display_name: "TEST Teacher One" }],
      },
    });
    expect(await readHandoffNote(REPLY, db)).toMatchObject({ status: "applied", reason: "other", mark: "absent", decidedByName: "TEST Teacher" });
    expect(calls.map((call) => call.table)).toEqual(["parent_suggestions", "staff_profiles"]);
  });

  it("none for a message that came with no absence, or a bad id; a failed read fails for its caller", async () => {
    expect(await readHandoffNote(REPLY, recordingDb().db)).toBeNull();
    const quiet = recordingDb();
    expect(await readHandoffNote("not-a-reply", quiet.db)).toBeNull();
    expect(quiet.calls).toEqual([]);
    await expect(readHandoffNote(REPLY, recordingDb({ readError: { message: "down" } }).db)).rejects.toMatchObject({ message: "down" });
  });

  const decided = (outcome: string) => ({ ok: true, applied: outcome === "applied" ? 1 : 0, dismissed: outcome === "dismissed" ? 1 : 0, results: [{ id: NOTE, outcome }] });

  it.each(["applied", "dismissed"])("once %s, wherever it was decided, its hand-off stops reminding, and stays open", async (outcome) => {
    const { db, calls, rpcs } = recordingDb({ rpc: decided(outcome), rows: { parent_suggestions: [{ parent_reply_id: REPLY }] } });
    const result = await decideParentSuggestions({ actorStaffId: STAFF, ids: [NOTE], decision: outcome === "applied" ? "apply" : "dismiss", mark: "leave", via: "whatsapp" }, db);
    expect(result).toMatchObject({ ok: true, results: [{ id: NOTE, outcome }] });
    expect(rpcs).toEqual([["decide_parent_suggestions", { p: { actor_staff_id: STAFF, ids: [NOTE], decision: outcome === "applied" ? "apply" : "dismiss", mark: "leave", via: "whatsapp" } }]]);
    const update = calls.find((call) => call.table === "parent_helper_handoffs")!;
    const patch = update.ops.find(([op]) => op === "update")?.[1] as Record<string, unknown>;
    expect(patch).toMatchObject({ next_action: null, next_action_at: null });
    // Not closed: the message can still be answered, and is still on the person's list.
    expect(patch).not.toHaveProperty("closed_at");
    expect(update.ops).toContainEqual(["in", "parent_reply_id", [REPLY]]);
    expect(update.ops).toContainEqual(["is", "answered_at", null]);
    expect(update.ops).toContainEqual(["is", "closed_at", null]);
    expect(update.ops).toContainEqual(["not", "next_action", "is", null]);
  });

  it("nothing decided, nothing stopped; a reminder that could not be stopped never undoes the decision", async () => {
    for (const outcome of ["already", "expired", "not_permitted"]) {
      const { db, calls } = recordingDb({ rpc: decided(outcome) });
      await decideParentSuggestions({ actorStaffId: STAFF, ids: [NOTE], decision: "apply", via: "whatsapp" }, db);
      expect(calls).toEqual([]);
    }
    const { db } = recordingDb({ rpc: decided("applied"), rows: { parent_suggestions: [{ parent_reply_id: REPLY }] }, updateError: { message: "down" } });
    expect(await decideParentSuggestions({ actorStaffId: STAFF, ids: [NOTE], decision: "apply", via: "whatsapp" }, db)).toMatchObject({ ok: true, applied: 1 });
  });
});
