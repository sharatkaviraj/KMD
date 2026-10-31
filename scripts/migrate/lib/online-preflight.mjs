/**
 * The go/no-go checks before One posts a real receipt or takes a real online
 * payment (cutover steps C3 and C7; plan §7.4, critique0 #9). Pure: the
 * runner (`scripts/migrate/online-preflight.mjs`) reads, this decides.
 *
 * The receipt band: from T0 until written sign-off One must number its
 * receipts from 5001 (`app_settings.receipt_suffix_floor = '5000'`), so a
 * receipt the fees app issues in the tail, or on a rollback re-entry, can
 * never share a number with One's. Missed, One's first real receipt is
 * `SVP<date>-0001` and collides with the fees app's own sequence.
 */

export const REQUIRED_RECEIPT_SUFFIX_FLOOR = 5000;

/**
 * settingValue: `public.app_settings.value` for `receipt_suffix_floor` (null
 * when the row is missing). functionValue: what `vppsone.receipt_suffix_floor()`
 * returned, or an Error when it refused (VPP02) or could not be called.
 * Returns { ok, problems: string[] }.
 */
export function receiptFloorVerdict({ settingValue, functionValue }) {
  const problems = [];
  if (settingValue === null || settingValue === undefined) {
    problems.push("app_settings.receipt_suffix_floor is not set (One would number from 0001).");
  } else if (String(settingValue).trim() !== String(REQUIRED_RECEIPT_SUFFIX_FLOOR)) {
    problems.push(`app_settings.receipt_suffix_floor is '${String(settingValue)}', not '${REQUIRED_RECEIPT_SUFFIX_FLOOR}'.`);
  }
  if (functionValue instanceof Error) {
    problems.push(`vppsone.receipt_suffix_floor() refused or failed: ${functionValue.message}`);
  } else if (Number(functionValue) !== REQUIRED_RECEIPT_SUFFIX_FLOOR) {
    problems.push(`vppsone.receipt_suffix_floor() returns ${String(functionValue)}, not ${REQUIRED_RECEIPT_SUFFIX_FLOOR}.`);
  }
  return { ok: problems.length === 0, problems };
}
