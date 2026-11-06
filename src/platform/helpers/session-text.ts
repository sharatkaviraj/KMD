/**
 * A session label as people read it: "2026–27", "TEST-2026–27".
 *
 * Only the year range takes the en dash. `label.replace("-", "–")` swapped
 * the FIRST hyphen, so the test session read "TEST–2026-27" in the header
 * and "TEST-2026–27" elsewhere — three spellings of one session (accountant
 * day run, 6 Nov 2026).
 */
export function sessionText(label: string): string {
  return String(label ?? "").replace(/-(\d{2})$/, "–$1");
}
