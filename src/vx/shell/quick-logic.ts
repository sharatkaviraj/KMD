import { atTimeP } from "@/vx/format";
import type { Pair } from "@/vx/text";

/*
 * The "+" sheet's rules that are worth a test on their own (D-643): what the
 * teacher's register card says, and which last-used action to offer again.
 * No React and no database here.
 */

/** A class teacher's registers today, as the sheet's first card shows them. */
export type QuickRegister =
  | { state: "closed" }
  | { state: "none" }
  | { state: "open"; classes: { label: Pair; saved: boolean; savedAt: string | null }[] };

type RegisterLike = { classId: string; period: number | null; revision: number; submittedAt: string | null };

/**
 * The day's register for each class this teacher holds. A register counts as
 * taken from its first save (`revision >= 1`), as Today counts it; a period
 * register is not the day's.
 */
export function summariseRegisters(input: {
  open: boolean;
  held: readonly string[];
  registers: readonly RegisterLike[];
  label: (classId: string) => Pair;
}): QuickRegister {
  if (!input.open) return { state: "closed" };
  if (input.held.length === 0) return { state: "none" };
  return {
    state: "open",
    classes: input.held.map((classId) => {
      const reg = input.registers.find((r) => r.classId === classId && r.period === null) ?? null;
      const saved = Boolean(reg && reg.revision >= 1);
      return { label: input.label(classId), saved, savedAt: saved ? reg?.submittedAt ?? null : null };
    }),
  };
}

export type RegisterLine = { line: Pair; tone: "ok" | "warn" | "mut" };

/**
 * The words under "Mark attendance": honest, and never a guess. Nothing is
 * claimed until the answer is in, and a failed read says nothing rather than
 * "not marked" (design principle 5).
 */
export function registerLine(status: QuickRegister | null | undefined): RegisterLine | null {
  if (!status || status.state === "none") return null;
  if (status.state === "closed") return { line: { en: "School is closed today", hi: "आज स्कूल बंद है" }, tone: "mut" };
  const left = status.classes.filter((c) => !c.saved);
  if (status.classes.length === 1) {
    const only = status.classes[0];
    if (!only.saved) return { line: { en: `${only.label.en} · Not marked yet`, hi: `${only.label.hi ?? only.label.en} · अभी हाज़िरी नहीं लगी` }, tone: "warn" };
    const at = only.savedAt ? atTimeP(only.savedAt) : null;
    return {
      line: at
        ? { en: `${only.label.en} · Done, saved ${at.en}`, hi: `${only.label.hi ?? only.label.en} · लग गई, ${at.hi} सेव` }
        : { en: `${only.label.en} · Done`, hi: `${only.label.hi ?? only.label.en} · लग गई` },
      tone: "ok",
    };
  }
  if (left.length === 0) return { line: { en: `All ${status.classes.length} classes done`, hi: `सभी ${status.classes.length} कक्षाओं की हाज़िरी लग गई` }, tone: "ok" };
  return {
    line: {
      en: `${left.length} of ${status.classes.length} classes still to mark`,
      hi: `${status.classes.length} में से ${left.length} कक्षाओं की हाज़िरी बाकी`,
    },
    tone: "warn",
  };
}

/** "Last time" offers the action last tapped on this phone, if this person still has it and it is not already the big card. */
export function lastAction<T extends { key: string; href: string }>(items: readonly T[], lastKey: string | null, heroHref: string | null): T | null {
  if (!lastKey) return null;
  const hit = items.find((i) => i.key === lastKey) ?? null;
  return hit && hit.href !== heroHref ? hit : null;
}
