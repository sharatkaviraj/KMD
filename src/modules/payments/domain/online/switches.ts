/**
 * The eight online-payment switches, and nothing else (go-live Phase E, plan
 * §7.6; critique0 #21; Phase F for the last one).
 *
 * `setOnlineSwitchAction` writes only these keys. Each is a One-owned
 * `app_settings` row on One's database (`scripts/migrate/lib/import-rules.mjs`
 * keeps every `online_payment_*` key out of the mirror), every one reads OFF
 * unless it is exactly 'true', and all eight were set 'false' on
 * `wtgxcptmucjerhufzjcf` by fee-migration 20261031120200. The values they take
 * at cutover, and the order they are switched on in, are in
 * `docs/cutover/RAZORPAY.md` and, for the staff alerts,
 * `docs/cutover/STAFF-WHATSAPP.md` §4.
 *
 * `online_payment_staff_whatsapp_enabled` turns an online receipt into
 * `online_payment` staff notices (`data/online/staff-alerts.ts`, shipped in
 * Phase F); the outbox still asks the `online_payment` kind's own switch and
 * each person's consent before anything goes.
 *
 * Left out on purpose: `online_payment_order_max_rupees` (a number the
 * operator sets, not a switch) and `online_payment_upi_only` (on unless
 * 'false', an operator's escape hatch).
 */
export const ONLINE_SWITCH_KEYS = [
  "online_payment_links_enabled",
  "online_payment_checkout_enabled",
  "online_payment_auto_posting_enabled",
  "online_payment_receipts_enabled",
  "online_payment_checkout_all_sessions",
  "online_payment_checkout_modal_enabled",
  "online_payment_waive_late_fees",
  "online_payment_staff_whatsapp_enabled",
] as const;

export type OnlineSwitchKey = (typeof ONLINE_SWITCH_KEYS)[number];
