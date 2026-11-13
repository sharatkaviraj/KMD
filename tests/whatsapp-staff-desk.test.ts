import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/platform/whatsapp/store", () => ({ readSwitches: vi.fn(), whatsappDb: vi.fn() }));

import { readDesk, readFeeFigures, readPracticeSeat, readStaffHat, saveStaffHat } from "@/modules/whatsapp/data/staff-desk";
import { WA_LIMITS, fitMessage, type HelperMessage } from "@/modules/whatsapp/domain/helper-messages";
import { MAX_TURNS_PER_NUMBER_PER_DAY, OWNER_TURNS_PER_DAY, dailyTurnCap } from "@/modules/whatsapp/domain/helper-plan";
import {
  collectionReply,
  coverReply,
  deskButtons,
  deskCommands,
  deskMenuReply,
  deskOf,
  deskSubjectOf,
  duesReply,
  feeFactsFrom,
  feesElsewhereReply,
  firstHatNote,
  firstOnDesk,
  leaveReply,
  needsYouReply,
  ownerParentReply,
  pickPracticeSeat,
  roleListReply,
  schoolReply,
  staffAwayReply,
  staffParentReply,
  withDeskButtons,
  withLeadNote,
  type DeskContext,
  type DeskRead,
  type FeeFacts,
  type LinkedStaff,
} from "@/modules/whatsapp/domain/staff-desk";
import { OWNER_DEFAULT_HAT, ownerPassesAsParent, routeStaffMessage, type StaffRoute, type StaffWho } from "@/modules/whatsapp/domain/staff-route";
import { UNDERSTOOD_ASKS, readUnderstanding, staffUnderstandSystemPrompt, staffUnderstandUserText } from "@/modules/whatsapp/domain/staff-understand";
import {
  STAFF_COMMANDS,
  STAFF_HATS,
  duesQueryIn,
  keywordCommands,
  readStaffAsk,
  roleButtonId,
  staffButtonId,
  writesHindi,
  type StaffAsk,
  type StaffHat,
} from "@/modules/whatsapp/domain/staff-words";
import { accountForAlias } from "@/platform/auth/dayrun-policy";
import { permissionsFor, type StaffRole } from "@/platform/auth/permissions";

/**
 * Veer Patta AI's staff desks (D-607): who is answered as whom, what each
 * role is offered, the words, and the replies inside WhatsApp's limits.
 * Every name and number here is made up (rule 6).
 */

const DAY = "2026-11-12";
const ORIGIN = "https://one.example.test";
const ROLES: readonly StaffRole[] = ["admin", "office", "accountant", "fee_collector", "teacher", "academic_coordinator", "exam_coordinator", "view_only"];

function staffOf(role: StaffRole, over: Partial<LinkedStaff> = {}): LinkedStaff {
  return {
    staffId: `5ea70000-0000-4000-8000-00000000000${ROLES.indexOf(role) + 1}`,
    userId: null,
    name: `TEST ${role}`,
    role,
    isTest: true,
    language: "en",
    permissions: [...permissionsFor(role)],
    isTeaching: role === "teacher",
    ...over,
  };
}

const NO_DESK: DeskRead = { held: [], reader: null };
const CLASS_TEACHER: DeskRead = { held: ["c6"], reader: null };
const DECIDES: DeskRead = { held: [], reader: { kind: "admin" } as never };

function ctxOf(staff: LinkedStaff, desk: DeskRead = NO_DESK, over: Partial<DeskContext> = {}): DeskContext {
  return {
    language: staff.language,
    name: staff.name,
    helperName: "Veer Patta AI",
    practice: staff.isTest,
    sessionLabel: staff.isTest ? "TEST-2026-27" : "2026-27",
    origin: ORIGIN,
    role: staff.role,
    commands: deskCommands(deskSubjectOf(staff, desk)),
    ownerHat: null,
    ...over,
  };
}

function words(text: string): StaffAsk {
  return readStaffAsk({ type: "text", text, raw: { type: "text" } });
}

function tap(id: string, list = false): StaffAsk {
  const reply = { id, title: "x" };
  return readStaffAsk({ type: "interactive", text: null, raw: { type: "interactive", interactive: list ? { type: "list_reply", list_reply: reply } : { type: "button_reply", button_reply: reply } } });
}

function bodyOf(message: HelperMessage): string {
  return message.kind === "text" ? message.text : message.kind === "document" ? message.caption : message.body;
}

/** Every string inside Meta's limits as it is written, so nothing is ever cut short when it goes. */
function expectWithinLimits(message: HelperMessage, label: string): void {
  if (message.kind === "text") {
    expect(message.text.length, label).toBeLessThanOrEqual(WA_LIMITS.text);
    return;
  }
  if (message.kind === "document") return;
  expect(message.body.length, label).toBeLessThanOrEqual(WA_LIMITS.body);
  if (message.footer) expect(message.footer.length, `${label} footer`).toBeLessThanOrEqual(WA_LIMITS.footer);
  if (message.kind === "buttons") {
    expect(message.buttons.length, label).toBeLessThanOrEqual(WA_LIMITS.buttons);
    for (const button of message.buttons) expect(button.title.length, `${label}: ${button.title}`).toBeLessThanOrEqual(WA_LIMITS.buttonTitle);
    expect(new Set(message.buttons.map((button) => button.title)).size, `${label} titles`).toBe(message.buttons.length);
    return;
  }
  expect(message.rows.length, label).toBeLessThanOrEqual(WA_LIMITS.rows);
  expect(message.button.length, label).toBeLessThanOrEqual(WA_LIMITS.listButton);
  if (message.section) expect(message.section.length, `${label}: ${message.section}`).toBeLessThanOrEqual(WA_LIMITS.sectionTitle);
  for (const row of message.rows) {
    expect(row.title.length, `${label}: ${row.title}`).toBeLessThanOrEqual(WA_LIMITS.rowTitle);
    expect((row.description ?? "").length, `${label}: ${row.description}`).toBeLessThanOrEqual(WA_LIMITS.rowDescription);
  }
  expect(new Set(message.rows.map((row) => row.id)).size, `${label} ids`).toBe(message.rows.length);
  // What fitMessage would send is what was written.
  expect(fitMessage(message), label).toMatchObject({ kind: "list", rows: message.rows.map((row) => ({ id: row.id, title: row.title })) });
}

/* ------------------------------------------------------------- the words */

describe("what staff ask, from their words and taps", () => {
  it("names the asks in order, so each desk takes the first it has", () => {
    expect(words("today")).toMatchObject({ kind: "command", to: ["today", "school"], strict: true, via: "words" });
    expect(words("attendance")).toMatchObject({ kind: "command", to: ["school", "absent"], strict: false });
    expect(words("Fees")).toMatchObject({ kind: "command", to: ["collection", "dues"], strict: false });
    expect(words("बकाया")).toMatchObject({ kind: "command", to: ["dues", "collection"] });
    expect(words("aaj ka collection")).toMatchObject({ kind: "command", to: ["collection", "dues"] });
    expect(words("staff")).toMatchObject({ kind: "command", to: ["menu"], strict: true, back: true });
    expect(words("hi")).toMatchObject({ kind: "command", to: ["menu"], strict: false, back: false });
    expect(words("leave requests")).toMatchObject({ kind: "command", to: ["leave", "today"] });
    expect(words("roles")).toMatchObject({ kind: "command", to: ["roles"] });
  });

  it("a role to try, a parent, or one's own role, however it is written", () => {
    for (const [text, hat] of [
      ["try as accountant", "accountant"],
      ["Try as an Accountant!", "accountant"],
      ["accountant mode", "accountant"],
      ["switch to teacher", "teacher"],
      ["test as class teacher", "teacher"],
      ["login as office", "office"],
      ["try as exam coordinator", "exam_coordinator"],
      ["be the fee collector", null],
      ["as parent", "parent"],
      ["write as a parent", "parent"],
      ["अकाउंटेंट बनकर", "accountant"],
      ["मैं अभिभावक हूँ", "parent"],
      ["main teacher hoon", "teacher"],
      ["back to staff", "staff"],
      ["as admin please", "admin"],
    ] as const) {
      if (hat === null) expect(words(text).kind, text).not.toBe("hat");
      else expect(words(text), text).toEqual({ kind: "hat", hat, via: "words" });
    }
  });

  it("a role named on its own is a message, not a switch", () => {
    for (const text of ["teacher", "accountant", "parent", "admin"]) expect(words(text).kind, text).toBe("text");
  });

  it("reads taps by their id: a desk's button carries the role it was sent under", () => {
    expect(tap(staffButtonId("dues", "accountant"))).toEqual({ kind: "command", to: ["dues"], hat: "accountant", query: null, via: "tap", strict: true, back: false });
    expect(tap(staffButtonId("today"), true)).toMatchObject({ kind: "command", to: ["today"], hat: null, via: "tap" });
    expect(tap(roleButtonId("teacher"), true)).toEqual({ kind: "hat", hat: "teacher", via: "tap" });
    expect(tap(roleButtonId("list"))).toEqual({ kind: "hat", hat: null, via: "tap" });
    expect(tap(roleButtonId("staff"))).toEqual({ kind: "hat", hat: "staff", via: "tap" });
    // Somebody else's buttons, and ones this version does not know, are not staff asks.
    for (const id of ["vpai:fees", "vpst:fly", "vpsr:principal", "fees"]) expect(tap(id), id).toEqual({ kind: "foreign" });
  });

  it("one child's dues by name or SR number, and never a word the desk already knows", () => {
    expect(words("dues Rahul")).toMatchObject({ kind: "command", to: ["dues", "collection"], query: "rahul" });
    expect(words("Rahul ki fees kitni baki hai")).toMatchObject({ kind: "command", query: "rahul" });
    expect(words("SR 1234 dues")).toMatchObject({ query: "1234" });
    expect(duesQueryIn("today fees")).toBeNull();
    expect(duesQueryIn("aaj ki fees")).toBeNull();
    expect(duesQueryIn("pending approvals")).toBeNull();
    expect(duesQueryIn("fees")).toBeNull();
  });

  it("anything else is typed words, and a voice note or a photo is nothing to read", () => {
    expect(words("Can you tell me how many children are absent in class 6 today?")).toEqual({
      kind: "text",
      text: "Can you tell me how many children are absent in class 6 today?",
    });
    expect(words("x".repeat(900))).toEqual({ kind: "text", text: "x".repeat(500) });
    expect(readStaffAsk({ type: "audio", text: null, raw: { type: "audio" } })).toEqual({ kind: "none" });
    expect(readStaffAsk({ type: "image", text: "today", raw: { type: "image" } })).toEqual({ kind: "none" });
    expect(words("   ")).toEqual({ kind: "none" });
    expect(words("🙏")).toEqual({ kind: "none" });
  });

  it("keywords find the likely asks when Claude is not there", () => {
    expect(keywordCommands("how much fees collected today")[0]).toBe("collection");
    expect(keywordCommands("which children are absent")[0]).toBe("absent");
    expect(keywordCommands("kaun teacher chutti par hai")).toContain("leave");
    expect(keywordCommands("any parent messages for me?")[0]).toBe("questions");
    expect(keywordCommands("good evening")).toEqual([]);
  });

  it("Hindi letters mean a Hindi reply", () => {
    expect(writesHindi("आज")).toBe(true);
    expect(writesHindi("aaj")).toBe(false);
    expect(writesHindi(null)).toBe(false);
  });
});

/* -------------------------------------------------------- who answers as whom */

describe("who answers a message, and as whom", () => {
  const owner = (hat: StaffHat | null): StaffWho => ({ kind: "owner", hat });
  const linked = (hat: StaffHat | null = null): StaffWho => ({ kind: "linked", hat });

  it("the owner's number: the admin's desk at first, said once and kept; the role it tries after that", () => {
    expect(routeStaffMessage(words("today"), owner(null))).toEqual({ route: "desk", hat: OWNER_DEFAULT_HAT, save: "admin", note: "first", ask: { kind: "command", to: ["today", "school"], query: null } });
    expect(routeStaffMessage(words("today"), owner("accountant"))).toEqual({ route: "desk", hat: "accountant", save: undefined, note: null, ask: { kind: "command", to: ["today", "school"], query: null } });
    expect(routeStaffMessage(words("anything at all"), owner("teacher"))).toMatchObject({ route: "desk", hat: "teacher", ask: { kind: "text", text: "anything at all" } });
    expect(routeStaffMessage(words("try as office"), owner("teacher"))).toEqual({ route: "desk", hat: "office", save: "office", note: "switched", ask: { kind: "menu" } });
    // "staff" as a role on the owner's number is the admin's desk, kept as such.
    expect(routeStaffMessage(tap(roleButtonId("staff")), owner(null))).toEqual({ route: "desk", hat: "admin", save: "admin", note: "switched", ask: { kind: "menu" } });
    expect(routeStaffMessage(words("roles"), owner("teacher"))).toEqual({ route: "roles", current: "teacher" });
    expect(routeStaffMessage(tap(roleButtonId("list"), true), owner(null))).toEqual({ route: "roles", current: "admin" });
    expect(routeStaffMessage(words("as parent"), owner("teacher"))).toEqual({ route: "parent", save: "parent" });
  });

  it("an older button keeps the role it was sent under, and brings that role back", () => {
    expect(routeStaffMessage(tap(staffButtonId("dues", "accountant")), owner("teacher"))).toMatchObject({ route: "desk", hat: "accountant", save: "accountant", note: null });
    expect(routeStaffMessage(tap(staffButtonId("today", "teacher")), owner("teacher"))).toMatchObject({ route: "desk", hat: "teacher", save: undefined });
  });

  it("writing as a parent, the owner's words are the parents' helper's until a role is chosen", () => {
    for (const text of ["today", "fees", "hi", "When is the PTM?", "बकाया"]) expect(routeStaffMessage(words(text), owner("parent")), text).toEqual({ route: "pass" });
    expect(routeStaffMessage(words("staff"), owner("parent"))).toMatchObject({ route: "desk", hat: "admin", save: "admin", note: "switched" });
    expect(routeStaffMessage(words("try as teacher"), owner("parent"))).toMatchObject({ route: "desk", hat: "teacher", save: "teacher" });
    expect(routeStaffMessage(tap(staffButtonId("school", "office")), owner("parent"))).toMatchObject({ route: "desk", hat: "office", save: "office" });
    expect(routeStaffMessage(tap(staffButtonId("school")), owner("parent"))).toMatchObject({ route: "desk", hat: "admin", save: "admin" });
    expect(routeStaffMessage(words("roles"), owner("parent"))).toEqual({ route: "roles", current: "parent" });
  });

  it("ownerPassesAsParent says what routeStaffMessage would, before anything else is read", () => {
    const asks: StaffAsk[] = [
      ...["today", "fees", "hi", "staff", "roles", "try as accountant", "as parent", "When is the PTM?", "dues Rahul", "बकाया", "back to staff"].map(words),
      tap(staffButtonId("school", "office")),
      tap(staffButtonId("menu")),
      tap(roleButtonId("admin")),
      tap(roleButtonId("list")),
      tap("vpai:fees"),
      { kind: "none" },
    ];
    for (const hat of [...STAFF_HATS, null]) {
      for (const ask of asks) {
        const passes = routeStaffMessage(ask, owner(hat)).route === "pass";
        expect(ownerPassesAsParent(ask, hat), `${hat} ${JSON.stringify(ask)}`).toBe(hat === "parent" ? passes : false);
      }
    }
  });

  it("a linked member of staff: their own role for everything, until they write as a parent", () => {
    expect(routeStaffMessage(words("what is pending today"), linked())).toEqual({ route: "desk", hat: null, save: undefined, note: null, ask: { kind: "text", text: "what is pending today" } });
    expect(routeStaffMessage({ kind: "none" }, linked())).toEqual({ route: "desk", hat: null, save: undefined, note: null, ask: { kind: "none" } });
    expect(routeStaffMessage(words("as parent"), linked())).toEqual({ route: "parent", save: "parent" });
    expect(routeStaffMessage(words("try as accountant"), linked())).toEqual({ route: "desk", hat: null, save: undefined, note: "roles_owner_only", ask: { kind: "menu" } });
    expect(routeStaffMessage(words("roles"), linked())).toEqual({ route: "desk", hat: null, save: undefined, note: "roles_owner_only", ask: { kind: "menu" } });
    expect(routeStaffMessage(words("staff"), linked())).toMatchObject({ route: "desk", hat: null, save: undefined, note: null });

    const asParent = linked("parent");
    for (const text of ["my son is sick today", "today", "fees", "hi"]) expect(routeStaffMessage(words(text), asParent), text).toEqual({ route: "pass" });
    expect(routeStaffMessage({ kind: "none" }, asParent)).toEqual({ route: "pass" });
    expect(routeStaffMessage(words("staff"), asParent)).toEqual({ route: "desk", hat: null, save: null, note: "back", ask: { kind: "menu" } });
    expect(routeStaffMessage(tap(roleButtonId("staff")), asParent)).toEqual({ route: "desk", hat: null, save: null, note: "back", ask: { kind: "menu" } });
    expect(routeStaffMessage(tap(staffButtonId("today")), asParent)).toMatchObject({ route: "desk", save: null, note: null, ask: { kind: "command", to: ["today"] } });
    expect(routeStaffMessage(words("try as accountant"), asParent)).toMatchObject({ route: "desk", save: null, note: "roles_owner_only" });
  });

  it("a number on a staff record that never linked, or that stopped: only D-591's words and the staff buttons", () => {
    for (const kind of ["unproven", "stopped"] as const) {
      const expected: StaffRoute = { route: kind === "unproven" ? "link_first" : "stopped" };
      for (const ask of [words("today"), words("questions"), words("absent"), words("staff"), tap(staffButtonId("today")), tap(roleButtonId("parent"))]) {
        expect(routeStaffMessage(ask, { kind }), JSON.stringify(ask)).toEqual(expected);
      }
      for (const ask of [words("hi"), words("fees"), words("dues Rahul"), words("try as accountant"), words("When is the PTM?"), { kind: "none" } as StaffAsk]) {
        expect(routeStaffMessage(ask, { kind }), JSON.stringify(ask)).toEqual({ route: "pass" });
      }
    }
  });

  it("everybody else, and anybody's tap on a parent's button, is the parents' helper's", () => {
    for (const ask of [words("today"), words("try as accountant"), tap(staffButtonId("today"))]) expect(routeStaffMessage(ask, { kind: "none" })).toEqual({ route: "pass" });
    for (const who of [owner(null), owner("admin"), linked(), { kind: "unproven" } as StaffWho]) expect(routeStaffMessage(tap("vpai:fees"), who)).toEqual({ route: "pass" });
  });
});

/* ------------------------------------------------------------ each desk */

describe("what each role's desk offers", () => {
  it("each role has its own menu, by role and by permission, as on their screens", () => {
    const desks = Object.fromEntries(ROLES.map((role) => [role, deskCommands(deskSubjectOf(staffOf(role), NO_DESK))]));
    expect(desks).toEqual({
      admin: ["school", "collection", "dues", "staff_away", "cover", "leave", "questions"],
      office: ["school", "collection", "dues", "staff_away", "cover", "questions"],
      accountant: ["collection", "dues", "questions"],
      fee_collector: ["collection", "dues", "questions"],
      teacher: ["today", "absent", "questions"],
      academic_coordinator: ["school", "cover", "staff_away", "leave", "questions"],
      exam_coordinator: ["school", "staff_away", "questions"],
      view_only: ["staff_away"],
    });
    expect(deskOf("fee_collector")).toBe("accounts");
  });

  it("Needs you comes with deciding parents' suggestions; a teacher's own day and class with teaching", () => {
    expect(deskCommands(deskSubjectOf(staffOf("admin"), DECIDES))).toEqual(["school", "needs_you", "collection", "dues", "staff_away", "cover", "leave", "questions"]);
    expect(deskCommands(deskSubjectOf(staffOf("teacher"), CLASS_TEACHER))).toEqual(["today", "absent", "questions", "needs_you"]);
    expect(deskCommands(deskSubjectOf(staffOf("academic_coordinator", { isTeaching: true }), NO_DESK))).toEqual(["school", "cover", "staff_away", "leave", "today", "absent", "questions"]);
    expect(deskCommands(deskSubjectOf(staffOf("teacher", { isTeaching: false }), NO_DESK))).toEqual(["questions"]);
  });

  it("follows the matrix as it is now: a permission taken away takes its ask away, and teachers never see fees", () => {
    const office = staffOf("office", { permissions: permissionsFor("office").filter((permission) => permission !== "fees:view") });
    expect(deskCommands(deskSubjectOf(office, NO_DESK))).not.toContain("collection");
    const teacher = staffOf("teacher", { permissions: [...permissionsFor("teacher"), "fees:view"] });
    expect(deskCommands(deskSubjectOf(teacher, NO_DESK))).not.toContain("dues");
    // The admin is every permission, whatever a row says.
    expect(deskCommands(deskSubjectOf(staffOf("admin", { permissions: [] }), NO_DESK))).toContain("collection");
  });

  it("the first asked-for command the desk has, the menu, or nothing", () => {
    const teacher = deskCommands(deskSubjectOf(staffOf("teacher"), NO_DESK));
    expect(firstOnDesk(["school", "absent"], teacher)).toBe("absent");
    expect(firstOnDesk(["today", "school"], deskCommands(deskSubjectOf(staffOf("admin"), NO_DESK)))).toBe("school");
    expect(firstOnDesk(["collection", "dues"], teacher)).toBeNull();
    expect(firstOnDesk(["menu"], [])).toBe("menu");
    expect(firstOnDesk(["roles"], teacher)).toBe("roles");
  });
});

/* ------------------------------------------------------------ the menus */

describe("menus and answers inside WhatsApp's limits, in both languages", () => {
  it("every role's menu, for the owner and for staff, and the buttons under every answer", () => {
    for (const role of ROLES) {
      for (const language of ["en", "hi"] as const) {
        for (const owner of [true, false]) {
          const staff = staffOf(role, { language, name: "TEST Somebody With A Rather Long Name Indeed", isTeaching: true });
          const ctx = ctxOf(staff, { held: ["c6"], reader: { kind: "admin" } as never }, { ownerHat: owner ? role : null });
          const label = `${role}/${language}/${owner ? "owner" : "staff"}`;
          const menu = deskMenuReply(ctx, { owner, canWriteAsParent: !owner, note: firstHatNote({ language, hat: role, seatName: staff.name }) });
          expectWithinLimits(menu, label);
          expect(menu.kind === "list" && menu.rows.at(-1)!.id, label).toBe(owner ? roleButtonId("list") : roleButtonId("parent"));
          for (const current of [null, ...ctx.commands]) expectWithinLimits({ kind: "buttons", body: "x", buttons: deskButtons(ctx, current) }, `${label} after ${current}`);
        }
      }
    }
  });

  it("the owner's rows and buttons carry the role being tried; staff's carry none", () => {
    const accountant = ctxOf(staffOf("accountant"), NO_DESK, { ownerHat: "accountant" });
    expect(deskButtons(accountant, "collection").map((button) => button.id)).toEqual(["vpst:dues:accountant", "vpst:questions:accountant", "vpst:menu:accountant"]);
    const staff = ctxOf(staffOf("accountant"));
    expect(deskButtons(staff, "collection").map((button) => button.id)).toEqual(["vpst:dues", "vpst:questions", "vpst:menu"]);
    const menu = deskMenuReply(staff, { owner: false, canWriteAsParent: true });
    expect(bodyOf(menu)).toContain("Namaste, TEST accountant!");
    expect(bodyOf(menu)).toContain("🧪 Practice: TEST-2026-27 test records");
    const owner = deskMenuReply(accountant, { owner: true, canWriteAsParent: false });
    expect(bodyOf(owner)).toContain("You are trying the *Accountant* role (TEST accountant), on the practice records.");
    expect(bodyOf(owner)).toContain("To test as a parent, write *as parent*");
  });

  it("the role list, the parent's switch and the way back", () => {
    for (const language of ["en", "hi"] as const) {
      for (const current of STAFF_HATS) {
        const list = roleListReply({ language, helperName: "Veer Patta AI", current });
        expectWithinLimits(list, `roles/${language}/${current}`);
        expect(list.kind === "list" && list.rows.map((row) => row.id)).toEqual(STAFF_HATS.map((hat) => roleButtonId(hat)));
      }
      expectWithinLimits(ownerParentReply(language, "Veer Patta AI"), `ownerParent/${language}`);
      expectWithinLimits(staffParentReply(language, "Veer Patta AI"), `staffParent/${language}`);
    }
  });

  it("a line before an answer, said once", () => {
    const note = firstHatNote({ language: "en", hat: "admin", seatName: "TEST Admin" });
    expect(note).toBe("🔄 Your number is now answered as the *Admin* (TEST Admin, practice records). To test as a parent, write *as parent*; for another role, *roles*.");
    expect(firstHatNote({ language: "hi", hat: "teacher", seatName: "TEST Teacher" })).toContain("*शिक्षक* की तरह जवाब मिलता है");
    expect(withLeadNote({ kind: "text", text: "Body" }, note)).toEqual({ kind: "text", text: `${note}\n\nBody` });
    expect(withLeadNote({ kind: "buttons", body: "Body", buttons: [] }, note)).toMatchObject({ body: `${note}\n\nBody` });
    expect(withLeadNote({ kind: "text", text: "Body" }, null)).toEqual({ kind: "text", text: "Body" });
    const document: HelperMessage = { kind: "document", link: "https://x.test/r.pdf", filename: "r.pdf", caption: "Receipt" };
    expect(withLeadNote(document, note)).toBe(document);
  });

  it("an answer's own buttons give way to the desk's", () => {
    const ctx = ctxOf(staffOf("teacher"));
    expect(withDeskButtons({ kind: "text", text: "Hello" }, ctx, "today")).toEqual({
      kind: "buttons",
      body: "Hello",
      buttons: [
        { id: "vpst:absent", title: "📋 Absent" },
        { id: "vpst:questions", title: "📝 Questions" },
        { id: "vpst:menu", title: "☰ Menu" },
      ],
    });
  });
});

/* ------------------------------------------------------------ the answers */

describe("the new answers", () => {
  const admin = ctxOf(staffOf("admin"), DECIDES);
  const fees: FeeFacts = {
    day: DAY,
    today: { total: 12500, count: 3, byMode: [{ mode: "cash", total: 10000, count: 2 }, { mode: "online", total: 2500, count: 1 }] },
    lastDay: null,
    month: { total: 85000, count: 21 },
    session: { collected: 1250000, feesPending: 340000, latePending: 12000, withDues: 57, overdue: 31, lateOnly: 4, students: 120 },
    query: null,
    matchCount: 0,
    matches: [],
  };

  it("the school today: registers, the most absent, staff away and periods still without cover", () => {
    const body = bodyOf(
      schoolReply(
        {
          day: DAY,
          schoolOpen: true,
          timetableRuns: true,
          rows: [
            { label: "Class 6", recorded: true, roll: 41, present: 38, absent: 3, halfDay: 0 },
            { label: "Class 7", recorded: true, roll: 40, present: 30, absent: 9, halfDay: 1 },
            { label: "Class 8", recorded: false, roll: 39, present: 0, absent: 0, halfDay: 0 },
            { label: "Nursery", recorded: false, roll: 0, present: 0, absent: 0, halfDay: 0 },
          ],
          staffAway: 2,
          uncovered: [{ period: 3, classLabels: ["Class 8"] }],
        },
        admin,
      ),
    );
    expect(body).toContain("🏫 *School today · Thursday, 12 November*");
    expect(body).toContain("📋 *Registers:* 2 of 3 classes marked");
    expect(body).toContain("Present 68 · Absent 12 · Half day 1");
    expect(body).toContain("⏳ Not marked yet: Class 8");
    expect(body).toContain("Most absent: Class 7 (9), Class 6 (3)");
    expect(body).toContain("🧑‍🏫 Staff away: 2");
    expect(body).toContain("🔁 Periods still without cover (1): P4 Class 8");
    expect(body).toContain(`${ORIGIN}/dashboard`);
    const closed = bodyOf(schoolReply({ day: DAY, schoolOpen: false, timetableRuns: false, rows: [], staffAway: 0, uncovered: [] }, admin));
    expect(closed).toContain("🏠 School is closed today.");
    const unread = bodyOf(schoolReply({ day: DAY, schoolOpen: true, timetableRuns: true, rows: [], staffAway: null, uncovered: null }, admin));
    expect(unread).toContain("Staff away: could not be read just now");
    expect(unread).toContain("Cover: could not be read just now");
  });

  it("staff away, cover and leave asked", () => {
    expect(bodyOf(staffAwayReply({ day: DAY, periodCount: 8, absences: [] }, admin))).toContain("✅ Nobody on staff is away today.");
    const away = bodyOf(
      staffAwayReply(
        {
          day: DAY,
          periodCount: 8,
          absences: [
            { staffName: "TEST Teacher Two", periods: [] },
            { staffName: "TEST Teacher Three", periods: [0, 1, 2, 5] },
            { staffName: "TEST Teacher Four", periods: [4] },
          ],
        },
        admin,
      ),
    );
    expect(away).toContain("3 away today:");
    expect(away).toContain("• TEST Teacher Two (full day)");
    expect(away).toContain("• TEST Teacher Three (periods 1–3, 6)");
    expect(away).toContain("• TEST Teacher Four (period 5)");
    expect(away).toContain("tap *Cover*");

    const cover = bodyOf(
      coverReply(
        {
          day: DAY,
          duties: [
            { period: 2, classLabels: ["Class 8"], absentNames: ["TEST Teacher Two"], substituteName: null, status: "needs_help" },
            { period: 0, classLabels: ["Class 6"], absentNames: ["TEST Teacher Two"], substituteName: "TEST Teacher Five", status: "assigned" },
          ],
        },
        admin,
      ),
    );
    expect(cover).toContain("⚠️ *Still need cover (1)*\n• P3 · Class 8 (for TEST Teacher Two)");
    expect(cover).toContain("✅ *Arranged (1)*\n• P1 · Class 6 → TEST Teacher Five");
    expect(bodyOf(coverReply({ day: DAY, duties: [] }, admin))).toContain("✅ No period needs cover today.");

    const leave = bodyOf(
      leaveReply(
        [
          { staffName: "TEST Teacher Three", fromDay: DAY, toDay: DAY, span: "first_half" },
          { staffName: "TEST Teacher Six", fromDay: "2026-11-13", toDay: "2026-11-14", span: "full_day" },
        ],
        admin,
      ),
    );
    expect(leave).toContain("2 waiting for a decision:");
    expect(leave).toContain("• TEST Teacher Three · 12 November (first half)");
    expect(leave).toContain("• TEST Teacher Six · 13 November – 14 November");
    expect(leave).toContain(`${ORIGIN}/inbox`);
    expect(bodyOf(leaveReply([], admin))).toContain("✅ No leave is waiting for a decision.");
  });

  it("Needs you: how many wait, the oldest as One words them, and where to decide", () => {
    const items = [{ title: { en: "TEST Child Two, away today", hi: "TEST Child Two, आज छुट्टी" }, line: { en: "The parent says: fever", hi: "अभिभावक: बुखार" }, urgent: true }];
    const body = bodyOf(needsYouReply({ count: 3, items, classTeacher: false }, admin));
    expect(body).toContain("3 waiting for your decision. Nothing a parent says changes a record until you approve it:");
    expect(body).toContain("🔴 *TEST Child Two, away today*");
    expect(body).toContain("…and 2 more");
    expect(body).toContain(`${ORIGIN}/inbox`);
    expect(bodyOf(needsYouReply({ count: 1, items, classTeacher: true }, ctxOf(staffOf("teacher"), CLASS_TEACHER)))).toContain(`${ORIGIN}/teach`);
    expect(bodyOf(needsYouReply({ count: 0, items: [], classTeacher: false }, admin))).toContain("No parent's suggestion is waiting for your decision.");
  });

  it("collection: today by mode, the month and the year; a write-off is never collection", () => {
    const body = bodyOf(collectionReply(fees, ctxOf(staffOf("accountant"))));
    expect(body).toContain("*Today:* ₹12,500 (3 receipts)");
    expect(body).toContain("Cash ₹10,000 · UPI (Razorpay) ₹2,500");
    expect(body).toContain("*This month:* ₹85,000 (21 receipts)");
    expect(body).toContain("*This year:* ₹12,50,000");
    expect(body).toContain("📒 Fees still due: ₹3,40,000 (57 students)");
    expect(body).toContain("a write-off is not counted as collection");
    const quiet = bodyOf(collectionReply({ ...fees, today: { total: 0, count: 0, byMode: [] }, lastDay: { day: "2026-11-11", total: 4000, count: 1 } }, ctxOf(staffOf("accountant"))));
    expect(quiet).toContain("*Today:* nothing collected yet");
    expect(quiet).toContain("Last on 11 November: ₹4,000 (1 receipt)");
  });

  it("dues: fees and late fees apart, and a late fee alone is never a defaulter", () => {
    const body = bodyOf(duesReply(fees, ctxOf(staffOf("accountant"))));
    expect(body).toContain("Fees still due: *₹3,40,000*");
    expect(body).toContain("57 students owe fees; 31 have an instalment past due.");
    expect(body).toContain("Late fees, separately: ₹12,000 (4 owe only a late fee; they are not defaulters)");
    expect(body).toContain("*dues Rahul*");
  });

  it("one child's dues by name: each match, or none", () => {
    const one = duesReply(
      {
        ...fees,
        query: "test child",
        matchCount: 6,
        matches: Array.from({ length: 5 }, (_, i) => ({
          admissionNo: `TEST-${i}`,
          name: `TEST Child ${i}`,
          classLabel: "Class 6",
          status: i === 0 ? "left" : "active",
          feesPending: i === 1 ? 0 : 3000,
          latePending: i === 2 ? 1000 : 0,
          totalPaid: 2000,
          lastPaymentDate: "2026-08-01",
          lastPaymentAmount: 2000,
          overdueInstallments: i === 3 ? 2 : 0,
          nextDueDate: "2027-01-20",
          nextDueAmount: 3000,
        })),
      },
      ctxOf(staffOf("accountant")),
    );
    const body = bodyOf(one);
    expect(body).toContain('📒 *Fees for "test child"*');
    expect(body).toContain("👤 *TEST Child 0* · Class 6 · SR TEST-0");
    expect(body).toContain("Status: left");
    expect(body).toContain("Fees: all paid ✅");
    expect(body).toContain("Late fee, separately: ₹1,000");
    expect(body).toContain("⚠️ 2 instalments past due");
    expect(body).toContain("Next: ₹3,000 on 20 January");
    expect(body).not.toContain("TEST Child 4");
    expect(body).toContain("6 students match; the first 4 are above.");
    expectWithinLimits(fitMessage(one), "dues by name");
    expect(bodyOf(duesReply({ ...fees, query: "nobody", matchCount: 0, matches: [] }, ctxOf(staffOf("accountant"))))).toContain("No student by that name or SR number.");
  });

  it("a real year's fees send the reader to One", () => {
    const real = ctxOf(staffOf("accountant", { isTest: false }));
    expect(bodyOf(feesElsewhereReply(real, "collection"))).toContain(`${ORIGIN}/accounts`);
    expect(bodyOf(feesElsewhereReply(real, "dues"))).toContain(`${ORIGIN}/dues`);
    expect(bodyOf(feesElsewhereReply({ ...real, language: "hi" }, "dues"))).toContain("Fees ऐप");
  });

  it("every answer fits, in both languages, with long names", () => {
    const long = "TEST Somebody With A Very Long Name Indeed, Really";
    for (const language of ["en", "hi"] as const) {
      const ctx = { ...admin, language };
      for (const message of [
        schoolReply({ day: DAY, schoolOpen: true, timetableRuns: true, rows: Array.from({ length: 40 }, (_, i) => ({ label: `Class ${i} ${long}`, recorded: i % 2 === 0, roll: 40, present: 30, absent: 10, halfDay: 0 })), staffAway: 9, uncovered: Array.from({ length: 20 }, (_, i) => ({ period: i % 8, classLabels: [`Class ${i}`] })) }, ctx),
        staffAwayReply({ day: DAY, periodCount: 8, absences: Array.from({ length: 30 }, (_, i) => ({ staffName: `${long} ${i}`, periods: [i % 8] })) }, ctx),
        coverReply({ day: DAY, duties: Array.from({ length: 30 }, (_, i) => ({ period: i % 8, classLabels: [`Class ${i}`], absentNames: [long], substituteName: long, status: i % 2 ? ("assigned" as const) : ("needs_help" as const) })) }, ctx),
        leaveReply(Array.from({ length: 20 }, (_, i) => ({ staffName: `${long} ${i}`, fromDay: DAY, toDay: "2026-11-20", span: "full_day" })), ctx),
        collectionReply(fees, ctx),
        duesReply(fees, ctx),
      ]) {
        // A long card goes as plain text, whole; either way, nothing is refused.
        expectWithinLimits(fitMessage(message), `${language} ${bodyOf(message).slice(0, 30)}`);
      }
    }
  });
});

/* ------------------------------------------------------ figures and seats */

describe("the fee figures and the practice seats", () => {
  it("reads the database's fee figures, and nothing that is not that shape", () => {
    const facts = feeFactsFrom({
      day: "2026-11-12",
      today: { total: "12500.00", count: 3, by_mode: [{ mode: "cash", total: 10000, count: 2 }] },
      last_day: { day: "2026-11-11", total: 4000, count: 1 },
      month: { total: 85000, count: 21 },
      session: { collected: 1250000, fees_pending: 340000, late_pending: 12000, with_dues: 57, overdue: 31, late_only: 4, students: 120 },
      query: "rahul",
      match_count: 1,
      matches: [
        {
          admission_no: "TEST-1",
          name: "TEST Rahul",
          class_label: "Class 6",
          status: "active",
          fees_pending: 3000,
          late_pending: 0,
          total_paid: 2000,
          last_payment_date: "2026-08-01T00:00:00",
          last_payment_amount: null,
          overdue_installments: 0,
          next_due_date: null,
          next_due_amount: null,
        },
      ],
    });
    expect(facts).toMatchObject({
      day: "2026-11-12",
      today: { total: 12500, count: 3, byMode: [{ mode: "cash", total: 10000, count: 2 }] },
      lastDay: { day: "2026-11-11", total: 4000, count: 1 },
      session: { feesPending: 340000, lateOnly: 4 },
      query: "rahul",
      matches: [{ admissionNo: "TEST-1", lastPaymentDate: "2026-08-01", lastPaymentAmount: null, nextDueAmount: null }],
    });
    expect(feeFactsFrom(null)).toBeNull();
    expect(feeFactsFrom({ day: "yesterday" })).toBeNull();
    expect(feeFactsFrom({ day: "2026-11-12" })).toMatchObject({ today: { total: 0, byMode: [] }, lastDay: null, matches: [] });
  });

  it("the practice seat: a class teacher first, then the day-run account, then a named one before a Smoke Lab one", () => {
    const seats = [
      { id: "b", displayName: "Smoke Lab Teacher" },
      { id: "a", displayName: "TEST Teacher Zed" },
      { id: "c", displayName: "TEST Teacher Amy" },
      { id: "d", displayName: "TEST Teacher Bob" },
    ];
    expect(pickPracticeSeat(seats, [])?.id).toBe("c");
    expect(pickPracticeSeat(seats, ["d"])?.id).toBe("d");
    expect(pickPracticeSeat(seats, ["d"], new Set(["a"]))?.id).toBe("a");
    expect(pickPracticeSeat(seats.slice(0, 1), [])?.id).toBe("b");
    expect(pickPracticeSeat([], ["d"])).toBeNull();
    // The same answer whatever order the database gives them in.
    expect(pickPracticeSeat([...seats].reverse(), [])?.id).toBe("c");
  });

  it("the day cap: forty for a number, two hundred for the owner's test number", () => {
    expect(dailyTurnCap(false)).toBe(MAX_TURNS_PER_NUMBER_PER_DAY);
    expect(MAX_TURNS_PER_NUMBER_PER_DAY).toBe(40);
    expect(dailyTurnCap(true)).toBe(OWNER_TURNS_PER_DAY);
    expect(OWNER_TURNS_PER_DAY).toBe(200);
  });
});

/* ---------------------------------------------------------- Claude's reading */

describe("what Claude may choose for typed words", () => {
  it("every desk ask, a parent's message, or unclear", () => {
    for (const command of STAFF_COMMANDS) expect(UNDERSTOOD_ASKS).toContain(command);
    expect(UNDERSTOOD_ASKS).toContain("parent");
    expect(UNDERSTOOD_ASKS).toContain("unclear");
  });

  it("a student's name only when the message has it", () => {
    expect(readUnderstanding({ ask: "dues", student: "Rahul" }, "rahul ki fees kitni hai")).toEqual({ kind: "command", command: "dues", query: "Rahul" });
    expect(readUnderstanding({ ask: "dues", student: "Rohan" }, "rahul ki fees kitni hai")).toEqual({ kind: "command", command: "dues", query: null });
    expect(readUnderstanding({ ask: "collection", student: "Rahul" }, "rahul")).toEqual({ kind: "command", command: "collection", query: null });
    expect(readUnderstanding({ ask: "parent", student: null }, "x")).toEqual({ kind: "parent" });
    expect(readUnderstanding({ ask: "unclear", student: null }, "x")).toEqual({ kind: "unclear" });
  });

  it("is shown the words, the role and the desk's asks, and nothing about anybody", () => {
    const prompt = staffUnderstandSystemPrompt("Veer Patta AI");
    for (const command of STAFF_COMMANDS) expect(prompt).toContain(`- ${command}:`);
    expect(prompt).toContain("You never answer the message yourself");
    const text = staffUnderstandUserText({ role: "accountant", commands: ["collection", "dues"], owner: false, text: "x".repeat(900) });
    expect(text).toContain("Their role: accountant");
    expect(text).toContain("On their desk: collection, dues");
    expect(text).toContain("The testing number (may try other roles): no");
    expect(text.length).toBeLessThan(700);
  });
});

/* ------------------------------------------------------- the reads behind it */

type Row = Record<string, unknown>;

/** Just enough of the Supabase client for these reads; `failing` tables answer an error. */
function fakeDb(tables: Record<string, Row[]>, options: { failing?: string[]; rpc?: (name: string, args: Row) => { data: unknown; error: unknown } } = {}) {
  const writes: Array<{ table: string; row: Row; options: unknown }> = [];
  const query = (table: string) => {
    const tests: Array<(row: Row) => boolean> = [];
    let limit = Number.POSITIVE_INFINITY;
    const run = () => {
      if (options.failing?.includes(table)) return { data: null, error: { message: "down" } };
      return { data: (tables[table] ?? []).filter((row) => tests.every((test) => test(row))).slice(0, limit), error: null };
    };
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        tests.push((row) => row[column] === value);
        return chain;
      },
      in: (column: string, values: readonly unknown[]) => {
        tests.push((row) => values.includes(row[column]));
        return chain;
      },
      not: (column: string, _operator: string, value: unknown) => {
        tests.push((row) => (row[column] ?? null) !== value);
        return chain;
      },
      limit: (count: number) => {
        limit = count;
        return chain;
      },
      returns: () => chain,
      maybeSingle: async () => {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error };
      },
      upsert: async (row: Row, upsertOptions: unknown) => {
        if (options.failing?.includes(table)) return { error: { message: "down" } };
        writes.push({ table, row, options: upsertOptions });
        return { error: null };
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  };
  const db = {
    from: (table: string) => query(table),
    rpc: async (name: string, args: Row) => (options.rpc ? options.rpc(name, args) : { data: null, error: { message: "no rpc" } }),
  };
  return { db: db as never, writes };
}

describe("the chat's role", () => {
  const FROM = "+919000000001";

  it("reads the role a chat is answered as; anything else is none", async () => {
    expect(await readStaffHat(FROM, fakeDb({ parent_helper_chats: [{ from_e164: FROM, hat: "accountant" }] }).db)).toBe("accountant");
    expect(await readStaffHat(FROM, fakeDb({ parent_helper_chats: [{ from_e164: FROM, hat: "principal" }] }).db)).toBeNull();
    expect(await readStaffHat(FROM, fakeDb({ parent_helper_chats: [] }).db)).toBeNull();
    expect(await readStaffHat(FROM, fakeDb({}, { failing: ["parent_helper_chats"] }).db)).toBeNull();
  });

  it("a new role lets go of what the other side of the chat was waiting for", async () => {
    const { db, writes } = fakeDb({});
    await saveStaffHat(FROM, "parent", new Date("2026-11-12T06:30:00Z"), db);
    expect(writes).toEqual([
      {
        table: "parent_helper_chats",
        row: { from_e164: FROM, hat: "parent", awaiting: null, awaiting_until: null, updated_at: "2026-11-12T06:30:00.000Z" },
        options: { onConflict: "from_e164" },
      },
    ]);
    await expect(saveStaffHat(FROM, null, new Date(), fakeDb({}, { failing: ["parent_helper_chats"] }).db)).rejects.toThrow("Could not save the chat's role");
  });
});

describe("the owner's practice seats", () => {
  const ACCOUNTANT_SEAT = accountForAlias("accountant")!.staffProfileId!;
  const profile = (id: string, role: StaffRole, over: Row = {}): Row => ({
    id,
    user_id: `u-${id}`,
    display_name: `TEST ${id}`,
    short_name: null,
    role,
    is_teaching: role === "teacher",
    is_test_account: true,
    is_active: true,
    ...over,
  });
  const grants = (role: StaffRole) => permissionsFor(role).map((permission) => ({ role, permission }));

  it("a test account with a sign-in in that role, with the role's permissions now and the owner's language", async () => {
    const { db } = fakeDb({
      staff_profiles: [
        profile("x-real", "accountant", { is_test_account: false }),
        profile("x-left", "accountant", { is_active: false }),
        profile("x-nologin", "accountant", { user_id: null }),
        profile("a-other", "accountant"),
        profile(ACCOUNTANT_SEAT, "accountant", { display_name: "QA Accountant" }),
        profile("t-1", "teacher"),
      ],
      role_permissions: [...grants("accountant"), ...grants("teacher")],
    });
    expect(await readPracticeSeat("accountant", "hi", DAY, db)).toEqual({
      staffId: ACCOUNTANT_SEAT,
      userId: `u-${ACCOUNTANT_SEAT}`,
      name: "QA Accountant",
      role: "accountant",
      isTest: true,
      language: "hi",
      permissions: [...permissionsFor("accountant")],
      isTeaching: false,
    });
  });

  it("never a real person, never one who left, never one without a sign-in", async () => {
    const { db } = fakeDb({
      staff_profiles: [profile("x-real", "office", { is_test_account: false }), profile("x-left", "office", { is_active: false }), profile("x-nologin", "office", { user_id: null })],
      role_permissions: grants("office"),
    });
    expect(await readPracticeSeat("office", "en", DAY, db)).toBeNull();
  });

  it("a teacher seat that holds a class today comes first", async () => {
    const tables = {
      staff_profiles: [profile("t-1", "teacher"), profile("t-2", "teacher"), profile("t-3", "teacher")],
      role_permissions: grants("teacher"),
      class_teachers: [
        { staff_profile_id: "t-2", effective_from: "2026-04-01", effective_to: "2026-10-31" },
        { staff_profile_id: "t-3", effective_from: "2026-04-01", effective_to: null },
      ],
    };
    expect((await readPracticeSeat("teacher", "en", DAY, fakeDb(tables).db))?.staffId).toBe("t-3");
    // Unreadable: still a seat, by the usual order.
    expect((await readPracticeSeat("teacher", "en", DAY, fakeDb(tables, { failing: ["class_teachers"] }).db))?.staffId).toBe("t-1");
  });

  it("an unreadable profile or permission read is no seat", async () => {
    const tables = { staff_profiles: [profile("a-1", "accountant")], role_permissions: grants("accountant") };
    expect(await readPracticeSeat("accountant", "en", DAY, fakeDb(tables, { failing: ["staff_profiles"] }).db)).toBeNull();
    expect(await readPracticeSeat("accountant", "en", DAY, fakeDb(tables, { failing: ["role_permissions"] }).db)).toBeNull();
  });
});

describe("the desk read and the fee figures", () => {
  it("the classes they hold today, in their year", async () => {
    const { db } = fakeDb({
      class_teachers: [
        { staff_profile_id: "t-1", session_label: "TEST-2026-27", class_id: "c6", effective_from: "2026-04-01", effective_to: null },
        { staff_profile_id: "t-1", session_label: "TEST-2026-27", class_id: "c7", effective_from: "2026-04-01", effective_to: "2026-10-31" },
        { staff_profile_id: "t-1", session_label: "2026-27", class_id: "c8", effective_from: "2026-04-01", effective_to: null },
        { staff_profile_id: "t-2", session_label: "TEST-2026-27", class_id: "c9", effective_from: "2026-04-01", effective_to: null },
      ],
    });
    const desk = await readDesk(staffOf("teacher", { staffId: "t-1" }), "TEST-2026-27", DAY, db);
    expect(desk?.held).toEqual(["c6"]);
    expect(await readDesk(staffOf("teacher"), "TEST-2026-27", DAY, fakeDb({}, { failing: ["class_teachers"] }).db)).toBeNull();
  });

  it("fee figures come from the database for a TEST year only; a real year's are the Fees app's", async () => {
    const calls: Array<[string, Row]> = [];
    const { db } = fakeDb({}, { rpc: (name, args) => (calls.push([name, args]), { data: { day: DAY, today: { total: 100, count: 1 } }, error: null }) });
    expect(await readFeeFigures("TEST-2026-27", DAY, "rahul", db)).toMatchObject({ day: DAY, today: { total: 100, count: 1 } });
    expect(calls).toEqual([["staff_helper_fees", { p_session_label: "TEST-2026-27", p_day: DAY, p_query: "rahul" }]]);
    expect(await readFeeFigures("2026-27", DAY, null, db)).toBe("elsewhere");
    expect(calls).toHaveLength(1);
    expect(await readFeeFigures("TEST-2026-27", DAY, null, fakeDb({}, { rpc: () => ({ data: null, error: null }) }).db)).toBe("elsewhere");
    expect(await readFeeFigures("TEST-2026-27", DAY, null, fakeDb({}, { rpc: () => ({ data: null, error: { message: "down" } }) }).db)).toBeNull();
  });
});
