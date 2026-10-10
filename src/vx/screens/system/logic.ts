/*
 * Pure helpers for the system screens. Unit-tested in
 * tests/vx-system-logic.test.ts.
 */

/** Where "Sign in again" goes: the login screen, told why, and back here after. */
export function expiredLoginHref(pathname: string, search = ""): string {
  const here = `${pathname || "/"}${search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : ""}`;
  // Only same-site paths go into `next`; the login action checks again.
  const next = here.startsWith("/") && !here.startsWith("//") && !here.startsWith("/login") ? here : "/";
  return `/login?reason=expired&next=${encodeURIComponent(next)}`;
}

export type Strength = { score: 0 | 1 | 2 | 3 | 4; label: "too-short" | "weak" | "fair" | "good" | "strong"; ok: boolean };

/**
 * How strong a new password looks. The rule the server enforces is the fee
 * app's (6 characters, `validateStaffPassword`); the meter only nudges
 * towards longer and mixed, it never blocks what the server would accept.
 */
export function passwordStrength(password: string): Strength {
  if (password.length < 6) return { score: 0, label: "too-short", ok: false };
  let points = 0;
  if (password.length >= 8) points += 1;
  if (password.length >= 12) points += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points += 1;
  if (/\d/.test(password)) points += 1;
  if (/[^A-Za-z0-9]/.test(password)) points += 1;
  if (/^(.)\1+$/.test(password) || /^(123456|password|qwerty|111111)/i.test(password)) points = 0;
  const score = (points <= 0 ? 1 : points >= 4 ? 4 : points) as 1 | 2 | 3 | 4;
  const label = score === 1 ? "weak" : score === 2 ? "fair" : score === 3 ? "good" : "strong";
  return { score, label, ok: true };
}
