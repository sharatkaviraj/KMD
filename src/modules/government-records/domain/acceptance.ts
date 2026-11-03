export type ReturnRowOutcome = { studentId: string; state: "accepted" | "not_accepted" };
/** Record only the operator's explicit, exact SR selection from the frozen batch. */
export function returnAcceptance(rows: readonly { studentId: string; admissionNo: string }[], state: "submitted" | "accepted" | "partially_accepted" | "rejected", acceptedAdmissionNumbers: string): ReturnRowOutcome[] {
  if (state === "submitted") return [];
  if (!rows.length) throw new Error("No submitted rows");
  if (state !== "partially_accepted") return rows.map(row => ({ studentId: row.studentId, state: state === "accepted" ? "accepted" : "not_accepted" }));
  const requested = acceptedAdmissionNumbers.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const selected = new Set(requested);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.admissionNo, (counts.get(row.admissionNo) ?? 0) + 1);
  if (!requested.length || selected.size !== requested.length || requested.length >= rows.length || requested.some(value => counts.get(value) !== 1)) throw new Error("Use exact, unique admission numbers for a partial selection");
  return rows.map(row => ({ studentId: row.studentId, state: selected.has(row.admissionNo) ? "accepted" : "not_accepted" }));
}
