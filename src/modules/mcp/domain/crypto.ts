import { TOKEN_BYTES } from "@/modules/mcp/domain/constants";

/**
 * Codes, tokens and PKCE with Web Crypto only, so this runs unchanged in
 * Node 24, an edge runtime or a Worker. No signing key exists: a token is an
 * opaque random value and the database keeps its SHA-256, so there is nothing
 * to rotate and nothing to leak but the rows themselves.
 */

function webCrypto(): Crypto {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues || !crypto.subtle) throw new Error("Web Crypto is not available");
  return crypto;
}

/** RFC 4648 §5, no padding. */
export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `bytes` of CSPRNG output, base64url. 32 bytes → 43 characters. */
export function randomToken(bytes: number = TOKEN_BYTES): string {
  const out = new Uint8Array(bytes);
  webCrypto().getRandomValues(out);
  return base64url(out);
}

async function sha256(text: string): Promise<Uint8Array> {
  const digest = await webCrypto().subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

/** What the database stores for a code or token: lowercase hex SHA-256. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = await sha256(text);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** RFC 7636 §4.1: 43–128 characters of the unreserved set. */
export function isValidCodeVerifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9\-._~]{43,128}$/.test(value);
}

/** RFC 7636 §4.2: an S256 challenge is base64url(SHA-256(ASCII(verifier))), 43 characters. */
export function isValidS256Challenge(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** The S256 challenge a verifier produces. */
export async function s256(verifier: string): Promise<string> {
  return base64url(await sha256(verifier));
}

/** Equal strings, compared in time that does not depend on where they differ. */
export function timingSafeEqualText(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

/** PKCE S256 (RFC 7636 §4.6). Plain is never accepted. */
export async function verifyPkce(verifier: unknown, challenge: unknown): Promise<boolean> {
  if (!isValidCodeVerifier(verifier) || !isValidS256Challenge(challenge)) return false;
  return timingSafeEqualText(await s256(verifier), challenge);
}
