import { can, readsEveryClass, type StaffPermission, type StaffRole } from "@/platform/auth/permissions";
import { dayLabel, weekdayLabel } from "@/platform/dates";
import { formatInr } from "@/platform/helpers/currency";

import { oneLine, type StaffLanguage } from "./helper-handoff";
import type { HelperButton, HelperMessage, HelperRow } from "./helper-messages";
import type { SuggestionReader } from "./parent-suggestions";
import type { StaffContext } from "./staff-helper";
import { roleButtonId, staffButtonId, STAFF_HATS, type StaffCommand, type StaffHat } from "./staff-words";

/**
 * Veer Patta AI's desks (D-607): what each member of staff is offered on
 * WhatsApp, by their role, and the answers that are new with it. A number
 * that belongs to the accountant gets the accountant's menu (collection,
 * dues), a teacher's gets a teacher's (their day, their class), the admin's
 * gets the school's. The menu is a WhatsApp list; every answer ends with the
 * desk's next two asks and the menu as buttons.
 *
 * What a desk shows is decided twice: by role here (the order, and what
 * belongs on it), and by permission (`can()`, as on their screens) in the
 * subject the data layer passes in. Nothing on a desk writes anything: a
 * decision is taken in One, and every answer links to the screen for it.
 *
 * Pure: words and rules only. The reads are in `data/staff-helper.ts`.
 */

type Pair = { hi: string; en: string };

const say = (language: StaffLanguage, words: Pair): string => words[language];

/** Which menu a role gets. */
export type StaffDesk = "admin" | "office" | "accounts" | "teacher" | "coordinator" | "exams" | "viewer";

export function deskOf(role: StaffRole): StaffDesk {
  switch (role) {
    case "admin":
      return "admin";
    case "office":
      return "office";
    case "accountant":
    case "fee_collector":
      return "accounts";
    case "teacher":
      return "teacher";
    case "academic_coordinator":
      return "coordinator";
    case "exam_coordinator":
      return "exams";
    case "view_only":
      return "viewer";
  }
}

/** Each desk's asks, in the order its menu shows them. */
const DESK_ORDER: Record<StaffDesk, readonly StaffCommand[]> = {
  admin: ["school", "needs_you", "collection", "dues", "staff_away", "cover", "leave", "questions", "today", "absent"],
  office: ["school", "needs_you", "collection", "dues", "staff_away", "cover", "questions", "today", "absent"],
  accounts: ["collection", "dues", "needs_you", "questions"],
  teacher: ["today", "absent", "questions", "needs_you"],
  coordinator: ["school", "cover", "staff_away", "leave", "needs_you", "today", "absent", "questions"],
  exams: ["school", "today", "absent", "staff_away", "questions"],
  viewer: ["school", "staff_away"],
};

/** Who a desk is for, as the checks on their screens see them. */
export type DeskSubject = {
  role: StaffRole;
  /** `can()` against their role's permissions now. */
  can: (permission: StaffPermission) => boolean;
  /** `readsEveryClass()`: the school-wide roles. */
  readsEveryClass: boolean;
  /** They teach (`is_teaching`): their own day and class. */
  teaches: boolean;
  /** They decide some of the parents' suggestions (Needs you, or their class's absences). */
  decidesSuggestions: boolean;
};

function offered(command: StaffCommand, subject: DeskSubject): boolean {
  switch (command) {
    case "menu":
    case "roles":
      return false;
    case "today":
      return subject.teaches;
    case "absent":
      return subject.teaches && subject.can("attendance:view");
    case "questions":
      return subject.role !== "view_only";
    case "needs_you":
      return subject.decidesSuggestions;
    case "school":
      return subject.readsEveryClass && subject.can("dashboard:view");
    case "staff_away":
      return true;
    case "cover":
      return subject.can("substitutions:view");
    case "leave":
      return subject.can("substitutions:manage");
    case "collection":
    case "dues":
      return subject.can("fees:view");
  }
}

/** Who a staff answer is for: the person a number belongs to, or the test account the owner's number is trying (D-607). */
export type LinkedStaff = {
  staffId: string;
  /** Their sign-in, so the reads that check a person check them as their screens do; null when they have none. */
  userId: string | null;
  name: string;
  role: StaffRole;
  /** A test account, or every account on a confined deployment. */
  isTest: boolean;
  language: StaffLanguage;
  /** The role's permissions from the matrix (Staff → Roles), as on their screens. */
  permissions: string[];
  /** They teach (`is_teaching`): their own day and class are on their desk. */
  isTeaching: boolean;
};

/** What the desk needs to know beyond the role: the classes they hold today, and who they are to parents' suggestions. */
export type DeskRead = { held: readonly string[]; reader: SuggestionReader | null };

export function deskSubjectOf(staff: LinkedStaff, desk: DeskRead): DeskSubject {
  const subject = { role: staff.role, permissions: staff.permissions };
  return {
    role: staff.role,
    can: (permission) => can(subject, permission),
    readsEveryClass: readsEveryClass(subject),
    teaches: staff.isTeaching,
    decidesSuggestions: desk.reader !== null || desk.held.length > 0,
  };
}

/** The asks on this person's desk, in their menu's order. */
export function deskCommands(subject: DeskSubject): StaffCommand[] {
  return DESK_ORDER[deskOf(subject.role)].filter((command) => offered(command, subject));
}

/** The first of the asked-for commands this desk has, or null. */
export function firstOnDesk(to: readonly StaffCommand[], commands: readonly StaffCommand[]): StaffCommand | null {
  return to.find((command) => command === "menu" || command === "roles" || commands.includes(command)) ?? null;
}

/* ------------------------------------------------------------- the words */

type Ask = Exclude<StaffCommand, "menu" | "roles">;

const ASKS: Record<Ask, { button: Pair; row: Pair; about: Pair }> = {
  today: {
    button: { hi: "📅 आज", en: "📅 Today" },
    row: { hi: "📅 मेरा दिन", en: "📅 My day" },
    about: { hi: "आज के मेरे पीरियड, सबस्टिट्यूशन और छुट्टी", en: "My periods, cover and leave today" },
  },
  questions: {
    button: { hi: "📝 सवाल", en: "📝 Questions" },
    row: { hi: "📝 अभिभावकों के सवाल", en: "📝 Parents' questions" },
    about: { hi: "जो अभिभावक मेरे जवाब की राह देख रहे हैं", en: "Parents waiting for my answer" },
  },
  absent: {
    button: { hi: "📋 अनुपस्थित", en: "📋 Absent" },
    row: { hi: "📋 मेरी कक्षा आज", en: "📋 My class today" },
    about: { hi: "आज मेरी कक्षा में कौन नहीं आया", en: "Who is absent in my class today" },
  },
  needs_you: {
    button: { hi: "✅ फ़ैसले", en: "✅ Needs you" },
    row: { hi: "✅ मेरे फ़ैसले", en: "✅ Needs you" },
    about: { hi: "अभिभावकों के सुझाव जो मेरे फ़ैसले की राह देख रहे हैं", en: "Parents' suggestions waiting for my decision" },
  },
  school: {
    button: { hi: "🏫 स्कूल आज", en: "🏫 School today" },
    row: { hi: "🏫 स्कूल आज", en: "🏫 School today" },
    about: { hi: "हाज़िरी, छुट्टी पर स्टाफ़, बिना सबस्टिट्यूशन के पीरियड", en: "Registers, staff away, periods still without cover" },
  },
  staff_away: {
    button: { hi: "🧑‍🏫 छुट्टी पर", en: "🧑‍🏫 Staff away" },
    row: { hi: "🧑‍🏫 छुट्टी पर स्टाफ़", en: "🧑‍🏫 Staff away today" },
    about: { hi: "आज कौन-सा स्टाफ़ छुट्टी पर है", en: "Which staff are away today" },
  },
  cover: {
    button: { hi: "🔁 सबस्टिट्यूशन", en: "🔁 Cover" },
    row: { hi: "🔁 आज की सबस्टिट्यूशन", en: "🔁 Cover today" },
    about: { hi: "कौन किसके पीरियड ले रहा है, और कौन-से अभी खाली हैं", en: "Who is taking whose period, and which still need cover" },
  },
  leave: {
    button: { hi: "🌴 छुट्टी अर्ज़ी", en: "🌴 Leave asked" },
    row: { hi: "🌴 छुट्टी की अर्ज़ियाँ", en: "🌴 Leave asked" },
    about: { hi: "छुट्टी की अर्ज़ियाँ जिन पर अभी फ़ैसला नहीं हुआ", en: "Leave asked and not yet decided" },
  },
  collection: {
    button: { hi: "💰 फ़ीस जमा", en: "💰 Collection" },
    row: { hi: "💰 फ़ीस जमा", en: "💰 Fee collection" },
    about: { hi: "आज, इस महीने और इस साल कितनी फ़ीस जमा हुई", en: "Fees collected today, this month and this year" },
  },
  dues: {
    button: { hi: "📒 बकाया", en: "📒 Dues" },
    row: { hi: "📒 बकाया फ़ीस", en: "📒 Fees due" },
    about: { hi: "कितनी फ़ीस बाकी है; किसी बच्चे का नाम लिखें तो उसकी", en: "Fees still to come; write a child's name for theirs" },
  },
};

const HAT_WORDS: Record<StaffHat, { name: Pair; icon: string; about: Pair }> = {
  admin: { name: { hi: "एडमिन", en: "Admin" }, icon: "👑", about: { hi: "पूरा स्कूल, फ़ैसले, फ़ीस, स्टाफ़", en: "The whole school, decisions, fees, staff" } },
  office: { name: { hi: "ऑफ़िस", en: "Office" }, icon: "🗂️", about: { hi: "स्कूल आज, फ़ैसले, फ़ीस देखना, सबस्टिट्यूशन", en: "School today, decisions, fees to look at, cover" } },
  accountant: { name: { hi: "अकाउंटेंट", en: "Accountant" }, icon: "💰", about: { hi: "फ़ीस जमा, बकाया, फ़ीस के सवाल", en: "Collection, dues, parents' fee questions" } },
  fee_collector: { name: { hi: "फ़ीस कलेक्टर", en: "Fee collector" }, icon: "🧾", about: { hi: "फ़ीस जमा और बकाया", en: "Collection and dues" } },
  teacher: { name: { hi: "शिक्षक", en: "Teacher" }, icon: "🧑‍🏫", about: { hi: "मेरा दिन, मेरी कक्षा, अभिभावकों के सवाल", en: "My day, my class, parents' questions" } },
  academic_coordinator: {
    name: { hi: "अकादमिक कोऑर्डिनेटर", en: "Academic coordinator" },
    icon: "📚",
    about: { hi: "स्कूल आज, सबस्टिट्यूशन, छुट्टी की अर्ज़ियाँ", en: "School today, cover, leave asked" },
  },
  exam_coordinator: { name: { hi: "परीक्षा कोऑर्डिनेटर", en: "Exam coordinator" }, icon: "📝", about: { hi: "स्कूल आज, अपना दिन", en: "School today, own day" } },
  view_only: { name: { hi: "व्यूअर", en: "Viewer" }, icon: "👁️", about: { hi: "आज छुट्टी पर स्टाफ़, केवल देखना", en: "Staff away today, look only" } },
  parent: { name: { hi: "अभिभावक", en: "Parent" }, icon: "👪", about: { hi: "अभ्यास परिवार के अभिभावक की तरह लिखें", en: "Write as the practice family's parent" } },
};

/** "Accountant" / "अकाउंटेंट". */
export function hatName(hat: StaffHat, language: StaffLanguage): string {
  return say(language, HAT_WORDS[hat].name);
}

/** Everything a desk's answer needs about who it is for. */
export type DeskContext = StaffContext & {
  role: StaffRole;
  /** The desk's asks, in order (from `deskCommands`). */
  commands: readonly StaffCommand[];
  /** On the owner's number: the role being tried, carried on every button so an old one still answers as it did. */
  ownerHat: StaffHat | null;
};

function practiceLine(ctx: StaffContext): string | null {
  if (!ctx.practice) return null;
  return say(ctx.language, { hi: `🧪 अभ्यास: ${ctx.sessionLabel} के परीक्षण रिकॉर्ड`, en: `🧪 Practice: ${ctx.sessionLabel} test records` });
}

function compose(lines: readonly (string | null)[]): string {
  return lines
    .filter((line): line is string => line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function dayWords(day: string, language: StaffLanguage): string {
  return `${weekdayLabel(day)[language]}, ${dayLabel(day)[language]}`;
}

function shortDay(day: string, language: StaffLanguage): string {
  return dayLabel(day)[language];
}

/** The menu button, under every answer. */
function menuButton(ctx: DeskContext): HelperButton {
  return { id: staffButtonId("menu", ctx.ownerHat), title: say(ctx.language, { hi: "☰ मेनू", en: "☰ Menu" }) };
}

/** The desk's next two asks (not the one just answered) and the menu. */
export function deskButtons(ctx: DeskContext, current: StaffCommand | null): HelperButton[] {
  const next = ctx.commands.filter((command): command is Ask => command !== current && command !== "menu" && command !== "roles").slice(0, 2);
  return [...next.map((command) => ({ id: staffButtonId(command, ctx.ownerHat), title: say(ctx.language, ASKS[command].button) })), menuButton(ctx)];
}

/** Any staff answer with this desk's buttons in place of its own. */
export function withDeskButtons(message: HelperMessage, ctx: DeskContext, current: StaffCommand | null): HelperMessage {
  const buttons = deskButtons(ctx, current);
  if (message.kind === "buttons") return { kind: "buttons", body: message.body, buttons, footer: message.footer ?? null };
  if (message.kind === "text") return { kind: "buttons", body: message.text, buttons };
  return message;
}

function answer(lines: readonly (string | null)[], ctx: DeskContext, current: StaffCommand): HelperMessage {
  return { kind: "buttons", body: compose(lines), buttons: deskButtons(ctx, current) };
}

function link(ctx: DeskContext, words: Pair, path: string): string {
  return `${say(ctx.language, words)} ${ctx.origin}${path}`;
}

/* --------------------------------------------------------------- the menu */

export type MenuOptions = {
  /** The owner's number: a row to try another role. */
  owner: boolean;
  /** A member of staff (not the owner): a row to write as a parent instead. */
  canWriteAsParent: boolean;
  /** A line before the choices: the role just switched to, or that the message was not understood. */
  note?: string | null;
};

/** The desk's menu, as a WhatsApp list. */
export function deskMenuReply(ctx: DeskContext, options: MenuOptions): HelperMessage {
  const { language } = ctx;
  const who = oneLine(ctx.name, 40);
  const rows: HelperRow[] = ctx.commands
    .filter((command): command is Ask => command !== "menu" && command !== "roles")
    .slice(0, 9)
    .map((command) => ({ id: staffButtonId(command, ctx.ownerHat), title: say(language, ASKS[command].row), description: say(language, ASKS[command].about) }));
  if (options.owner) {
    rows.push({
      id: roleButtonId("list"),
      title: say(language, { hi: "🔄 दूसरी भूमिका आज़माएँ", en: "🔄 Try another role" }),
      description: say(language, { hi: "एडमिन, ऑफ़िस, अकाउंटेंट, शिक्षक… या अभिभावक", en: "Admin, office, accountant, teacher… or a parent" }),
    });
  } else if (options.canWriteAsParent) {
    rows.push({
      id: roleButtonId("parent"),
      title: say(language, { hi: "👪 अभिभावक की तरह लिखें", en: "👪 Write as a parent" }),
      description: say(language, { hi: "अपने बच्चे के बारे में स्कूल को लिखना हो तो", en: "To write to the school about your own child" }),
    });
  }
  const trying =
    options.owner && ctx.ownerHat && ctx.ownerHat !== "parent"
      ? say(language, {
          hi: `🧪 आप *${hatName(ctx.ownerHat, "hi")}* की भूमिका आज़मा रहे हैं (${who}), अभ्यास के रिकॉर्ड पर।`,
          en: `🧪 You are trying the *${hatName(ctx.ownerHat, "en")}* role (${who}), on the practice records.`,
        })
      : practiceLine(ctx);
  const body = compose([
    options.note ?? null,
    options.note ? "" : null,
    say(language, {
      hi: `👋 *नमस्ते${who !== "-" && !options.owner ? ` ${who} जी` : ""}!* मैं ${ctx.helperName} हूँ। आज क्या देखना है?`,
      en: `👋 *Namaste${who !== "-" && !options.owner ? `, ${who}` : ""}!* I am ${ctx.helperName}. What would you like to see?`,
    }),
    trying,
    "",
    say(language, { hi: "नीचे *मेनू खोलें* दबाएँ, या अपना सवाल सीधे लिख दें।", en: "Tap *Open menu* below, or just type your question." }),
    options.owner
      ? say(language, {
          hi: "अभिभावक की तरह जाँचने के लिए *as parent* लिखें; दूसरी भूमिका के लिए *try as accountant*, *try as teacher*…",
          en: "To test as a parent, write *as parent*; for another role, *try as accountant*, *try as teacher*…",
        })
      : null,
  ]);
  return {
    kind: "list",
    body,
    button: say(language, { hi: "मेनू खोलें", en: "Open menu" }),
    section: hatName(ctx.role, language),
    rows,
    footer: say(language, { hi: "मैं केवल देखता और बताता हूँ; बदलाव One में होते हैं", en: "I only look and tell; changes are made in One" }),
  };
}

/** The roles the owner's number can try, as a list (D-607). */
export function roleListReply(input: { language: StaffLanguage; helperName: string; current: StaffHat }): HelperMessage {
  const { language } = input;
  return {
    kind: "list",
    body: compose([
      say(language, { hi: "🔄 *कौन-सी भूमिका आज़माएँ?*", en: "🔄 *Which role would you like to try?*" }),
      say(language, {
        hi: `अभी: *${hatName(input.current, "hi")}*। हर भूमिका में ${input.helperName} वैसे जवाब देगा जैसे उस नंबर वाले स्टाफ़ को देगा, अभ्यास के रिकॉर्ड से।`,
        en: `Now: *${hatName(input.current, "en")}*. In each role ${input.helperName} answers as it would answer staff with that role, from the practice records.`,
      }),
      "",
      say(language, { hi: "कभी भी लिखें: *try as accountant*, *try as teacher*, *as parent*।", en: "Any time, write: *try as accountant*, *try as teacher*, *as parent*." }),
    ]),
    button: say(language, { hi: "भूमिका चुनें", en: "Choose a role" }),
    section: say(language, { hi: "भूमिकाएँ", en: "Roles" }),
    rows: STAFF_HATS.map((hat) => ({
      id: roleButtonId(hat),
      title: `${HAT_WORDS[hat].icon} ${say(language, HAT_WORDS[hat].name)}`,
      description: `${hat === input.current ? say(language, { hi: "✓ अभी यही · ", en: "✓ Now · " }) : ""}${say(language, HAT_WORDS[hat].about)}`,
    })),
    footer: say(language, { hi: "केवल आपके नंबर पर, जाँच के लिए", en: "Only on your number, for testing" }),
  };
}

/** The line at the top of the menu after a switch. */
export function switchedNote(input: { language: StaffLanguage; hat: StaffHat; seatName: string }): string {
  return say(input.language, {
    hi: `🔄 अब आप *${hatName(input.hat, "hi")}* हैं (${oneLine(input.seatName, 40)}, अभ्यास)।`,
    en: `🔄 You are now the *${hatName(input.hat, "en")}* (${oneLine(input.seatName, 40)}, practice).`,
  });
}

/**
 * The first answer the owner's number gets as a role (D-607): which role it
 * is, and how to go back to testing as a parent. Said once.
 */
export function firstHatNote(input: { language: StaffLanguage; hat: StaffHat; seatName: string }): string {
  return say(input.language, {
    hi: `🔄 अब आपके नंबर पर *${hatName(input.hat, "hi")}* की तरह जवाब मिलता है (${oneLine(input.seatName, 40)}, अभ्यास के रिकॉर्ड)। अभिभावक की तरह जाँचने के लिए *as parent* लिखें; दूसरी भूमिका के लिए *roles*।`,
    en: `🔄 Your number is now answered as the *${hatName(input.hat, "en")}* (${oneLine(input.seatName, 40)}, practice records). To test as a parent, write *as parent*; for another role, *roles*.`,
  });
}

/** An answer with a line before it (a role just changed, said once); a menu takes its note itself. */
export function withLeadNote(message: HelperMessage, note: string | null): HelperMessage {
  if (!note) return message;
  switch (message.kind) {
    case "text":
      return { kind: "text", text: `${note}\n\n${message.text}` };
    case "buttons":
    case "list":
      return { ...message, body: `${note}\n\n${message.body}` };
    case "document":
      return message;
  }
}

/** The owner's number, now writing as the practice family's parent. */
export function ownerParentReply(language: StaffLanguage, helperName: string): HelperMessage {
  return {
    kind: "buttons",
    body: compose([
      say(language, { hi: "👪 *अब आप अभिभावक हैं* (अभ्यास परिवार)।", en: "👪 *You are now writing as a parent* (the practice family)." }),
      say(language, {
        hi: `जो भी लिखेंगे, ${helperName} उसका जवाब अभिभावक की तरह देगा: फ़ीस, रसीद, हाज़िरी, छुट्टी, स्कूल आना।`,
        en: `Whatever you write, ${helperName} answers as it answers a parent: fees, receipts, attendance, leave, a visit.`,
      }),
      "",
      say(language, { hi: "स्टाफ़ पर लौटने के लिए *try as admin* लिखें या नीचे दबाएँ।", en: "To go back to staff, write *try as admin* or tap below." }),
    ]),
    buttons: [
      { id: roleButtonId("admin"), title: say(language, { hi: "👑 एडमिन पर लौटें", en: "👑 Back to admin" }) },
      { id: roleButtonId("list"), title: say(language, { hi: "🔄 दूसरी भूमिका", en: "🔄 Another role" }) },
    ],
  };
}

/** A member of staff, now writing to the school as a parent. */
export function staffParentReply(language: StaffLanguage, helperName: string): HelperMessage {
  return {
    kind: "buttons",
    body: compose([
      say(language, { hi: "👪 *ठीक है, अब आप अभिभावक की तरह लिख रहे हैं।*", en: "👪 *All right, you are writing as a parent now.*" }),
      say(language, {
        hi: `आपके अगले संदेश स्कूल को अभिभावक के संदेश की तरह जाएँगे। स्टाफ़ के रूप में ${helperName} से फिर पूछना हो तो *staff* लिखें।`,
        en: `Your next messages go to the school as a parent's. To ask ${helperName} as staff again, write *staff*.`,
      }),
    ]),
    buttons: [{ id: roleButtonId("staff"), title: say(language, { hi: "🧑‍💼 स्टाफ़ पर वापस", en: "🧑‍💼 Back to staff" }) }],
  };
}

/** A member of staff asking to try a role: only the owner's number can. */
export function rolesOnlyOwnerNote(language: StaffLanguage): string {
  return say(language, {
    hi: "ℹ️ दूसरी भूमिकाएँ केवल जाँच वाले नंबर पर आज़माई जा सकती हैं। आपके नंबर पर आपकी अपनी भूमिका है।",
    en: "ℹ️ Other roles can only be tried on the testing number. Your number has your own role.",
  });
}

/** A member of staff back from writing as a parent. */
export function backToStaffNote(language: StaffLanguage): string {
  return say(language, { hi: "🧑‍💼 आप फिर से स्टाफ़ की तरह पूछ रहे हैं।", en: "🧑‍💼 You are asking as staff again." });
}

/** The words of a menu's note when an ask is not on this desk. */
export function notOnDeskNote(command: StaffCommand, language: StaffLanguage): string {
  const words = command in ASKS ? say(language, ASKS[command as Ask].row) : command;
  return say(language, {
    hi: `ℹ️ "${words}" आपकी भूमिका के मेनू में नहीं है। आप ये देख सकते हैं:`,
    en: `ℹ️ "${words}" is not on your role's menu. Here is what you can see:`,
  });
}

/** The words of a menu's note when a typed message was not understood. */
export function unclearNote(language: StaffLanguage): string {
  return say(language, {
    hi: "🤔 मैं समझ नहीं पाया कि आपको क्या देखना है। इनमें से चुनें, या छोटे शब्दों में फिर लिखें:",
    en: "🤔 I could not tell what you would like to see. Choose from these, or write it again in a few words:",
  });
}

/**
 * Typed words that read like a parent writing about their own child: never
 * passed on as one by itself (D-607), but the way to do it is said.
 */
export function parentLikeNote(language: StaffLanguage, owner: boolean): string {
  return owner
    ? say(language, {
        hi: "👪 यह अभिभावक के संदेश जैसा लगता है। अभी आप स्टाफ़ की भूमिका में हैं; अभिभावक की तरह जाँचने के लिए *as parent* लिखें, फिर संदेश दोबारा भेजें।",
        en: "👪 That reads like a parent's message. You are in a staff role now; to test it as a parent, write *as parent*, then send it again.",
      })
    : say(language, {
        hi: "👪 यह अपने बच्चे के बारे में स्कूल को संदेश जैसा लगता है। अभिभावक की तरह भेजना हो तो मेनू में *अभिभावक की तरह लिखें* चुनें (या *as parent* लिखें), फिर संदेश दोबारा भेजें।",
        en: "👪 That reads like a message to the school about your own child. To send it as a parent, choose *Write as a parent* in the menu (or write *as parent*), then send it again.",
      });
}

/** A voice note or a photo from staff: the desk reads typed words and taps. */
export function typeItNote(language: StaffLanguage): string {
  return say(language, {
    hi: "🎙️ स्टाफ़ के सवाल मैं लिखे शब्दों और बटन से समझता हूँ। कृपया लिखकर पूछें, या मेनू से चुनें:",
    en: "🎙️ I read staff questions from typed words and taps. Please type it, or choose from the menu:",
  });
}

/* ----------------------------------------------------------- school today */

export type SchoolFacts = {
  day: string;
  schoolOpen: boolean;
  timetableRuns: boolean;
  rows: readonly { label: string; recorded: boolean; roll: number; present: number; absent: number; halfDay: number }[];
  /** Staff marked away today; null when it could not be read. */
  staffAway: number | null;
  /** Periods (bell index) still needing cover; null when it could not be read. */
  uncovered: readonly { period: number; classLabels: readonly string[] }[] | null;
};

const NAMES_AT_ONCE = 10;

function moreWords(count: number, language: StaffLanguage): string {
  return count > 0 ? say(language, { hi: ` …और ${count}`, en: ` …and ${count} more` }) : "";
}

export function schoolReply(facts: SchoolFacts, ctx: DeskContext): HelperMessage {
  const { language } = ctx;
  const lines: (string | null)[] = [
    say(language, { hi: `🏫 *स्कूल आज · ${dayWords(facts.day, language)}*`, en: `🏫 *School today · ${dayWords(facts.day, language)}*` }),
    practiceLine(ctx),
    "",
  ];
  if (!facts.schoolOpen) {
    lines.push(say(language, { hi: "🏠 आज स्कूल बंद है। आज हाज़िरी और पीरियड नहीं हैं।", en: "🏠 School is closed today. There is no register and no periods today." }));
    return answer(lines, ctx, "school");
  }
  const classes = facts.rows.filter((row) => row.roll > 0);
  const marked = classes.filter((row) => row.recorded);
  const present = marked.reduce((sum, row) => sum + row.present, 0);
  const absent = marked.reduce((sum, row) => sum + row.absent, 0);
  const halfDay = marked.reduce((sum, row) => sum + row.halfDay, 0);
  lines.push(
    say(language, {
      hi: `📋 *हाज़िरी:* ${classes.length} में से ${marked.length} कक्षाओं की लग गई`,
      en: `📋 *Registers:* ${marked.length} of ${classes.length} classes marked`,
    }),
  );
  if (marked.length > 0) {
    lines.push(
      say(language, {
        hi: `उपस्थित ${present} · अनुपस्थित ${absent}${halfDay ? ` · आधा दिन ${halfDay}` : ""}`,
        en: `Present ${present} · Absent ${absent}${halfDay ? ` · Half day ${halfDay}` : ""}`,
      }),
    );
  }
  const waiting = classes.filter((row) => !row.recorded);
  if (waiting.length > 0 && marked.length > 0) {
    lines.push(
      say(language, { hi: "⏳ अभी नहीं लगी: ", en: "⏳ Not marked yet: " }) +
        waiting
          .slice(0, NAMES_AT_ONCE)
          .map((row) => oneLine(row.label, 24))
          .join(", ") +
        moreWords(waiting.length - NAMES_AT_ONCE, language),
    );
  }
  const most = [...marked].filter((row) => row.absent > 0).sort((a, b) => b.absent - a.absent).slice(0, 3);
  if (most.length > 0) {
    lines.push(
      say(language, { hi: "सबसे ज़्यादा अनुपस्थित: ", en: "Most absent: " }) + most.map((row) => `${oneLine(row.label, 24)} (${row.absent})`).join(", "),
    );
  }
  lines.push("");
  lines.push(
    facts.staffAway === null
      ? say(language, { hi: "🧑‍🏫 छुट्टी पर स्टाफ़: अभी पढ़ा नहीं जा सका", en: "🧑‍🏫 Staff away: could not be read just now" })
      : say(language, { hi: `🧑‍🏫 छुट्टी पर स्टाफ़: ${facts.staffAway}`, en: `🧑‍🏫 Staff away: ${facts.staffAway}` }),
  );
  if (facts.timetableRuns) {
    if (facts.uncovered === null) {
      lines.push(say(language, { hi: "🔁 सबस्टिट्यूशन: अभी पढ़ी नहीं जा सकी", en: "🔁 Cover: could not be read just now" }));
    } else if (facts.uncovered.length === 0) {
      lines.push(say(language, { hi: "🔁 हर पीरियड की सबस्टिट्यूशन हो गई है ✅", en: "🔁 Every period has its cover ✅" }));
    } else {
      lines.push(
        say(language, { hi: `🔁 बिना सबस्टिट्यूशन के पीरियड (${facts.uncovered.length}): `, en: `🔁 Periods still without cover (${facts.uncovered.length}): ` }) +
          facts.uncovered
            .slice(0, 6)
            .map((item) => `P${item.period + 1} ${item.classLabels.map((label) => oneLine(label, 20)).join("/")}`)
            .join(", ") +
          moreWords(facts.uncovered.length - 6, language),
      );
    }
  } else {
    lines.push(say(language, { hi: "📝 आज रोज़ के पीरियड नहीं हैं (परीक्षा या कार्यक्रम का दिन)।", en: "📝 The usual periods do not run today (an exam or event day)." }));
  }
  lines.push("", link(ctx, { hi: "पूरा बोर्ड One में:", en: "The whole board in One:" }, "/dashboard"));
  return answer(lines, ctx, "school");
}

/* -------------------------------------------------------------- staff away */

export type AwayFacts = { day: string; periodCount: number; absences: readonly { staffName: string; periods: readonly number[] }[] };

function periodRange(indexes: readonly number[]): string {
  const sorted = [...new Set(indexes)].map((index) => index + 1).sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(j - i >= 2 ? `${sorted[i]}–${sorted[j]}` : sorted.slice(i, j + 1).join(", "));
    i = j;
  }
  return parts.join(", ");
}

export function staffAwayReply(facts: AwayFacts, ctx: DeskContext): HelperMessage {
  const { language } = ctx;
  const lines: (string | null)[] = [
    say(language, { hi: `🧑‍🏫 *छुट्टी पर स्टाफ़ · ${dayWords(facts.day, language)}*`, en: `🧑‍🏫 *Staff away · ${dayWords(facts.day, language)}*` }),
    practiceLine(ctx),
    "",
  ];
  if (facts.absences.length === 0) {
    lines.push(say(language, { hi: "✅ आज कोई स्टाफ़ छुट्टी पर नहीं है।", en: "✅ Nobody on staff is away today." }));
    return answer(lines, ctx, "staff_away");
  }
  lines.push(say(language, { hi: `आज ${facts.absences.length} छुट्टी पर:`, en: `${facts.absences.length} away today:` }));
  for (const absence of facts.absences.slice(0, 25)) {
    const whole = absence.periods.length === 0 || absence.periods.length >= facts.periodCount;
    const span = whole
      ? say(language, { hi: "पूरा दिन", en: "full day" })
      : say(language, { hi: `पीरियड ${periodRange(absence.periods)}`, en: `${absence.periods.length === 1 ? "period" : "periods"} ${periodRange(absence.periods)}` });
    lines.push(`• ${oneLine(absence.staffName, 40)} (${span})`);
  }
  if (facts.absences.length > 25) lines.push(moreWords(facts.absences.length - 25, language).trim());
  if (ctx.commands.includes("cover")) lines.push("", say(language, { hi: "उनकी सबस्टिट्यूशन देखने के लिए *सबस्टिट्यूशन* दबाएँ।", en: "For who is taking their periods, tap *Cover*." }));
  return answer(lines, ctx, "staff_away");
}

/* ------------------------------------------------------------------- cover */

export type CoverFacts = {
  day: string;
  duties: readonly { period: number; classLabels: readonly string[]; absentNames: readonly string[]; substituteName: string | null; status: "assigned" | "needs_help" }[];
};

export function coverReply(facts: CoverFacts, ctx: DeskContext): HelperMessage {
  const { language } = ctx;
  const lines: (string | null)[] = [
    say(language, { hi: `🔁 *आज की सबस्टिट्यूशन · ${dayWords(facts.day, language)}*`, en: `🔁 *Cover today · ${dayWords(facts.day, language)}*` }),
    practiceLine(ctx),
    "",
  ];
  if (facts.duties.length === 0) {
    lines.push(say(language, { hi: "✅ आज किसी पीरियड को सबस्टिट्यूशन की ज़रूरत नहीं है।", en: "✅ No period needs cover today." }));
    return answer(lines, ctx, "cover");
  }
  const open = facts.duties.filter((duty) => duty.status === "needs_help");
  const done = facts.duties.filter((duty) => duty.status === "assigned");
  if (open.length > 0) {
    lines.push(say(language, { hi: `⚠️ *अभी खाली (${open.length})*`, en: `⚠️ *Still need cover (${open.length})*` }));
    for (const duty of open.slice(0, 12)) {
      const forWhom = duty.absentNames.length ? say(language, { hi: ` (${duty.absentNames.join(", ")} की जगह)`, en: ` (for ${duty.absentNames.join(", ")})` }) : "";
      lines.push(`• P${duty.period + 1} · ${duty.classLabels.map((label) => oneLine(label, 20)).join(", ")}${forWhom}`);
    }
    if (open.length > 12) lines.push(moreWords(open.length - 12, language).trim());
    lines.push("");
  }
  if (done.length > 0) {
    lines.push(say(language, { hi: `✅ *तय हो गई (${done.length})*`, en: `✅ *Arranged (${done.length})*` }));
    for (const duty of done.slice(0, 12)) {
      lines.push(`• P${duty.period + 1} · ${duty.classLabels.map((label) => oneLine(label, 20)).join(", ")} → ${oneLine(duty.substituteName ?? "-", 30)}`);
    }
    if (done.length > 12) lines.push(moreWords(done.length - 12, language).trim());
  }
  lines.push("", link(ctx, { hi: "सबस्टिट्यूशन One में तय करें:", en: "Arrange cover in One:" }, "/substitutions"));
  return answer(lines, ctx, "cover");
}

/* ------------------------------------------------------------------- leave */

export type LeaveFacts = readonly { staffName: string; fromDay: string; toDay: string; span: string }[];

export function leaveReply(facts: LeaveFacts, ctx: DeskContext): HelperMessage {
  const { language } = ctx;
  const lines: (string | null)[] = [say(language, { hi: "🌴 *छुट्टी की अर्ज़ियाँ*", en: "🌴 *Leave asked*" }), practiceLine(ctx), ""];
  if (facts.length === 0) {
    lines.push(say(language, { hi: "✅ कोई अर्ज़ी फ़ैसले की राह नहीं देख रही।", en: "✅ No leave is waiting for a decision." }));
    return answer(lines, ctx, "leave");
  }
  lines.push(
    say(language, {
      hi: `${facts.length} अर्ज़ी${facts.length === 1 ? "" : "याँ"} आपके फ़ैसले की राह देख रही ${facts.length === 1 ? "है" : "हैं"}:`,
      en: `${facts.length} waiting for a decision:`,
    }),
  );
  for (const request of facts.slice(0, 12)) {
    const days = request.fromDay === request.toDay ? shortDay(request.fromDay, language) : `${shortDay(request.fromDay, language)} – ${shortDay(request.toDay, language)}`;
    const half =
      request.span === "first_half"
        ? say(language, { hi: " (पहली पाली)", en: " (first half)" })
        : request.span === "second_half"
          ? say(language, { hi: " (दूसरी पाली)", en: " (second half)" })
          : "";
    lines.push(`• ${oneLine(request.staffName, 40)} · ${days}${half}`);
  }
  if (facts.length > 12) lines.push(moreWords(facts.length - 12, language).trim());
  lines.push("", link(ctx, { hi: "मंज़ूर या मना One में करें:", en: "Approve or decline in One:" }, "/inbox"));
  return answer(lines, ctx, "leave");
}

/* -------------------------------------------------------------- needs you */

export type NeedsYouFacts = {
  /** Waiting, theirs to decide. */
  count: number;
  /** The oldest few, as One's cards word them. */
  items: readonly { title: Pair; line: Pair; urgent: boolean }[];
  /** A class teacher's list (their classes' absences) rather than the admin's Needs you. */
  classTeacher: boolean;
};

export function needsYouReply(facts: NeedsYouFacts, ctx: DeskContext): HelperMessage {
  const { language } = ctx;
  const lines: (string | null)[] = [say(language, { hi: "✅ *आपके फ़ैसले*", en: "✅ *Needs you*" }), practiceLine(ctx), ""];
  if (facts.count === 0) {
    lines.push(say(language, { hi: "🎉 अभी किसी अभिभावक का कोई सुझाव आपके फ़ैसले की राह नहीं देख रहा।", en: "🎉 No parent's suggestion is waiting for your decision." }));
    return answer(lines, ctx, "needs_you");
  }
  lines.push(
    say(language, {
      hi: `${facts.count} सुझाव आपके फ़ैसले की राह देख रहे हैं। अभिभावक के कहने से कुछ नहीं बदलता, जब तक आप मंज़ूर न करें:`,
      en: `${facts.count} waiting for your decision. Nothing a parent says changes a record until you approve it:`,
    }),
  );
  for (const item of facts.items.slice(0, 5)) {
    lines.push(`${item.urgent ? "🔴" : "•"} *${oneLine(say(language, item.title), 60)}*`, `   ${oneLine(say(language, item.line), 120)}`);
  }
  if (facts.count > facts.items.length) lines.push(moreWords(facts.count - Math.min(facts.items.length, 5), language).trim());
  lines.push(
    "",
    facts.classTeacher
      ? link(ctx, { hi: "One में Today पर मंज़ूर करें:", en: "Decide them on Today in One:" }, "/teach")
      : link(ctx, { hi: "One के Needs you में मंज़ूर करें:", en: "Decide them in Needs you in One:" }, "/inbox"),
  );
  return answer(lines, ctx, "needs_you");
}

/* -------------------------------------------------------------------- fees */

export type FeeMatch = {
  admissionNo: string | null;
  name: string;
  classLabel: string | null;
  status: string;
  feesPending: number;
  latePending: number;
  totalPaid: number;
  lastPaymentDate: string | null;
  lastPaymentAmount: number | null;
  overdueInstallments: number;
  nextDueDate: string | null;
  nextDueAmount: number | null;
};

export type FeeFacts = {
  day: string;
  today: { total: number; count: number; byMode: readonly { mode: string; total: number; count: number }[] };
  lastDay: { day: string; total: number; count: number } | null;
  month: { total: number; count: number };
  session: { collected: number; feesPending: number; latePending: number; withDues: number; overdue: number; lateOnly: number; students: number };
  query: string | null;
  matchCount: number;
  matches: readonly FeeMatch[];
};

const MODE_WORDS: Record<string, Pair> = {
  cash: { hi: "नकद", en: "Cash" },
  upi: { hi: "UPI", en: "UPI" },
  bank_transfer: { hi: "बैंक", en: "Bank" },
  cheque: { hi: "चेक", en: "Cheque" },
  online: { hi: "UPI (Razorpay)", en: "UPI (Razorpay)" },
};

function rupees(value: number): string {
  return formatInr(value);
}

export function collectionReply(facts: FeeFacts, ctx: DeskContext): HelperMessage {
  const { language } = ctx;
  const lines: (string | null)[] = [
    say(language, { hi: `💰 *फ़ीस जमा · ${dayWords(facts.day, language)}*`, en: `💰 *Fee collection · ${dayWords(facts.day, language)}*` }),
    practiceLine(ctx),
    "",
  ];
  if (facts.today.count > 0) {
    lines.push(
      say(language, {
        hi: `*आज:* ${rupees(facts.today.total)} (${facts.today.count} रसीद)`,
        en: `*Today:* ${rupees(facts.today.total)} (${facts.today.count} receipt${facts.today.count === 1 ? "" : "s"})`,
      }),
    );
    const modes = facts.today.byMode.map((mode) => `${say(language, MODE_WORDS[mode.mode] ?? { hi: mode.mode, en: mode.mode })} ${rupees(mode.total)}`);
    if (modes.length > 0) lines.push(modes.join(" · "));
  } else {
    lines.push(say(language, { hi: "*आज:* अभी तक कुछ जमा नहीं हुआ", en: "*Today:* nothing collected yet" }));
    if (facts.lastDay) {
      lines.push(
        say(language, {
          hi: `पिछली बार ${shortDay(facts.lastDay.day, language)}: ${rupees(facts.lastDay.total)} (${facts.lastDay.count} रसीद)`,
          en: `Last on ${shortDay(facts.lastDay.day, language)}: ${rupees(facts.lastDay.total)} (${facts.lastDay.count} receipt${facts.lastDay.count === 1 ? "" : "s"})`,
        }),
      );
    }
  }
  lines.push(
    say(language, {
      hi: `*इस महीने:* ${rupees(facts.month.total)} (${facts.month.count} रसीद)`,
      en: `*This month:* ${rupees(facts.month.total)} (${facts.month.count} receipt${facts.month.count === 1 ? "" : "s"})`,
    }),
    say(language, { hi: `*इस साल:* ${rupees(facts.session.collected)}`, en: `*This year:* ${rupees(facts.session.collected)}` }),
    "",
    say(language, {
      hi: `📒 बाकी फ़ीस: ${rupees(facts.session.feesPending)} (${facts.session.withDues} बच्चे)`,
      en: `📒 Fees still due: ${rupees(facts.session.feesPending)} (${facts.session.withDues} students)`,
    }),
    say(language, {
      hi: "रसीद पलटने का पैसा घटाकर; माफ़ी (write-off) जमा में नहीं गिनी जाती।",
      en: "Net of reversals; a write-off is not counted as collection.",
    }),
    "",
    link(ctx, { hi: "पूरा हिसाब One में:", en: "The full books in One:" }, "/accounts"),
  );
  return answer(lines, ctx, "collection");
}

function matchBlock(match: FeeMatch, language: StaffLanguage): string[] {
  const head = `👤 *${oneLine(match.name, 40)}*${match.classLabel ? ` · ${oneLine(match.classLabel, 24)}` : ""}${match.admissionNo ? ` · SR ${oneLine(match.admissionNo, 16)}` : ""}`;
  const lines = [head];
  if (match.status !== "active") lines.push(say(language, { hi: `स्थिति: ${match.status}`, en: `Status: ${match.status}` }));
  lines.push(
    match.feesPending > 0
      ? say(language, { hi: `बाकी फ़ीस: ${rupees(match.feesPending)}`, en: `Fees due: ${rupees(match.feesPending)}` })
      : say(language, { hi: "फ़ीस: पूरी जमा ✅", en: "Fees: all paid ✅" }),
  );
  if (match.latePending > 0) lines.push(say(language, { hi: `लेट फ़ीस अलग से: ${rupees(match.latePending)}`, en: `Late fee, separately: ${rupees(match.latePending)}` }));
  if (match.overdueInstallments > 0) {
    lines.push(say(language, { hi: `⚠️ ${match.overdueInstallments} किस्त की तारीख़ निकल चुकी`, en: `⚠️ ${match.overdueInstallments} instalment${match.overdueInstallments === 1 ? "" : "s"} past due` }));
  } else if (match.nextDueDate && match.nextDueAmount) {
    lines.push(say(language, { hi: `अगली किस्त: ${rupees(match.nextDueAmount)}, ${shortDay(match.nextDueDate, language)}`, en: `Next: ${rupees(match.nextDueAmount)} on ${shortDay(match.nextDueDate, language)}` }));
  }
  if (match.lastPaymentDate && match.lastPaymentAmount) {
    lines.push(say(language, { hi: `आख़िरी भुगतान: ${rupees(match.lastPaymentAmount)}, ${shortDay(match.lastPaymentDate, language)}`, en: `Last paid: ${rupees(match.lastPaymentAmount)} on ${shortDay(match.lastPaymentDate, language)}` }));
  }
  return lines;
}

export function duesReply(facts: FeeFacts, ctx: DeskContext): HelperMessage {
  const { language } = ctx;
  if (facts.query) {
    const lines: (string | null)[] = [
      say(language, { hi: `📒 *"${oneLine(facts.query, 30)}" की फ़ीस*`, en: `📒 *Fees for "${oneLine(facts.query, 30)}"*` }),
      practiceLine(ctx),
      "",
    ];
    if (facts.matchCount === 0) {
      lines.push(
        say(language, {
          hi: "इस नाम या SR नंबर का कोई बच्चा नहीं मिला। पूरा नाम या SR नंबर लिखकर फिर देखें।",
          en: "No student by that name or SR number. Try the full name or the SR number.",
        }),
      );
    } else {
      for (const match of facts.matches.slice(0, 4)) lines.push(...matchBlock(match, language), "");
      if (facts.matchCount > Math.min(facts.matches.length, 4)) {
        lines.push(
          say(language, {
            hi: `${facts.matchCount} बच्चे मिले; पहले ${Math.min(facts.matches.length, 4)} ऊपर हैं। सही बच्चे के लिए पूरा नाम या SR नंबर लिखें।`,
            en: `${facts.matchCount} students match; the first ${Math.min(facts.matches.length, 4)} are above. Write the full name or the SR number for one.`,
          }),
        );
      }
    }
    lines.push(link(ctx, { hi: "बकाया One में:", en: "Dues in One:" }, "/dues"));
    return answer(lines, ctx, "dues");
  }
  const s = facts.session;
  return answer(
    [
      say(language, { hi: "📒 *बकाया फ़ीस*", en: "📒 *Fees due*" }),
      practiceLine(ctx),
      "",
      say(language, { hi: `बाकी फ़ीस: *${rupees(s.feesPending)}*`, en: `Fees still due: *${rupees(s.feesPending)}*` }),
      say(language, { hi: `${s.withDues} बच्चों की फ़ीस बाकी है; ${s.overdue} की किस्त की तारीख़ निकल चुकी।`, en: `${s.withDues} students owe fees; ${s.overdue} have an instalment past due.` }),
      say(language, {
        hi: `लेट फ़ीस अलग से: ${rupees(s.latePending)}${s.lateOnly ? ` (${s.lateOnly} बच्चों पर केवल लेट फ़ीस है; वे डिफ़ॉल्टर नहीं)` : ""}`,
        en: `Late fees, separately: ${rupees(s.latePending)}${s.lateOnly ? ` (${s.lateOnly} owe only a late fee; they are not defaulters)` : ""}`,
      }),
      "",
      say(language, {
        hi: "किसी एक बच्चे की फ़ीस के लिए नाम या SR नंबर लिखें, जैसे: *dues Rahul* या *Rahul ki fees*।",
        en: "For one child's fees, write the name or SR number, like: *dues Rahul* or *Rahul's fees*.",
      }),
      "",
      link(ctx, { hi: "बकाया One में:", en: "Dues in One:" }, "/dues"),
    ],
    ctx,
    "dues",
  );
}

/** A real year's fees: the Fees app's, which this number cannot read for anyone. */
export function feesElsewhereReply(ctx: DeskContext, command: "collection" | "dues"): HelperMessage {
  const { language } = ctx;
  return answer(
    [
      command === "collection" ? say(language, { hi: "💰 *फ़ीस जमा*", en: "💰 *Fee collection*" }) : say(language, { hi: "📒 *बकाया फ़ीस*", en: "📒 *Fees due*" }),
      "",
      say(language, {
        hi: "इस साल की फ़ीस के आँकड़े Fees ऐप के हैं, और WhatsApp से अभी वे नहीं पढ़े जा सकते। One में देखें, वहाँ हर आँकड़ा सीधे Fees से आता है:",
        en: "This year's fee figures are the Fees app's, and WhatsApp cannot read them yet. Look in One, where every figure comes straight from Fees:",
      }),
      `${ctx.origin}${command === "collection" ? "/accounts" : "/dues"}`,
    ],
    ctx,
    command,
  );
}

/* ------------------------------------------------ the database's fee figures */

const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
};
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const isoDay = (value: unknown): string | null => {
  const text = str(value);
  return text && /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
};

/** `vppsone.staff_helper_fees` as the replies read it; null when it is not that shape. */
export function feeFactsFrom(raw: unknown): FeeFacts | null {
  const root = obj(raw);
  const asOf = isoDay(root.day);
  if (!asOf) return null;
  const today = obj(root.today);
  const last = root.last_day ? obj(root.last_day) : null;
  const month = obj(root.month);
  const session = obj(root.session);
  const lastDay = last ? isoDay(last.day) : null;
  return {
    day: asOf,
    today: {
      total: num(today.total),
      count: num(today.count),
      byMode: (Array.isArray(today.by_mode) ? today.by_mode : []).map((row) => obj(row)).map((row) => ({ mode: str(row.mode) ?? "-", total: num(row.total), count: num(row.count) })),
    },
    lastDay: last && lastDay ? { day: lastDay, total: num(last.total), count: num(last.count) } : null,
    month: { total: num(month.total), count: num(month.count) },
    session: {
      collected: num(session.collected),
      feesPending: num(session.fees_pending),
      latePending: num(session.late_pending),
      withDues: num(session.with_dues),
      overdue: num(session.overdue),
      lateOnly: num(session.late_only),
      students: num(session.students),
    },
    query: str(root.query),
    matchCount: num(root.match_count),
    matches: (Array.isArray(root.matches) ? root.matches : []).map((row) => obj(row)).map((row) => ({
      admissionNo: str(row.admission_no),
      name: str(row.name) ?? "-",
      classLabel: str(row.class_label),
      status: str(row.status) ?? "active",
      feesPending: num(row.fees_pending),
      latePending: num(row.late_pending),
      totalPaid: num(row.total_paid),
      lastPaymentDate: isoDay(row.last_payment_date),
      lastPaymentAmount: row.last_payment_amount === null || row.last_payment_amount === undefined ? null : num(row.last_payment_amount),
      overdueInstallments: num(row.overdue_installments),
      nextDueDate: isoDay(row.next_due_date),
      nextDueAmount: row.next_due_amount === null || row.next_due_amount === undefined ? null : num(row.next_due_amount),
    })),
  };
}

/* -------------------------------------------------- the owner's practice seats */

export type SeatCandidate = { id: string; displayName: string | null };

/**
 * Which test account the owner's number answers as, in a role (D-607): one
 * that holds a class first (so a teacher's desk has a register to show),
 * then the day-run QA account for that role (the one with the most practice
 * data), then a named test account before a Smoke Lab one, then by name.
 * The same answer every time, so a role always reads the same records.
 */
export function pickPracticeSeat<T extends SeatCandidate>(
  candidates: readonly T[],
  preferredIds: readonly string[],
  holdingClass: ReadonlySet<string> = new Set(),
): T | null {
  const rank = (candidate: T): [number, number, number, string, string] => {
    const preferred = preferredIds.indexOf(candidate.id);
    const name = (candidate.displayName ?? "").trim();
    return [
      holdingClass.has(candidate.id) ? 0 : 1,
      preferred === -1 ? preferredIds.length : preferred,
      /^smoke\b/i.test(name) ? 1 : 0,
      name.toLowerCase(),
      candidate.id,
    ];
  };
  const sorted = [...candidates].sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    for (let i = 0; i < ra.length; i += 1) {
      if (ra[i] < rb[i]) return -1;
      if (ra[i] > rb[i]) return 1;
    }
    return 0;
  });
  return sorted[0] ?? null;
}
