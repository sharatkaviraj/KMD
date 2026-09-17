import { m } from "@/messages";
import { isSafeInternalPath } from "@/platform/env";
import type { Localized } from "@/platform/i18n/language";
import type { StaffRole } from "@/platform/auth/permissions";
import { allowedFor, homeFor } from "@/platform/config/navigation";
import { appsFor, type SchoolApp } from "@/platform/config/apps";
import type { AppId } from "@/platform/config/app-origins";

/**
 * Where an account starts, and why it is a preference rather than a role.
 *
 * The product requirement is plain enough — **an accounts login should open
 * the School Fees workspace by default, on both phone and desktop** — and the
 * wrong way to satisfy it is the obvious one. `accountant` is the fee app's
 * identity, not one of VPPS One's six roles (PLAN §3, D-6), and the design
 * package says so twice: "do not silently turn `office` into `accountant`",
 * "never derive account type from an email, a menu label, or a mock query
 * parameter". Half the office are not in accounts, and an office account that
 * landed on a fee desk because somebody guessed from a mailbox would be access
 * invented by inference.
 *
 * So the mechanism is an explicit choice the person makes about themselves,
 * stored in `staff_profiles.preferred_start`, and it can only ever name a
 * destination the role **already** reaches:
 *
 *  - a VPPS One route is offered only if `allowedFor(role)` lists it, which
 *    means the permission map already said yes;
 *  - a sibling app is offered only if the registry already offers that app to
 *    that role, which today means `apps:view` and `visibleTo` — the same two
 *    gates `/apps` uses.
 *
 * **Nothing here grants anything.** Choosing School Fees as your start screen
 * opens a door you could already walk through from the Apps hub; the
 * destination still decides what you may do when you arrive, exactly as the
 * launcher card says. And a stored value is re-checked on every read, so a
 * demotion takes the landing away with the permission rather than leaving
 * somebody bouncing into a screen they can no longer open.
 */

/** What `preferred_start` may hold, once it has been checked against a role. */
export type StartDestination =
  | {
      kind: "route";
      /** The stored value, and the path to send somebody to. */
      value: string;
      href: string;
      label: Localized;
    }
  | {
      kind: "app";
      /** `app:<registry id>` — the stored form. */
      value: string;
      /** Absolute, built by the registry from a verified origin. */
      href: string;
      label: Localized;
      app: SchoolApp;
    };

const APP_PREFIX = "app:";

/**
 * The stored form of an app choice. Written here so no caller concatenates.
 *
 * There is deliberately no matching parser. A stored value is checked by
 * looking for it in `startOptionsFor(role)` — which is the only check that
 * means anything, because parsing `app:schoolfees` back into an id would tell
 * you the string is well formed and nothing about whether this account may use
 * it.
 */
export function appStartValue(id: AppId): string {
  return `${APP_PREFIX}${id}`;
}

/**
 * Every start screen this role may choose, in the order the hub offers them.
 *
 * Routes first, because the common answer is "one of my own screens", and the
 * apps after, because leaving VPPS One entirely is the deliberate one. Home is
 * not in the list: it is the absence of a choice, and the form renders it as
 * such.
 */
export function startOptionsFor(role: StaffRole): StartDestination[] {
  const routes: StartDestination[] = allowedFor(role).map((item) => ({
    kind: "route" as const,
    value: item.href,
    href: item.href,
    label: item.label,
  }));

  const apps: StartDestination[] = appsFor(role).map((app) => ({
    kind: "app" as const,
    value: appStartValue(app.id),
    href: app.home.href,
    label: app.name,
    app,
  }));

  return [...routes, ...apps];
}

/**
 * Resolve a stored preference against the role that holds it.
 *
 * Returns null for "start at your Home", which is also what an unknown value,
 * a route the role has lost, and an app the registry no longer offers all
 * resolve to. **Silently ignoring a stale value is the point**: the
 * alternative is honouring it and sending somebody to `/access-denied` every
 * morning, or worse, offering a fee desk to an account that was moved out of
 * the office last term.
 */
export function resolveStart(
  role: StaffRole,
  preferred: string | null | undefined,
): StartDestination | null {
  const stored = (preferred ?? "").trim();
  if (!stored) return null;

  return startOptionsFor(role).find((option) => option.value === stored) ?? null;
}

/**
 * Where this account lands on a fresh sign-in, as a URL.
 *
 * May be absolute: an accounts member of staff whose start screen is School
 * Fees is sent to School Fees, which is the whole requirement. Everything else
 * is a path.
 */
export function startHref(
  role: StaffRole,
  preferred: string | null | undefined,
): string {
  return resolveStart(role, preferred)?.href ?? homeFor(role);
}

/**
 * Where a sign-in should actually go: the deep link if there is a usable one,
 * otherwise this account's start screen.
 *
 * **A valid deep link always wins.** Somebody who followed a link to a
 * particular register and had to sign in on the way is asking for that
 * register, not for their landing page — and an accounts member of staff who
 * clicks a VPPS One link must not be bounced out to the fee app instead of
 * reaching what they clicked (D1 acceptance, QA case group A).
 *
 * The deep link is checked by `isSafeInternalPath()` — the same rule
 * `sanitizeRedirectPath()` applies — rather than by a second copy of it here.
 * This function exists separately only because its fallback may be an absolute
 * URL, and that function's contract is a path.
 */
export function landingFor(input: {
  role: StaffRole;
  preferredStart: string | null | undefined;
  /** Whatever `?next=` carried, untrusted. */
  requested?: string | null;
}): string {
  const requested = (input.requested ?? "").trim();

  if (isSafeInternalPath(requested)) return requested;

  return startHref(input.role, input.preferredStart);
}

/** The label a start option shows under its name, so a choice reads honestly. */
export function startOptionHint(option: StartDestination): Localized {
  return option.kind === "app" ? m.startOpensAnotherApp : m.startStaysInThisApp;
}
