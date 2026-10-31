/**
 * Is this string shaped like a pay code? Rejected before Postgres is touched:
 * the codes are 160 bits of randomness in a unique index, so a malformed one
 * is never a lookup worth doing.
 */
export function isPayCodeShaped(code: string): boolean {
  return code.length >= 16 && code.length <= 64 && /^[A-Za-z0-9_-]+$/.test(code);
}
