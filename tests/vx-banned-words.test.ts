import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/*
 * Plain words for teachers (smoke 20 Oct, dev.systemic): a Hindi reader met
 * English jargon inside Hindi sentences ("ड्राफ़्ट", "submission", "status"),
 * formal Hindi nobody says (पुष्टि, प्रविष्टियाँ), a placeholder (PENDING-SR-…)
 * and raw permission codes (settings:manage).
 *
 * The test reads every string literal in src/vx that holds Hindi, plus every
 * literal for the placeholder, and fails on a NEW use of a banned word. The
 * uses that existed when it was written are allowed below, by file, with
 * their count; the owning screens remove them and then delete the line. A
 * count that goes up fails. A line whose word is gone is printed so it can be
 * deleted; it does not fail, so two streams fixing one file never collide.
 */

const ROOT = path.resolve(__dirname, "..", "src", "vx");

/** English jargon inside a Hindi string (Latin letters, whole words). */
const ENGLISH = ["draft", "drafts", "submit", "submitted", "submission", "sync", "synced", "exempt", "pending", "status", "roster"];
/** The same jargon written in Devanagari, and formal Hindi staff do not use. */
const HINDI = ["ड्राफ़्ट", "ड्राफ्ट", "सबमिट", "सिंक", "पेंडिंग", "स्टेटस", "पुष्टि", "प्रविष्टि"];

/**
 * Where each banned word was used when this test was written: `file|word`
 * → count. Owned by the screens' streams; see the handoff list in the
 * 20 Oct smoke fixes. Never add to it: say the thing in plain words instead.
 */
const ALLOWED: Record<string, number> = {
  "src/vx/screens/admin/data.ts|पुष्टि": 1,
  "src/vx/screens/admin/text.ts|पुष्टि": 3,
  "src/vx/screens/admissions/record.tsx|पुष्टि": 1,
  "src/vx/screens/exams/marks-sheet.tsx|ड्राफ्ट": 5,
  "src/vx/screens/exams/marks-sheet.tsx|ड्राफ़्ट": 6,
  "src/vx/screens/exams/marks-sheet.tsx|पुष्टि": 3,
  "src/vx/screens/exams/marks-sheet.tsx|प्रविष्टि": 1,
  "src/vx/screens/exams/teacher-marks.tsx|ड्राफ़्ट": 2,
  "src/vx/screens/family-contact/actions.ts|पुष्टि": 1,
  "src/vx/screens/family-contact/actions.ts|प्रविष्टि": 1,
  "src/vx/screens/family-contact/ui.tsx|पुष्टि": 4,
  "src/vx/screens/family-contact/ui.tsx|प्रविष्टि": 1,
  "src/vx/screens/fee-setup/words.ts|ड्राफ़्ट": 1,
  "src/vx/screens/messages/outbox.tsx|पुष्टि": 2,
  "src/vx/screens/notes/ui/compose.tsx|ड्राफ़्ट": 3,
  "src/vx/screens/notes/ui/compose.tsx|पुष्टि": 1,
  "src/vx/screens/payments/words.ts|प्रविष्टि": 4,
  "src/vx/screens/receipts/words.ts|प्रविष्टि": 2,
  "src/vx/screens/staff/staff-screen.tsx|प्रविष्टि": 1,
  "src/vx/screens/student-tools/promote.tsx|पुष्टि": 2,
  "src/vx/screens/teach/ui/attend.tsx|पुष्टि": 1,
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(tsx?)$/.test(name) ? [full] : [];
  });
}

/** String literals of a source file, comments removed and `${…}` emptied. */
function literals(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
  const out: string[] = [];
  const re = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) out.push(m[0].slice(1, -1).replace(/\$\{[^}]*\}/g, " "));
  return out;
}

const DEVANAGARI = /[ऀ-ॿ]/;
const CODE = /\b[a-z]+:(?:view|manage|write|mark|mark_on_behalf|correct|collect|accounts|send|run)\b/;

/** The banned words in one file: `word` → count. */
function bannedIn(source: string): Map<string, number> {
  const found = new Map<string, number>();
  const add = (word: string) => found.set(word, (found.get(word) ?? 0) + 1);
  for (const s of literals(source)) {
    if (/PENDING-SR/.test(s)) add("PENDING-SR");
    if (!DEVANAGARI.test(s)) continue;
    for (const w of ENGLISH) if (new RegExp(`\\b${w}\\b`, "i").test(s)) add(w);
    for (const w of HINDI) if (s.includes(w)) add(w);
    const code = CODE.exec(s);
    if (code) add(code[0]);
  }
  return found;
}

function scan(): Map<string, number> {
  const all = new Map<string, number>();
  for (const file of files(ROOT)) {
    const rel = path.relative(path.resolve(ROOT, "..", ".."), file).replace(/\\/g, "/");
    for (const [word, n] of bannedIn(readFileSync(file, "utf8"))) all.set(`${rel}|${word}`, n);
  }
  return all;
}

describe("banned words in the Hindi on vx screens", () => {
  it("finds jargon only inside Hindi strings, and never in comments", () => {
    const src = [
      "// the draft status is pending",
      'const a = p("Draft saved", "ड्राफ़्ट सेव हुआ");',
      'const b = p("Status", "स्थिति");',
      "const c = `${row.status} बदला`;",
      'const d = { en: "Needs settings:manage", hi: "settings:manage चाहिए" };',
      'const e = "PENDING-SR-12";',
      'const f = p("Confirm", "पुष्टि करें");',
    ].join("\n");
    expect(Object.fromEntries(bannedIn(src))).toEqual({ "ड्राफ़्ट": 1, "settings:manage": 1, "PENDING-SR": 1, "पुष्टि": 1 });
  });

  it("no new banned word appears in src/vx", () => {
    const found = scan();
    const grown: string[] = [];
    for (const [key, n] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
      if (n > (ALLOWED[key] ?? 0)) grown.push(`${key} ×${n} (allowed ${ALLOWED[key] ?? 0})`);
    }
    const gone = Object.keys(ALLOWED).filter((key) => (found.get(key) ?? 0) < ALLOWED[key]);
    if (found.size) console.info(`Banned words still in src/vx (fix and remove from ALLOWED):\n  ${[...found].map(([k, n]) => `${k} ×${n}`).join("\n  ")}`);
    if (gone.length) console.info(`ALLOWED lines to lower or delete:\n  ${gone.join("\n  ")}`);
    expect(grown, "Say it in plain words instead (smoke 20 Oct banned list)").toEqual([]);
  });
});
