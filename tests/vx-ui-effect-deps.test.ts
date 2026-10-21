import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/*
 * Smoke 20 Oct (dev.systemic[0]): an effect that lists a callback prop in its
 * deps re-runs on every render of the parent, because callers pass inline
 * arrows. In Sheet that moved focus on every keystroke. Keep callbacks in a
 * latest ref (`const ref = useRef(cb); useEffect(() => { ref.current = cb; })`)
 * and leave them out of effect deps.
 *
 * Scans every effect in src/vx (the primitives in src/vx/ui first of all) for
 * a dependency named like a callback prop: onClose, onChange, onPick, …
 */

const ROOT = path.resolve(__dirname, "..", "src", "vx");
const CALLBACK = /^on[A-Z]\w*$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(tsx?|jsx?)$/.test(name) ? [full] : [];
  });
}

/** The deps of each `useEffect(` / `useLayoutEffect(` call in a source file. */
function effectDeps(source: string): { line: number; deps: string[] }[] {
  const out: { line: number; deps: string[] }[] = [];
  const re = /\buse(?:Layout|Insertion)?Effect\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < source.length && depth > 0; i += 1) {
      const c = source[i];
      if (c === "(") depth += 1;
      else if (c === ")") depth -= 1;
    }
    const call = source.slice(m.index, i);
    const tail = /,\s*\[([^\]]*)\]\s*,?\s*\)$/.exec(call);
    if (!tail) continue;
    const deps = tail[1].split(",").map((d) => d.trim()).filter(Boolean);
    out.push({ line: source.slice(0, m.index).split("\n").length, deps });
  }
  return out;
}

describe("vx effects keep callback props out of their deps", () => {
  it("finds the deps of an effect", () => {
    const src = "useEffect(() => { if (a) f(); }, [a, onClose]);\nuseEffect(() => {\n  g();\n});";
    expect(effectDeps(src)).toEqual([{ line: 1, deps: ["a", "onClose"] }]);
  });

  it("no effect in src/vx lists onClose, onChange, onPick or another on* callback", () => {
    const offenders: string[] = [];
    for (const file of files(ROOT)) {
      const source = readFileSync(file, "utf8");
      for (const { line, deps } of effectDeps(source)) {
        const bad = deps.filter((d) => CALLBACK.test(d.replace(/^props\./, "")));
        if (bad.length) offenders.push(`${path.relative(ROOT, file)}:${line} [${bad.join(", ")}]`);
      }
    }
    expect(offenders, "Keep these callbacks in a latest ref instead").toEqual([]);
  });
});
