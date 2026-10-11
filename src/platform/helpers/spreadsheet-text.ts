/** Keep user-provided CSV strings as text when opened in a spreadsheet.
 * CSV quotes escape separators, but do not prevent formula evaluation.
 * Actual numbers stay numeric, including zero and negative amounts.
 */
export function spreadsheetText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) ? `'${value}` : value;
}
