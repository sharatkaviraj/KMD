import type { Pair } from "@/vx/text";
import { p } from "@/vx/text";
import { ROLE_SUB } from "@/vx/shell/role-line";

import type { ViewAsPerson } from "./types";

/*
 * The picker's rules (D-544), pure so they are pinned by tests rather than
 * read out of the screen.
 */

/** A long name keeps its first word on the button: "See as Asha Verma", "See as Bhagwati". */
export function shortName(name: string): string {
  if (name.length <= 18) return name;
  const words = name.replace(/^(mr|mrs|ms|dr|shri|smt)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  return words[0] ?? name;
}

/** The big button's words. */
export function seeAsLabel(name: string): Pair {
  const short = shortName(name);
  return p(`See as ${short}`, `${short} की नज़र से देखें`);
}

/** Every word a person can be found by: their name, their role in both languages, their classes. */
export function matchesSearch(person: Pick<ViewAsPerson, "name" | "role" | "classes">, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return true;
  const role = ROLE_SUB[person.role];
  const hay = [person.name, role.en, role.hi ?? "", ...person.classes].join(" · ").toLowerCase();
  return q.split(" ").every((word) => hay.includes(word));
}

export type PersonGroup = "all" | "teachers" | "coordinators" | "accounts" | "office" | "practice";

/** Which chip a person is under. A practice account is only ever under Practice. */
export function inGroup(group: PersonGroup, person: Pick<ViewAsPerson, "role" | "practice">): boolean {
  if (group === "all") return true;
  if (group === "practice") return person.practice;
  if (person.practice) return false;
  switch (group) {
    case "teachers":
      return person.role === "teacher";
    case "coordinators":
      return person.role === "academic_coordinator" || person.role === "exam_coordinator";
    case "accounts":
      return person.role === "accountant" || person.role === "fee_collector";
    case "office":
      return person.role === "office" || person.role === "view_only";
  }
}
