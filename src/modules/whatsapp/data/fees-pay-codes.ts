import "server-only";

import { fetchAllPages, fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { feesPayCodeStillPayable, FEES_CHECKOUT_LINK_DAYS } from "@/platform/migration/cutover-watermark";
import { readCutoverWatermark } from "@/platform/migration/cutover-watermark-reader";

/**
 * Who still holds a payable fees Pay now link (One only; go-live Phase E
 * review, critique0 #4 "in both cases One's sender must skip Pay now for any
 * student with a fees pay code still payable").
 *
 * The fees app's reminder sends reach One's database with the load (and the
 * tail sync); those written before the cutover line carry the fees app's pay
 * codes. While one of them can still be paid on the fees app, a One Pay now
 * for the same family would be a second, independent way to pay the same
 * installment. The run sender then sends that family the text-only notice.
 *
 * Matched two ways, because a family message is logged under one child: by
 * the students (the row's own child, and every child in its `pay_scope`) and
 * by the phone it went to.
 *
 * `null` means "could not tell" (the line or the sends could not be read):
 * the caller sends nobody a Pay now. With no line yet (no real data has
 * been loaded) nothing is held.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type FeesPayCodeHolders = { studentIds: Set<string>; destinations: Set<string> };

type SendRow = {
  id: string;
  student_id: string | null;
  destination: string | null;
  session_label: string | null;
  created_at: string | null;
  pay_code: string | null;
  pay_code_expires_on: string | null;
  pay_scope: unknown;
};

const COLUMNS = "id, student_id, destination, session_label, created_at, pay_code, pay_code_expires_on, pay_scope";

export async function loadFeesPayCodeHolders(
  supabase: Db,
  input: { studentIds: readonly string[]; destinations: readonly string[]; today: string },
): Promise<FeesPayCodeHolders | null> {
  const empty: FeesPayCodeHolders = { studentIds: new Set(), destinations: new Set() };
  if (input.studentIds.length === 0 && input.destinations.length === 0) return empty;

  const watermark = await readCutoverWatermark("public.whatsapp_reminder_sends");
  if (watermark.state === "none") return empty;
  if (watermark.state === "unreadable") return null;

  // A row can only be payable if it has no expiry, an expiry from today on,
  // or was sent inside the checkout window. The rule itself is applied below.
  const checkoutSince = new Date(Date.parse(`${input.today}T00:00:00+05:30`) - (FEES_CHECKOUT_LINK_DAYS + 1) * 24 * 3600_000).toISOString();
  const windowFilter = `pay_code_expires_on.is.null,pay_code_expires_on.gte.${input.today},created_at.gte.${checkoutSince}`;

  const read = (column: "student_id" | "destination", values: readonly string[]) =>
    fetchInChunks<SendRow>([...new Set(values.filter(Boolean))], IN_FILTER_CHUNK_SIZE, (chunk) =>
      fetchAllPages<SendRow>((from, to) =>
        supabase
          .from("whatsapp_reminder_sends")
          .select(COLUMNS)
          .in(column, chunk)
          .not("pay_code", "is", null)
          .lt("created_at", watermark.at)
          .or(windowFilter)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );

  try {
    const [byStudent, byPhone] = await Promise.all([read("student_id", input.studentIds), read("destination", input.destinations)]);
    if (byStudent.error || byPhone.error) return null;
    const holders: FeesPayCodeHolders = { studentIds: new Set(), destinations: new Set() };
    for (const row of [...byStudent.data, ...byPhone.data]) {
      if (!feesPayCodeStillPayable(row, watermark, input.today)) continue;
      if (row.student_id) holders.studentIds.add(row.student_id);
      for (const id of scopeStudentIds(row.pay_scope)) holders.studentIds.add(id);
      if (row.destination) holders.destinations.add(row.destination);
    }
    return holders;
  } catch {
    return null;
  }
}

function scopeStudentIds(scope: unknown): string[] {
  const ids = (scope as { studentIds?: unknown } | null)?.studentIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/** Does this family hold one? `null` holders (unreadable) means yes, for everybody. */
export function familyHoldsFeesPayCode(
  holders: FeesPayCodeHolders | null,
  family: { studentIds: readonly string[]; destinations: readonly string[] },
): boolean {
  if (holders === null) return true;
  return (
    family.studentIds.some((id) => holders.studentIds.has(id)) ||
    family.destinations.some((destination) => holders.destinations.has(destination))
  );
}
