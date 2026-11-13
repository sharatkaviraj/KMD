import type { StaffRole } from "@/platform/auth/permissions";

import type { StaffAsk, StaffCommand, StaffHat } from "./staff-words";

/**
 * Who answers a message to the school's number, and as whom (D-607). Pure:
 * the reads and the replies are in `data/staff-helper.ts`.
 *
 *  - The owner's test number answers as the role he is trying (the chat's
 *    `hat`, the admin's until he picks another), on practice records, or
 *    as the practice family's parent after *as parent*. The first message
 *    it is answered as a role says so, and how to go back to testing as a
 *    parent; from then on the role is kept, so the note is said once.
 *  - A number a member of staff linked from their own phone (D-582) is
 *    answered as their role, whatever they write, until they write *as
 *    parent*; then it is a parent's message until *staff*.
 *  - A number on a staff record that never linked itself is told how to
 *    link when it uses one of D-591's staff words, and is a parent otherwise.
 *  - Everybody else is a parent.
 */

/** The owner's number answers as the school's admin until he chooses another role. */
export const OWNER_DEFAULT_HAT: StaffRole = "admin";

export type StaffWho =
  | { kind: "owner"; hat: StaffHat | null }
  | { kind: "linked"; hat: StaffHat | null }
  | { kind: "unproven" }
  | { kind: "stopped" }
  | { kind: "none" };

/** What a desk is asked: a command (by its words or a tap), typed words to understand, something it cannot read, or its menu. */
export type DeskAsk =
  | { kind: "command"; to: readonly StaffCommand[]; query: string | null }
  | { kind: "text"; text: string }
  | { kind: "none" }
  | { kind: "menu" };

/**
 * A line said before the answer: a change of role ("switched", "back"), a
 * role asked for that only the owner's number can try, or the first time
 * the owner's number is answered as a role at all ("first", which says how
 * to test as a parent again).
 */
export type DeskNote = "switched" | "back" | "roles_owner_only" | "first";

export type StaffRoute =
  /** Not a staff turn: the parents' helper answers, or the hub's bot. */
  | { route: "pass" }
  | { route: "link_first" }
  | { route: "stopped" }
  /** The owner's number: the roles to try. */
  | { route: "roles"; current: StaffHat }
  /** Now writing as a parent: said, and the chat remembers it. */
  | { route: "parent"; save: "parent" }
  /**
   * A desk answers. `hat` is the role tried on the owner's number (null: the
   * person's own). `save` changes the chat's hat (undefined: unchanged).
   */
  | { route: "desk"; hat: StaffRole | null; save: StaffHat | null | undefined; note: DeskNote | null; ask: DeskAsk };

const PASS: StaffRoute = { route: "pass" };

function commandAsk(ask: Extract<StaffAsk, { kind: "command" }>): DeskAsk {
  return { kind: "command", to: ask.to, query: ask.query };
}

function asTyped(ask: StaffAsk): DeskAsk {
  if (ask.kind === "command") return commandAsk(ask);
  if (ask.kind === "text") return { kind: "text", text: ask.text };
  return { kind: "none" };
}

function isStaffRole(hat: StaffHat | "staff" | null): hat is StaffRole {
  return hat !== null && hat !== "staff" && hat !== "parent";
}

function ownerRoute(ask: StaffAsk, stored: StaffHat | null): StaffRoute {
  const current: StaffHat = stored ?? OWNER_DEFAULT_HAT;
  if (ask.kind === "hat") {
    if (ask.hat === null) return { route: "roles", current };
    if (ask.hat === "parent") return { route: "parent", save: "parent" };
    // "staff" on the owner's number is the admin's desk, kept as such so the first-time note is not said again.
    const role = isStaffRole(ask.hat) ? ask.hat : OWNER_DEFAULT_HAT;
    return { route: "desk", hat: role, save: role, note: "switched", ask: { kind: "menu" } };
  }
  if (ask.kind === "command" && ask.to[0] === "roles") return { route: "roles", current };

  if (current === "parent") {
    if (ask.kind !== "command") return PASS;
    // A tap on one of the desk's buttons is the desk's, whichever way the chat was going.
    if (ask.via === "tap") {
      const role = isStaffRole(ask.hat) ? ask.hat : OWNER_DEFAULT_HAT;
      return { route: "desk", hat: role, save: role, note: null, ask: commandAsk(ask) };
    }
    if (ask.back) return { route: "desk", hat: OWNER_DEFAULT_HAT, save: OWNER_DEFAULT_HAT, note: "switched", ask: { kind: "menu" } };
    // "today", "fees", "बकाया": a parent's words now.
    return PASS;
  }

  // An older button keeps the role it was sent under, and brings that role back.
  if (ask.kind === "command" && ask.via === "tap" && isStaffRole(ask.hat) && ask.hat !== current) {
    return { route: "desk", hat: ask.hat, save: ask.hat, note: null, ask: commandAsk(ask) };
  }
  // Never answered as a role before: the admin's, said once, and kept.
  if (stored === null) return { route: "desk", hat: OWNER_DEFAULT_HAT, save: OWNER_DEFAULT_HAT, note: "first", ask: asTyped(ask) };
  return { route: "desk", hat: current, save: undefined, note: null, ask: asTyped(ask) };
}

function staffRoute(ask: StaffAsk, asParent: boolean): StaffRoute {
  if (ask.kind === "hat") {
    if (ask.hat === "parent") return { route: "parent", save: "parent" };
    if (ask.hat === "staff") return { route: "desk", hat: null, save: null, note: asParent ? "back" : null, ask: { kind: "menu" } };
    // Another role, or the list of them: only the owner's number tries roles.
    return { route: "desk", hat: null, save: asParent ? null : undefined, note: "roles_owner_only", ask: { kind: "menu" } };
  }
  if (asParent) {
    if (ask.kind !== "command") return PASS;
    if (ask.back) return { route: "desk", hat: null, save: null, note: "back", ask: { kind: "menu" } };
    if (ask.via === "tap") return { route: "desk", hat: null, save: null, note: null, ask: commandAsk(ask) };
    return PASS;
  }
  if (ask.kind === "command" && ask.to[0] === "roles") return { route: "desk", hat: null, save: undefined, note: "roles_owner_only", ask: { kind: "menu" } };
  return { route: "desk", hat: null, save: undefined, note: null, ask: asTyped(ask) };
}

export function routeStaffMessage(ask: StaffAsk, who: StaffWho): StaffRoute {
  // Somebody else's button (the parents' helper's): theirs to answer.
  if (ask.kind === "foreign") return PASS;
  switch (who.kind) {
    case "none":
      return PASS;
    case "unproven":
    case "stopped": {
      // Only D-591's staff words and the staff buttons: anything else is a parent's message.
      const asksAsStaff = (ask.kind === "command" && ask.strict && !ask.query) || (ask.kind === "hat" && ask.via === "tap");
      if (!asksAsStaff) return PASS;
      return { route: who.kind === "unproven" ? "link_first" : "stopped" };
    }
    case "owner":
      return ownerRoute(ask, who.hat);
    case "linked":
      return staffRoute(ask, who.hat === "parent");
  }
}

/**
 * On the owner's number, whether the chat's hat alone says the message is
 * the parents' helper's, so nothing else is read before it gets there: what
 * `routeStaffMessage` would say for the owner, sooner.
 */
export function ownerPassesAsParent(ask: StaffAsk, hat: StaffHat | null): boolean {
  if (hat !== "parent") return false;
  if (ask.kind === "foreign" || ask.kind === "text" || ask.kind === "none") return true;
  if (ask.kind === "hat") return false;
  return ask.via !== "tap" && !ask.back && ask.to[0] !== "roles";
}
