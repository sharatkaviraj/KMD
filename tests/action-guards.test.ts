import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every server action checks who is asking, in its own body.
 *
 * **A page guard does not guard the action underneath it.** `requirePermission`
 * at the top of a screen decides whether that screen renders; a Server Action
 * is a separate POST to a generated endpoint, reachable by anybody who has the
 * action id whether or not they can open the page it came from. The page and
 * the action are two doors into the same room.
 *
 * `tests/…/smoke-roles` covers the pages by opening all thirty-six as all six
 * roles. Nothing opens the actions, because pressing them would write — so
 * this checks statically instead that each one asks before it acts.
 *
 * It reads the body of every exported async function in a `"use server"` file
 * and looks for the check. Crude, and that is the point: a rule about "every
 * one of these" is worth more when it cannot be satisfied by a clever
 * indirection nobody can see.
 */

const repoRoot = process.cwd();
const normalise = (text: string) => text.replace(/\r\n/g, "\n");

const GUARDS = [
  "assertPermission",
  "assertStaff",
  "requirePermission",
  "requireAnyPermission",
  "requireStaff",

  /*
   * The same check, in the ported fee screens' vocabulary.
   *
   * `src/modules/fees/platform/session.ts` answers all three from
   * `requireStaff()`, so an action guarded by one of these is guarded by the
   * same code as an action guarded by the names above — it just says so in the
   * words the fee app's ~90 call sites already use.
   *
   * Note `requireStaff` above is a prefix of nothing here: the names are
   * matched with a trailing `(`, so `requireStaffPermission` does not satisfy
   * the rule by accident and neither does the reverse.
   */
  "requireAuthenticatedStaff",
  "requireStaffPermission",
  "requireAnyStaffPermission",
];

/**
 * The two doors that are open on purpose.
 *
 * `login/actions.ts` is how somebody who is *not* signed in signs in; a guard
 * there would be a lock on the outside of the door. `r/[token]/actions.ts` is
 * the public collection link, where the token is the whole authorization
 * (D-68) — it is checked by `resolveToken()` inside, which is a different
 * check, not a missing one.
 */
const OPEN_BY_DESIGN = new Set([
  "src/app/login/actions.ts",
  "src/app/r/[token]/actions.ts",
]);

/** Every `"use server"` file under src/. */
function serverActionFiles(): string[] {
  const found: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        const source = normalise(readFileSync(full, "utf8"));
        if (/^\s*"use server"/m.test(source)) found.push(full);
      }
    }
  };

  walk(path.join(repoRoot, "src"));
  return found.sort();
}

/** Each exported async function's name and body text. */
function exportedActions(source: string): { name: string; body: string }[] {
  const found: { name: string; body: string }[] = [];

  for (const match of source.matchAll(/export\s+async\s+function\s+(\w+)\s*\(/g)) {
    const name = match[1];

    /*
     * Find the end of the parameter list before looking for the body.
     *
     * This used to take the first `{` after the `(`, which is the body only
     * when the signature is simple. It is not, in ported code:
     *
     *   previewNoticeAction(input: { situation: string; ... })
     *   realignRecentImportsToActiveSessionAction(): Promise<{ ... }>
     *
     * In both, the first `{` opens a *type*, so the "body" came out as the
     * parameter's shape — which contains no guard, and the action was
     * reported unguarded when it was not. Two false alarms hid four real
     * ones in the same list, which is the way a crude check stops being
     * believed.
     */
    let depthParen = 1;
    let afterParams = match.index! + match[0].length;
    for (; afterParams < source.length && depthParen > 0; afterParams += 1) {
      if (source[afterParams] === "(") depthParen += 1;
      else if (source[afterParams] === ")") depthParen -= 1;
    }

    /*
     * Then skip the return-type annotation, whose `{` also is not the body:
     *
     *   realignRecentImportsToActiveSessionAction(): Promise<{ … }> { … }
     *
     * Inside a type the braces sit within angle brackets, so the body's brace
     * is the first one at angle-depth zero. `=>` is stepped over so a function
     * type in the annotation does not close a bracket that never opened.
     */
    let depthAngle = 0;
    let start = -1;
    for (let i = afterParams; i < source.length; i += 1) {
      if (source[i] === "=" && source[i + 1] === ">") {
        i += 1;
        continue;
      }
      if (source[i] === "<") depthAngle += 1;
      else if (source[i] === ">") depthAngle = Math.max(0, depthAngle - 1);
      else if (source[i] === "{" && depthAngle === 0) {
        start = i;
        break;
      }
    }
    if (start < 0) continue;

    let depth = 0;
    let end = start;
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    found.push({ name, body: source.slice(start, end + 1) });
  }

  return found;
}

describe("server actions", () => {
  const files = serverActionFiles();

  it("finds the action files at all", () => {
    // A check that finds nothing has not passed, it has broken.
    expect(files.length).toBeGreaterThan(8);
  });

  it("checks who is asking, in every action, before it writes", () => {
    const unguarded: string[] = [];

    for (const file of files) {
      const relative = path.relative(repoRoot, file).replace(/\\/g, "/");
      if (OPEN_BY_DESIGN.has(relative)) continue;

      const source = normalise(readFileSync(file, "utf8"));

      for (const action of exportedActions(source)) {
        const guarded = GUARDS.some((guard) => action.body.includes(`${guard}(`));
        if (!guarded) unguarded.push(`${relative} → ${action.name}()`);
      }
    }

    expect(unguarded).toEqual([]);
  });

  it("knows which files are deliberately open, and they still exist", () => {
    // If one of these is renamed or deleted, the exemption should go with it
    // rather than sitting here quietly excusing a file that no longer matches.
    for (const relative of OPEN_BY_DESIGN) {
      expect(files.map((f) => path.relative(repoRoot, f).replace(/\\/g, "/"))).toContain(
        relative,
      );
    }
  });

  it("finds real actions in a file it is meant to be checking", () => {
    // Guards the parser: if `exportedActions` ever stopped matching, the
    // headline test above would pass by finding nothing to complain about.
    const marks = normalise(
      readFileSync(path.join(repoRoot, "src/app/(app)/assessments/actions.ts"), "utf8"),
    );
    const actions = exportedActions(marks);

    expect(actions.length).toBeGreaterThan(4);
    expect(actions.map((a) => a.name)).toContain("saveMarksAction");
  });
});
