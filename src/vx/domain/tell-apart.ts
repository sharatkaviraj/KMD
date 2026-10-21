/**
 * Telling children with the same name apart, on every vx screen that lists
 * or picks children: the register, marks sheets, the note picker, the notes
 * board. Pure; unit-tested in `tests/vx-tell-apart.test.ts`.
 *
 * Moved here from `vx/screens/teach/domain/teach.ts` (smoke 20 Oct,
 * dev.groups[11]) so the screens of several streams share one rule. The copy
 * in teach.ts is kept until its owners import this one.
 */

import { p, type Pair } from "@/vx/text";

export type Tellable = { id: string; name: string; admissionNo?: string | null; fatherName?: string | null };

const fold = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * A short line for each child whose name another child in the list also has
 * ("SR 1234 · father Ramesh"), so two "Ansh"es are never confused. Children
 * with a name of their own get nothing, which keeps a list as short as it
 * was. One child listed twice (same id) is not a namesake.
 */
export function tellApart(rows: readonly Tellable[]): Map<string, Pair> {
  const ids = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = fold(r.name);
    const set = ids.get(key) ?? new Set<string>();
    set.add(r.id);
    ids.set(key, set);
  }
  const out = new Map<string, Pair>();
  for (const r of rows) {
    if ((ids.get(fold(r.name))?.size ?? 0) < 2 || out.has(r.id)) continue;
    const en = [r.admissionNo ? `SR ${r.admissionNo}` : null, r.fatherName ? `father ${r.fatherName}` : null].filter(Boolean).join(" · ");
    const hi = [r.admissionNo ? `SR ${r.admissionNo}` : null, r.fatherName ? `पिता ${r.fatherName}` : null].filter(Boolean).join(" · ");
    if (en) out.set(r.id, p(en, hi));
  }
  return out;
}

/**
 * `tellApart` within each group (a class): two namesakes in different
 * classes are already told apart by the class shown beside them.
 */
export function tellApartWithin<T extends Tellable>(rows: readonly T[], groupOf: (row: T) => string): Map<string, Pair> {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const g = groupOf(r);
    const list = groups.get(g) ?? [];
    list.push(r);
    groups.set(g, list);
  }
  const out = new Map<string, Pair>();
  for (const list of groups.values()) for (const [id, hint] of tellApart(list)) out.set(id, hint);
  return out;
}

/** A child matches a search by every word of it in the name, or by the roll or SR number exactly. */
export function childMatches(child: { name: string; rollNo?: string | null; admissionNo?: string | null }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if ((child.rollNo ?? "").toLowerCase() === q || (child.admissionNo ?? "").toLowerCase() === q) return true;
  const name = child.name.toLowerCase();
  return q.split(/\s+/).every((w) => name.includes(w));
}
