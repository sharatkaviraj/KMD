import { p, type Pair } from "@/vx/text";

/**
 * The words a parent's suggestion is decided with (D-598), apart from the
 * rest of `parent-suggestions.ts` so the screens that draw the buttons carry
 * only these strings to the browser, not the checks behind them.
 */

/** How an applied absence starts the child on the register. */
export type RegisterMark = "leave" | "absent";

export const MARK_LABELS: Record<RegisterMark, Pair> = {
  leave: p("Leave", "छुट्टी"),
  absent: p("Absent", "अनुपस्थित"),
};

export const SUGGESTION_WORDS = {
  leave: p("Mark Leave", "छुट्टी लगाएँ"),
  absent: p("Mark Absent", "अनुपस्थित लगाएँ"),
  addVisit: p("Add to Admissions", "प्रवेश में जोड़ें"),
  apply: p("Apply", "लागू करें"),
  notNow: p("Not now", "अभी नहीं"),
  undo: p("Undo", "वापस लें"),
  was: p("Now", "अभी"),
  becomes: p("Parent asks", "अभिभावक चाहते हैं"),
  parentWrote: p("The parent wrote", "अभिभावक ने लिखा"),
  practice: p("Practice", "अभ्यास"),
  badge: p("Parent", "अभिभावक"),
  decidedToday: p("Decided today", "आज तय हुए"),
  parentsNotes: p("Parents' notes", "अभिभावकों के संदेश"),
  parentsNotesSub: p("Read by Veer Patta AI on WhatsApp. Nothing changes until you choose.", "व्हाट्सऐप पर Veer Patta AI ने पढ़े। आपके चुनने तक कुछ नहीं बदलता।"),
  call: p("Call", "फ़ोन करें"),
  openRecord: p("Open the child's page", "बच्चे का पेज खोलें"),
  openAdmissions: p("Open Admissions", "प्रवेश खोलें"),
  deciding: p("Saving…", "सहेज रहे हैं…"),
} as const;

/** "Mark all 4 as Leave": every waiting absence shown, in one tap. */
export function markAllLabel(count: number, mark: RegisterMark): Pair {
  return mark === "leave" ? p(`Mark all ${count} as Leave`, `सभी ${count} की छुट्टी लगाएँ`) : p(`Mark all ${count} as Absent`, `सभी ${count} को अनुपस्थित लगाएँ`);
}
