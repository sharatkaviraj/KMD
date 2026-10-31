import "server-only";

/**
 * The office's alerts on every online payment: a push to staff phones and a
 * WhatsApp to the staff numbers (fees `staff-alerts.ts`, fees #107).
 *
 * A placeholder until go-live Phase 8 (staff WhatsApp) ports the sender, the
 * same way `onlineLedgerRecheck` waited for this phase. The alerts table and
 * its triggers are on One's database already (fee-migration 20261030170000),
 * so a posting queues its alert row; nothing here claims or sends it, and the
 * staff WhatsApp path stays behind One's staff transport, which Phase 8 gates.
 * Phase 8 replaces this file with fees HEAD's and nothing else: the posting
 * paths call it exactly as the fees app does.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export async function drainStaffPaymentAlerts(args: {
  supabase: Db;
  outOfTime?: () => boolean;
}): Promise<{ alerts: number; pushed: number; whatsappSent: number }> {
  void args;
  return { alerts: 0, pushed: 0, whatsappSent: 0 };
}
