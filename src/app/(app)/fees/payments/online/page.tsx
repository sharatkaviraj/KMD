import { readRazorpayConfig } from "@/modules/payments/data/online/razorpay-client";
import { readOnlineScreen } from "@/modules/payments/data/online/screen-reads";
import { readCheckoutOptions, readOnlineSwitches } from "@/modules/payments/data/online/service";
import { readStaffAlertWhatsappOn } from "@/modules/payments/data/online/staff-alerts";
import { requirePermission } from "@/platform/auth/current-staff";
import { formatInr } from "@/platform/helpers/currency";
import { formatDateTimeIst } from "@/platform/helpers/date";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { hasStaffPermission, requireStaffPermission } from "@/modules/fees/platform/session";
import { Notice } from "@/ui/primitives/notice";
import { PageHeader } from "@/ui/shell/page-header";
import { PendingSubmitButton } from "@/ui/shell/pending-submit-button";
import { SectionCard } from "@/ui/shell/section-card";

import { postOnlinePaymentAction, resolveOnlineReviewAction, setOnlineSwitchAction } from "./actions";

/**
 * Online payments: where every rupee paid through Razorpay can be seen.
 *
 * Read top to bottom it answers, in order: is it switched on; did every
 * captured payment become a receipt or a review item; what needs a person;
 * what did each link and each receipt message do. Server-rendered, and the
 * controls are plain forms.
 *
 * `payments:write` to see it and to post a waiting capture; `finance:approve`
 * to close a review; `settings:write` to flip a switch.
 *
 * One only (go-live Phase E): the screen also needs One's `fees:accounts`, the
 * permission its nav entry is gated on, so the fee vocabulary's broader
 * `payments:write` (every collector) does not reach it by URL. Every list is
 * fenced by session (`data/online/screen-reads.ts`): a test account sees TEST
 * payments only, real staff never see them, a real admin sees both.
 *
 * The staff alerts (go-live Phase F): `online_payment_staff_whatsapp_enabled`
 * is offered with the other switches. On, every online receipt becomes an
 * `online_payment` notice in the staff outbox for everybody with
 * `fees:collect`, sent only to those who consented and only while the
 * `online_payment` kind is on (`docs/cutover/STAFF-WHATSAPP.md` §4). The fees
 * app's typed list of office numbers and its push half are not ported: One
 * has no push sign-up screen.
 */

export const revalidate = 0;

const STATUS_LABEL: Record<string, string> = {
  link_pending: "Creating link",
  link_created: "Link sent",
  paid: "Paid, not posted",
  accounted: "Receipt posted",
  review_required: "Needs review",
  superseded: "Replaced",
  cancelled: "Cancelled",
  expired: "Expired",
  failed: "Link failed",
  pending: "Waiting to post",
  applied: "Receipt posted",
  queued: "Queued",
  processing: "Sending",
  provider_accepted: "Accepted by WhatsApp provider",
  delivered: "Delivered",
  suppressed: "Not sent (by rule)",
  uncertain: "Unknown — check AiSensy",
};

const REVIEW_LABEL: Record<string, string> = {
  unknown_link: "Paid on a link this app does not know",
  wrong_mode: "Paid in the other Razorpay mode",
  wrong_currency: "Not in rupees",
  wrong_amount: "Paid a different amount than asked",
  fractional_rupee: "Amount has paise",
  dues_changed: "Dues changed before it could post (cash at the counter, a waiver or a fee change)",
  posting_refused: "The fee engine refused it",
  intent_already_accounted: "This link was already posted once",
  unknown_order: "Paid on a checkout order this app does not know",
  order_already_accounted: "This checkout order was already posted once",
  lines_do_not_add_up: "The order's children do not add up to what was paid",
};

function reviewText(reason: string | null): string {
  if (!reason) return "";
  return reason
    .split(",")
    .map((part) => REVIEW_LABEL[part.split(":")[0]] ?? part)
    .join("; ");
}

type StudentRef = { admission_no: string; full_name: string } | null;
type AttentionRow = {
  id: string;
  provider_payment_id: string;
  amount_paise: number;
  method: string | null;
  application_status: string;
  review_reason: string | null;
  resolution_note: string | null;
  created_at: string;
  online_payment_intents: { public_ref: string; students: StudentRef } | null;
  online_payment_orders: { public_ref: string; online_payment_order_lines: Array<{ amount_rupees: number; students: StudentRef }> } | null;
};
type OrderListRow = {
  id: string;
  status: string;
  amount_rupees: number;
  provider_mode: string;
  superseded_reason: string | null;
  last_error: string | null;
  created_at: string;
  online_payment_order_lines: Array<{ line_no: number; amount_rupees: number; students: StudentRef }>;
};
type IntentListRow = {
  id: string;
  status: string;
  amount_rupees: number;
  provider_mode: string;
  superseded_reason: string | null;
  last_error: string | null;
  created_at: string;
  students: StudentRef;
};

const paiseToInr = (paise: number | null | undefined) => formatInr(Math.round(Number(paise ?? 0)) / 100);

function Pill({ status }: { status: string }) {
  const tone =
    status === "accounted" || status === "applied" || status === "provider_accepted" || status === "delivered"
      ? "bg-success-soft text-success-soft-foreground"
      : status === "review_required" || status === "failed" || status === "uncertain"
      ? "bg-warning-soft text-warning-soft-foreground"
      : "bg-surface-2 text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{STATUS_LABEL[status] ?? status}</span>;
}

const NOTICES: Record<string, { tone: "success" | "warning"; text: string }> = {
  posted: { tone: "success", text: "Receipt posted." },
  already: { tone: "success", text: "That payment was already on a receipt." },
  review: { tone: "warning", text: "Not posted: the dues no longer match what the parent paid. It is now in review." },
  not_posted: { tone: "warning", text: "Not posted. Try again in a minute; nothing was changed." },
  resolved: { tone: "success", text: "Marked resolved, with your note." },
  note_needed: { tone: "warning", text: "Write what was done before marking it resolved." },
  switched: { tone: "success", text: "Switch changed." },
  not_switched: { tone: "warning", text: "Not changed: that switch cannot be set from here." },
  switch_refused: { tone: "warning", text: "Not changed: fee settings cannot be written right now. Nothing was recorded." },
  not_resolved: { tone: "warning", text: "Not resolved: the change was refused. Nothing was recorded." },
};

export default async function OnlinePaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const notice = typeof resolvedSearchParams.notice === "string" ? NOTICES[resolvedSearchParams.notice] : undefined;
  const viewer = await requirePermission("fees:accounts", "/fees/payments/online");
  const staff = await requireStaffPermission("payments:write");
  const canResolve = hasStaffPermission(staff, "finance:approve");
  const canSwitch = hasStaffPermission(staff, "settings:write");
  const supabase = createAdminClient();
  const config = readRazorpayConfig();
  const webhookConfigured = Boolean(process.env.RAZORPAY_WEBHOOK_SECRET?.trim());

  // One only: every list below is fenced by session (`screen-reads.ts`). A
  // test account sees TEST payments only, real staff never see them, a real
  // admin sees both — the service-role client bypasses the database's fence.
  const [switches, screen, checkoutSetting, checkoutOptions, staffWhatsappOn] = await Promise.all([
    readOnlineSwitches(supabase),
    readOnlineScreen(supabase, { role: viewer.role, isTestAccount: viewer.isTestAccount === true }),
    supabase.from("app_settings").select("value").eq("key", "online_payment_checkout_enabled").maybeSingle(),
    readCheckoutOptions(supabase),
    readStaffAlertWhatsappOn(supabase),
  ]);
  const { recon, attention, intents, outbox, audit, orders } = screen;
  const fenced = screen.scope !== "all";
  const orderRows = (orders.data ?? []) as unknown as OrderListRow[];
  const checkoutOn = String((checkoutSetting.data as { value?: string } | null)?.value ?? "").toLowerCase() === "true";

  // The typed client reads a to-one join as an array; these are to-one.
  const needsAttention = ((attention.data ?? []) as unknown as AttentionRow[]).filter(
    (row) => row.application_status === "pending" || !row.resolution_note,
  );
  const intentRows = (intents.data ?? []) as unknown as IntentListRow[];

  const switchRows: Array<{ key: string; label: string; on: boolean; explain: string }> = [
    {
      key: "online_payment_links_enabled",
      label: "New payment links",
      on: switches.links,
      explain: "Pay now pages offer online payment, and reminders are re-checked against the ledger just before sending.",
    },
    {
      key: "online_payment_auto_posting_enabled",
      label: "Automatic posting",
      on: switches.autoPosting,
      explain: "A verified payment becomes a receipt on its own. Off: it waits here for a person to post it.",
    },
    {
      key: "online_payment_receipts_enabled",
      label: "Receipt on WhatsApp",
      on: switches.receipts,
      explain: "The posted receipt is sent to the parent (the WhatsApp receipt setting must also be on).",
    },
    {
      key: "online_payment_checkout_enabled",
      label: "One-tap checkout page",
      on: checkoutOn,
      explain:
        "Pay now opens the fee breakdown with an amount box per child and one Pay button. Needs New payment links on too. Off: the page offers the payment link as before.",
    },
    {
      key: "online_payment_checkout_all_sessions",
      label: "One-tap page for every family",
      on: checkoutOptions.allSessions,
      explain:
        "Off: only test sessions (TEST-, UAT-, DEMO-) get the one-tap page — the pilot. Everyone else keeps the payment link page. Money already paid is always received.",
    },
    {
      key: "online_payment_checkout_modal_enabled",
      label: "Razorpay checkout on the page",
      on: checkoutOptions.razorpayCheckout,
      explain:
        "On: Pay opens Razorpay's checkout. Only works once Razorpay has approved this website's domain. Off: Pay opens a UPI Payment Link and the page shows UPI app buttons.",
    },
    {
      key: "online_payment_waive_late_fees",
      label: "Waive late fees on online payment",
      on: checkoutOptions.waiveLateFees,
      explain:
        "This year only (owner, 2026-10-30). On: the one-tap page shows and asks for fees only, and a payment there forgives every late fee on that child — paid ones too, which then count toward fees. Turn off when late fees are taken again.",
    },
    {
      key: "online_payment_staff_whatsapp_enabled",
      label: "Tell the office on WhatsApp",
      on: staffWhatsappOn,
      explain:
        "On: each online receipt becomes a staff WhatsApp to everybody who collects fees — sent only to people who agreed to WhatsApp, and only while the \"Online payment received\" message is switched on for staff. Off: nobody is told.",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Online payments"
        description="Fees paid through a Pay now link. Every captured payment is either a posted receipt or waiting here for a person."
      />

      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

      <SectionCard title="Switches" description="Payments already made are always received and checked, whatever these say.">
        <ul className="flex flex-col gap-3">
          <li className="text-sm text-muted-foreground">
            Razorpay: {config ? `${config.mode === "live" ? "LIVE" : "Test"} keys set` : "keys not set"} · Webhook:{" "}
            {webhookConfigured ? "secret set" : "secret not set"}
          </li>
          {switchRows.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {row.label}: {row.on ? "On" : "Off"}
                </p>
                <p className="text-xs text-muted-foreground">{row.explain}</p>
              </div>
              {canSwitch ? (
                <form action={setOnlineSwitchAction}>
                  <input type="hidden" name="key" value={row.key} />
                  <input type="hidden" name="value" value={row.on ? "false" : "true"} />
                  <PendingSubmitButton variant="outline" pendingLabel="Saving…">
                    Turn {row.on ? "off" : "on"}
                  </PendingSubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title="Reconciliation"
        description={
          fenced
            ? "By the day the money was captured (India time), for the sessions you can open."
            : "By the day the money was captured (India time)."
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Day</th>
                <th className="py-2 pr-3">Mode</th>
                <th className="py-2 pr-3">Captured</th>
                <th className="py-2 pr-3">On receipts</th>
                <th className="py-2 pr-3">In review</th>
                <th className="py-2 pr-3">Waiting</th>
                <th className="py-2 pr-3">Razorpay fee + GST</th>
              </tr>
            </thead>
            <tbody>
              {(recon.data ?? []).map((row: Record<string, number | string>) => (
                <tr key={`${row.captured_on}-${row.provider_mode}`} className="border-t border-border">
                  <td className="py-2 pr-3">{String(row.captured_on)}</td>
                  <td className="py-2 pr-3">{String(row.provider_mode)}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.captures} · {paiseToInr(Number(row.captured_paise))}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.applied} · {paiseToInr(Number(row.receipted_paise))}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.in_review} · {paiseToInr(Number(row.in_review_paise))}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.awaiting_posting} · {paiseToInr(Number(row.awaiting_posting_paise))}</td>
                  <td className="py-2 pr-3 tabular-nums">{paiseToInr(Number(row.provider_fee_paise))}</td>
                </tr>
              ))}
              {(recon.data ?? []).length === 0 ? (
                <tr><td colSpan={7} className="py-3 text-muted-foreground">No online payments yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title={`Needs a person (${needsAttention.length})`}
        description="Money that arrived and could not become a receipt by itself. Nothing here is lost; nothing here is refunded automatically."
      >
        <ul className="flex flex-col gap-3">
          {needsAttention.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Pill status={row.application_status} />
                <span className="font-semibold tabular-nums">{paiseToInr(row.amount_paise)}</span>
                <span>
                  {row.online_payment_intents?.students
                    ? `${row.online_payment_intents.students.full_name} (${row.online_payment_intents.students.admission_no})`
                    : row.online_payment_orders?.online_payment_order_lines?.length
                      ? row.online_payment_orders.online_payment_order_lines
                          .map((line) => `${line.students?.full_name ?? "?"} (${line.students?.admission_no ?? "?"}) ${formatInr(line.amount_rupees)}`)
                          .join(" · ")
                      : "Student not known"}
                </span>
                <span className="text-xs text-muted-foreground">{row.method ?? ""} · {row.provider_payment_id} · {formatDateTimeIst(row.created_at)}</span>
              </div>
              {row.review_reason ? <p className="text-xs text-foreground">{reviewText(row.review_reason)}</p> : null}
              {row.application_status === "pending" ? (
                <form action={postOnlinePaymentAction}>
                  <input type="hidden" name="captureId" value={row.id} />
                  <PendingSubmitButton pendingLabel="Posting…">Post receipt now</PendingSubmitButton>
                </form>
              ) : canResolve ? (
                <form action={resolveOnlineReviewAction} className="flex flex-wrap gap-2">
                  <input type="hidden" name="captureId" value={row.id} />
                  <input
                    name="note"
                    required
                    minLength={5}
                    placeholder="What was done (e.g. posted at desk SVP…, refunded in Razorpay)"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
                  />
                  <PendingSubmitButton variant="outline" pendingLabel="Saving…">
                    Mark resolved
                  </PendingSubmitButton>
                </form>
              ) : null}
            </li>
          ))}
          {needsAttention.length === 0 ? <li className="text-sm text-muted-foreground">Nothing waiting.</li> : null}
        </ul>
      </SectionCard>

      <SectionCard
        title="Checkout orders"
        description="The latest twenty one-tap payments. One order can cover several children; each child gets their own receipt."
      >
        <ul className="flex flex-col divide-y divide-border text-sm">
          {orderRows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
              <Pill status={row.status} />
              <span className="font-semibold tabular-nums">{formatInr(row.amount_rupees)}</span>
              <span>
                {(row.online_payment_order_lines ?? [])
                  .slice()
                  .sort((a, b) => a.line_no - b.line_no)
                  .map((line) => `${line.students?.full_name ?? "?"} (${line.students?.admission_no ?? "?"}) ${formatInr(line.amount_rupees)}`)
                  .join(" · ")}
              </span>
              <span className="text-xs text-muted-foreground">
                {row.provider_mode} · {formatDateTimeIst(row.created_at)}
                {row.superseded_reason ? ` · ${row.superseded_reason.replaceAll("_", " ")}` : ""}
                {row.last_error ? ` · ${row.last_error}` : ""}
              </span>
            </li>
          ))}
          {orderRows.length === 0 ? <li className="py-2 text-muted-foreground">No checkout orders yet.</li> : null}
        </ul>
      </SectionCard>

      <SectionCard title="Payment links" description="The latest thirty.">
        <ul className="flex flex-col divide-y divide-border text-sm">
          {intentRows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
              <Pill status={row.status} />
              <span className="font-semibold tabular-nums">{formatInr(row.amount_rupees)}</span>
              <span>{row.students ? `${row.students.full_name} (${row.students.admission_no})` : ""}</span>
              <span className="text-xs text-muted-foreground">
                {row.provider_mode} · {formatDateTimeIst(row.created_at)}
                {row.superseded_reason ? ` · ${row.superseded_reason.replaceAll("_", " ")}` : ""}
                {row.last_error ? ` · ${row.last_error}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title="Receipt messages"
        description="Accepted by the provider is not the same as delivered: AiSensy's Basic plan reports no delivery back."
      >
        <ul className="flex flex-col divide-y divide-border text-sm">
          {(outbox.data ?? []).map((row: { id: string; status: string; attempts: number; last_error: string | null; updated_at: string; payload: { receipt_number?: string } }) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
              <Pill status={row.status} />
              <span>{row.payload?.receipt_number ?? ""}</span>
              <span className="text-xs text-muted-foreground">
                tries {row.attempts} · {formatDateTimeIst(row.updated_at)}
                {row.last_error ? ` · ${row.last_error}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title="History"
        description={
          fenced
            ? "Switch changes, newest first. The full trail names payments in every session and is shown to the administrator."
            : "Every decision about online money, newest first. It cannot be edited."
        }
      >
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {(audit.data ?? []).map((row: { id: number; action: string; actor: string; created_at: string }) => (
            <li key={row.id}>
              {formatDateTimeIst(row.created_at)} · {row.action.replaceAll("_", " ")} · {row.actor}
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
