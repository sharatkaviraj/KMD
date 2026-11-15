/**
 * Short links that open a place in One from a WhatsApp message (D-616):
 * `https://one.vpps.co.in/go/<code>`. The owner, 15 Nov 2026: "the one app
 * can send direct links to many things".
 *
 * A link is a shortcut, never a key. It opens only after the normal sign-in,
 * and the page it leads to checks the person's permissions as always; a link
 * forwarded to someone else takes them only to what they could open anyway.
 * The code says where to go (an internal path only, never another site), and
 * which year to show it in, so a practice chat opens in the test session.
 * Codes are random, ten letters and digits, and stop working after a week.
 *
 * Pure: making a code and checking a path. `data/go-links.ts` keeps them.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const GO_CODE_LENGTH = 10;
export const GO_LINK_DAYS = 7;
export const GO_LINK_BASE = "https://one.vpps.co.in/go/";

/** A code from random bytes: ten characters with no 0/O or 1/l/I to misread. */
export function goCodeFrom(bytes: Uint8Array): string {
  if (bytes.length < GO_CODE_LENGTH) throw new Error("goCodeFrom needs at least ten random bytes.");
  let code = "";
  for (let index = 0; index < GO_CODE_LENGTH; index += 1) code += ALPHABET[bytes[index] % ALPHABET.length];
  return code;
}

export function isGoCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{8,16}$/.test(value);
}

/**
 * An internal path a link may open: starts with one slash, no scheme or host,
 * no backslash, no spaces, at most 300 characters. Anything else is refused,
 * so a link can never send someone off One.
 */
export function safeGoPath(path: string): string | null {
  const value = path.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.length > 300 || /[\s\\]/.test(value) || value.includes("://")) return null;
  if (value.startsWith("/go/") || value === "/go") return null;
  return value;
}

/** Where a link opens, from what it was made for. */
export const GO_PURPOSES = ["chats", "chat", "screen"] as const;
export type GoPurpose = (typeof GO_PURPOSES)[number];

export function goLinkUrl(code: string, base: string = GO_LINK_BASE): string {
  return `${base.replace(/\/?$/, "/")}${code}`;
}
