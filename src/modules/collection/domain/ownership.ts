import { m } from "@/messages";
import { t, type Localized } from "@/platform/i18n/language";
import type { AudienceKind } from "@/modules/collection/domain/audience";

/**
 * Which teacher is in charge of this class, house or bus route.
 *
 * **Answering it wrongly is worse than not answering.** A link sent to the
 * wrong teacher is a group that never gets collected and nobody notices until
 * the due date — so there are exactly three outcomes and none of them is a
 * guess: one owner, more than one, or nobody. The last two are shown to the
 * office to resolve; neither is quietly resolved here.
 *
 * Ported from SamPark `830548c` (`src/lib/ownership.ts`), with the messages
 * turned into Hindi/English pairs and classes read from `class_teachers`
 * rather than from a column on the teacher row (B-32).
 *
 * Pure, no database: the quick send, the round builder and the fan-out all
 * apply one rule, and it can be tested without one.
 */

/** The kinds somebody can be *in charge of*. A master link has no owner. */
export type ScopeKind = Extract<AudienceKind, "class" | "house" | "route">;

export type Scope = {
  kind: ScopeKind;
  /** A class id, a house name, or a route id. */
  value: string;
  /** How the group reads on screen: "Class 6", "Chetak", "Amet City". */
  label: string;
};

export type Owner = {
  id: string;
  displayName: string;
  /** The number a link would actually be sent to. */
  phone: string | null;
  /** Class ids they are class teacher of, this session. */
  classIds: readonly string[];
  /** House names they are in charge of. */
  houses: readonly string[];
  /** Route ids they are in charge of. */
  routeIds: readonly string[];
};

export type RecipientChoice =
  /** Exactly one. Selected silently — no banner, no ceremony. */
  | { kind: "one"; ownerId: string; owners: Owner[] }
  /** More than one. Nothing is selected and the office is told why. */
  | { kind: "many"; owners: Owner[]; message: Localized }
  /** Nobody. Nothing is selected and the full list is offered. */
  | { kind: "none"; owners: []; message: Localized };

/**
 * Whether this person is in charge of this scope.
 *
 * **Exact matching.** Several bus routes differ only by a parenthesised suffix
 * — "Amet Railway Station (Inside)" against "(On Road)" — so a prefix or
 * substring match here would silently hand one route's children to another
 * route's in-charge.
 */
function ownsIt(owner: Owner, scope: Scope): boolean {
  const list =
    scope.kind === "class"
      ? owner.classIds
      : scope.kind === "house"
        ? owner.houses
        : owner.routeIds;

  return list.includes(scope.value);
}

/** Everybody assigned to this scope, in the order they were given. */
export function ownersFor(owners: readonly Owner[], scope: Scope): Owner[] {
  if (!scope.value) return [];
  return owners.filter((owner) => ownsIt(owner, scope));
}

/** How the scope reads in a sentence. */
export function describeScope(scope: Scope): Localized {
  switch (scope.kind) {
    case "house":
      // "Chetak सदन" / "Chetak house" — the house's own name is not
      // translated, and Hindi puts the noun after it just as English does.
      return t(`${scope.label} ${m.audienceHouse.hi}`, `${scope.label} house`);
    case "route":
      return t(`${scope.label} ${m.audienceRoute.hi}`, `the ${scope.label} route`);
    case "class":
      return t(scope.label, scope.label);
  }
}

/**
 * Why a group has no recipient.
 *
 * One wording, two callers: the fan-out reaches the same state by a second
 * route, and two sentences that mean the same thing are two sentences to keep
 * in step.
 */
export function noOwnerMessage(scope: Scope): Localized {
  return t(
    `${describeScope(scope).hi} के लिए कोई शिक्षक दर्ज नहीं है। किसी को चुनिए।`,
    `No teacher is assigned to ${describeScope(scope).en}. Choose anyone.`,
  );
}

/**
 * Who this group's link goes to, or why it cannot be decided.
 *
 * Two owners is a *choice for this round*, not a mistake to clean up: both
 * people really do teach it, and dropping one on the strength of a send would
 * be a deletion nobody asked for. Nobody at all is the office's to fix, and the
 * message says so.
 */
export function chooseRecipient(
  owners: readonly Owner[],
  scope: Scope,
): RecipientChoice {
  const found = ownersFor(owners, scope);

  if (found.length === 1) {
    return { kind: "one", ownerId: found[0].id, owners: found };
  }

  if (found.length > 1) {
    return {
      kind: "many",
      owners: found,
      message: t(
        `${describeScope(scope).hi} के लिए ${found.length} शिक्षक दर्ज हैं — एक चुनिए।`,
        `${found.length} teachers are assigned to ${describeScope(scope).en} — choose one.`,
      ),
    };
  }

  return { kind: "none", owners: [], message: noOwnerMessage(scope) };
}

/**
 * A number a message could actually be sent to.
 *
 * Ten digits, the way `validateField` reads one. Checked here rather than at
 * insert time so the preview can offer a box to type one in, instead of the
 * office finding out after the links exist.
 */
export function hasPhone(phone: string | null | undefined): boolean {
  return /^\d{10}$/.test((phone ?? "").replace(/\D/g, ""));
}

/** Owners first, then everybody else, so a picker leads with the likely answer. */
export function partitionByScope(
  owners: readonly Owner[],
  scope: Scope,
): { owners: Owner[]; others: Owner[] } {
  const mine: Owner[] = [];
  const others: Owner[] = [];

  for (const owner of owners) {
    (scope.value && ownsIt(owner, scope) ? mine : others).push(owner);
  }

  return { owners: mine, others };
}
