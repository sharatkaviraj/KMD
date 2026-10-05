import { m } from "@/messages";
import { isSafeInternalPath } from "@/platform/env";
import type { Localized } from "@/platform/i18n/language";
import type { StaffRole } from "@/platform/auth/permissions";
import { allowedFor, homeFor } from "@/platform/config/navigation";
import type { AppId } from "@/platform/config/app-origins";

/** Preferences select existing, permission-checked screens inside VPPS One. */
export type StartDestination = {
  kind: "route";
  value: string;
  href: string;
  label: Localized;
};

/** Compatibility only: old stored values are never offered as new choices. */
export function appStartValue(id: AppId): string {
  return `app:${id}`;
}

const legacyStarts: Readonly<Record<string, string>> = {
  "app:schoolfees": "/fees",
  "app:sampark": "/collection",
};

export function startOptionsFor(role: StaffRole): StartDestination[] {
  return allowedFor(role).map((item) => ({
    kind: "route",
    value: item.href,
    href: item.href,
    label: item.label,
  }));
}

/** Resolve legacy choices on read, without writing profiles or granting access. */
export function resolveStart(
  role: StaffRole,
  preferred: string | null | undefined,
): StartDestination | null {
  const stored = (preferred ?? "").trim();
  if (!stored) return null;
  const native = legacyStarts[stored] ?? stored;
  return startOptionsFor(role).find((option) => option.value === native) ?? null;
}

export function startHref(role: StaffRole, preferred: string | null | undefined): string {
  return resolveStart(role, preferred)?.href ?? homeFor(role);
}

/** A valid internal deep link wins; the retired Apps hub goes to role Home. */
export function landingFor(input: {
  role: StaffRole;
  preferredStart: string | null | undefined;
  requested?: string | null;
}): string {
  const requested = (input.requested ?? "").trim();
  if (isSafeInternalPath(requested)) {
    if (requested.split(/[?#]/, 1)[0] === "/apps") return homeFor(input.role);
    return requested;
  }
  return startHref(input.role, input.preferredStart);
}

export function startOptionHint(option: StartDestination): Localized {
  return option.kind === "route" ? m.startStaysInThisApp : m.startRoleHomeHint;
}
