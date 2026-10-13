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

/**
 * The three ticks under a new password (design `Auth` · password). Only the
 * first is the server's rule and gates saving; a number and "not your phone
 * number" are advice, as the meter is.
 */
export function passwordRules(password: string, phone: string | null | undefined): { long: boolean; number: boolean; notPhone: boolean } {
  const digits = password.replace(/\D/g, "");
  const own = mobileDigits(phone);
  return {
    long: password.length >= 6,
    number: /\d/.test(password),
    notPhone: password.length > 0 && !(own && digits.includes(own.slice(0, 5))),
  };
}

/* ------------------------------------------------------------ access denied */

type StaffLike = { id: string; displayName: string; role: string; phone: string | null; whatsappPhone: string | null; isActive: boolean };

/** Ten numerals for an Indian mobile, or null. */
function mobileDigits(raw: string | null | undefined): string | null {
  let n = String(raw ?? "").replace(/\D/g, "");
  if (n.length > 10 && n.startsWith("91")) n = n.slice(2);
  if (n.length > 10 && n.startsWith("0")) n = n.slice(1);
  return /^[6-9]\d{9}$/.test(n) ? n : null;
}

/** "98290 ••512": enough to recognise a number, not to copy it. */
export function maskPhone(raw: string | null | undefined): string | null {
  const n = mobileDigits(raw);
  return n ? `${n.slice(0, 5)} ••${n.slice(-3)}` : null;
}

function initialsOf(name: string): string {
  return name
    .replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Who can open a page this reader cannot: active staff in the roles that
 * hold its permission, in the order the roles are given, at most three, never
 * the reader. Numbers are only what `listStaff()` already let this reader see.
 */
export function deniedPeople<R extends string>(staff: StaffLike[], roles: readonly R[], selfId: string) {
  const order = new Map<string, number>(roles.map((r, i) => [r, i]));
  return staff
    .filter((s) => s.isActive && s.id !== selfId && order.has(s.role))
    .sort((a, b) => (order.get(a.role) ?? 9) - (order.get(b.role) ?? 9) || a.displayName.localeCompare(b.displayName, "en"))
    .slice(0, 3)
    .map((s) => {
      const n = mobileDigits(s.phone ?? s.whatsappPhone);
      return { id: s.id, initials: initialsOf(s.displayName), name: s.displayName, roleKey: s.role as R, phoneShown: maskPhone(n), callHref: n ? `tel:+91${n}` : null };
    });
}

/**
 * "Request access" opens the reader's own WhatsApp to the first admin with
 * the request typed in, Hindi first. Nothing is sent by the app; null when no
 * admin's number is visible to this reader.
 */
export function requestAccessHref(staff: StaffLike[], myName: string, permission: string | null, selfId?: string): string | null {
  const admin = staff.find((s) => s.isActive && s.role === "admin" && s.id !== selfId && mobileDigits(s.whatsappPhone ?? s.phone));
  const n = admin ? mobileDigits(admin.whatsappPhone ?? admin.phone) : null;
  if (!n) return null;
  const what = permission ? ` (${permission})` : "";
  const text = `नमस्ते, मुझे VPPS One में एक पेज खोलने की अनुमति चाहिए${what}। — ${myName}\nHello, I need access to a page in VPPS One${what}. — ${myName}`;
  return `https://wa.me/91${n}?text=${encodeURIComponent(text)}`;
}
