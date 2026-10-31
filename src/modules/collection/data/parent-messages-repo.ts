import "server-only";

import { createHash } from "node:crypto";

import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { normalisePhone } from "@/modules/collection/domain/fields";
import type { MessageSend } from "@/modules/collection/domain/messages";
import {
  exceptionIsNamed,
  staleReasons,
  type ParentCategory,
  type ParentPolicy,
  type ParentSnapshot,
  type StaleReason,
} from "@/modules/collection/domain/parent-policy";

/**
 * Parent messages: the policy, the snapshot an approval rests on, and the
 * routes somebody has said are wrong (P9).
 *
 * Every function here runs on the service role after the caller has checked
 * the actor's permission. None of them sends anything: the app hands a parent
 * message to a provider only through `dispatch()`, which asks
 * `mayDispatchToParent()` first.
 */

type PolicyRow = {
  category: ParentCategory;
  label_hi: string;
  label_en: string;
  approval_required: boolean;
  auto_recipients: string | null;
  auto_trigger: string | null;
  auto_content: string | null;
  auto_correction: string | null;
  policy_version: number;
};

const toPolicy = (row: PolicyRow): ParentPolicy => ({
  category: row.category,
  labelHi: row.label_hi,
  labelEn: row.label_en,
  approvalRequired: row.approval_required,
  autoRecipients: row.auto_recipients,
  autoTrigger: row.auto_trigger,
  autoContent: row.auto_content,
  autoCorrection: row.auto_correction,
  policyVersion: row.policy_version,
});

export async function parentPolicies(): Promise<ParentPolicy[]> {
  const { data, error } = await createAdminClient()
    .from("parent_message_policies")
    .select("category, label_hi, label_en, approval_required, auto_recipients, auto_trigger, auto_content, auto_correction, policy_version")
    .order("category")
    .returns<PolicyRow[]>();
  if (error) throw new Error(`Could not read the parent message policy: ${error.message}`);
  return data.map(toPolicy);
}

/**
 * Change one category's policy. Any change moves its version, so every
 * message approved under the old one has to be looked at again. The caller is
 * an administrator; the database refuses an exception that does not name all
 * four things.
 */
export async function savePolicy(input: {
  category: ParentCategory;
  approvalRequired: boolean;
  autoRecipients: string | null;
  autoTrigger: string | null;
  autoContent: string | null;
  autoCorrection: string | null;
  actorStaffId: string;
}): Promise<"saved" | "stale"> {
  if (!input.approvalRequired && !exceptionIsNamed(input)) {
    throw new Error("An automatic exception must name its recipients, trigger, content and correction.");
  }
  const admin = createAdminClient();
  const { data: current, error: readError } = await admin
    .from("parent_message_policies")
    .select("policy_version")
    .eq("category", input.category)
    .single<{ policy_version: number }>();
  if (readError) throw new Error(`Could not read that policy: ${readError.message}`);
  const { data: saved, error } = await admin
    .from("parent_message_policies")
    .update({
      approval_required: input.approvalRequired,
      auto_recipients: input.autoRecipients,
      auto_trigger: input.autoTrigger,
      auto_content: input.autoContent,
      auto_correction: input.autoCorrection,
      policy_version: current.policy_version + 1,
      updated_by: input.actorStaffId,
      updated_at: new Date().toISOString(),
    })
    .eq("category", input.category)
    .eq("policy_version", current.policy_version)
    .select("category");
  if (error) throw new Error(`Could not save that policy: ${error.message}`);
  // Somebody else saved this category between the read and the write; theirs
  // stands, and this one is not quietly applied on top of it.
  if ((saved ?? []).length === 0) return "stale";
  return "saved";
}

/** Whether the school's switch lets the app dispatch to parents at all. */
export async function parentDispatchSwitch(): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("runtime_flags")
    .select("enabled")
    .eq("key", "parent_dispatch")
    .maybeSingle<{ enabled: boolean }>();
  return data?.enabled === true;
}

/**
 * How far the app may dispatch to parents: `on` (parent_dispatch), `test_only`
 * (parent_dispatch off, `parent_dispatch_test_only` on — owner, 31 Oct), or
 * `off`. In `test_only` the dispatcher lets a message reach the provider and
 * the parent-send gate holds it to `message_test_recipients`
 * (`checkTestOnlySend`), so One's own `_v7` notices can be checked on the
 * approved numbers while every real parent stays closed. A failed read is
 * `off`. Screens that show the school's switch keep reading
 * `parentDispatchSwitch`: test-only mode is not "on".
 */
export async function parentDispatchMode(): Promise<"on" | "test_only" | "off"> {
  const { data, error } = await createAdminClient()
    .from("runtime_flags")
    .select("key, enabled")
    .in("key", ["parent_dispatch", "parent_dispatch_test_only"]);
  if (error) return "off";
  const on = (key: string) => (data ?? []).some((row: { key: string; enabled: boolean }) => row.key === key && row.enabled === true);
  if (on("parent_dispatch")) return "on";
  return on("parent_dispatch_test_only") ? "test_only" : "off";
}

/* ------------------------------------------------------------ snapshots */

/** The category a parent message belongs to: a request it answers, or anything else. */
export function categoryFor(input: { requestId: string | null }): ParentCategory {
  return input.requestId ? "collection_request" : "general";
}

/** The text hash a parent snapshot carries; exported so bulk queues compute the same one. */
export const contentHash = (renderedHi: string, renderedEn: string) =>
  createHash("sha256").update(`${renderedHi}\n--\n${renderedEn}`).digest("hex");

/**
 * What a parent message rests on, as it is now: the destination, the
 * guardian number on the child's record, the version of what it is about, the
 * text and the policy version.
 */
export async function snapshotNow(input: {
  toPhone: string;
  studentId: string | null;
  requestId: string | null;
  renderedHi: string;
  renderedEn: string;
  category: ParentCategory;
}): Promise<ParentSnapshot> {
  const admin = createAdminClient();

  const [student, request, policy] = await Promise.all([
    input.studentId
      ? admin
          .schema(FEE_SCHEMA)
          .from("students")
          .select("guardian_phone, primary_phone")
          .eq("id", input.studentId)
          .maybeSingle<{ guardian_phone: string | null; primary_phone: string | null }>()
      : Promise.resolve({ data: null }),
    input.requestId
      ? admin
          .from("collection_requests")
          .select("id, updated_at")
          .eq("id", input.requestId)
          .maybeSingle<{ id: string; updated_at: string }>()
      : Promise.resolve({ data: null }),
    admin
      .from("parent_message_policies")
      .select("policy_version")
      .eq("category", input.category)
      .maybeSingle<{ policy_version: number }>(),
  ]);

  const guardian = student.data?.guardian_phone ?? student.data?.primary_phone ?? null;
  return {
    destination: normalisePhone(input.toPhone),
    contact: guardian ? normalisePhone(guardian) : null,
    record: input.requestId
      ? { kind: "request", id: input.requestId, version: request.data?.updated_at ?? null }
      : input.studentId
        ? { kind: "student", id: input.studentId, version: null }
        : { kind: "none", id: null, version: null },
    content: contentHash(input.renderedHi, input.renderedEn),
    policyVersion: policy.data?.policy_version ?? 0,
  };
}

/** Whether a number has an open "wrong number" flag. */
export async function routeFlagged(phone: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("parent_route_flags")
    .select("id")
    .eq("phone", normalisePhone(phone))
    .is("cleared_at", null)
    .limit(1);
  return (data ?? []).length > 0;
}

type SendExtras = { category: ParentCategory; snapshot: ParentSnapshot | null; approved_at: string | null };

async function extrasOf(sendId: string): Promise<SendExtras | null> {
  const { data } = await createAdminClient()
    .from("message_sends")
    .select("category, snapshot, approved_at")
    .eq("id", sendId)
    .maybeSingle<SendExtras>();
  return data ?? null;
}

/**
 * Compare a parent message's snapshot with today's. A message queued before
 * snapshots existed has none, and is treated as needing a fresh look.
 */
export async function staleness(send: MessageSend): Promise<{ reasons: StaleReason[]; extras: SendExtras | null }> {
  const extras = await extrasOf(send.id);
  const now = await snapshotNow({
    toPhone: send.toPhone,
    studentId: send.studentId,
    requestId: send.requestId,
    renderedHi: send.renderedHi,
    renderedEn: send.renderedEn,
    category: extras?.category ?? categoryFor(send),
  });
  const flagged = await routeFlagged(send.toPhone);
  if (!extras?.snapshot) {
    return { reasons: flagged ? ["route_flagged"] : ["record_changed"], extras };
  }
  return { reasons: staleReasons(extras.snapshot, now, flagged), extras };
}

/** Say so on the row, so the queue shows it and nobody sends it as it was. */
export async function markStale(sendId: string, reasons: StaleReason[]): Promise<void> {
  await createAdminClient()
    .from("message_sends")
    .update({ stale_at: new Date().toISOString(), stale_reason: reasons.join(",") })
    .eq("id", sendId)
    .neq("status", "sent");
}

export async function markApproved(sendId: string, actorStaffId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("message_sends")
    .update({ approved_by: actorStaffId, approved_at: new Date().toISOString(), stale_at: null, stale_reason: null })
    .eq("id", sendId)
    .neq("status", "sent");
  if (error) throw new Error(`Could not record the approval: ${error.message}`);
}

/* --------------------------------------------------------- wrong numbers */

export type RouteFlag = {
  id: string;
  phone: string;
  studentId: string | null;
  reason: string;
  flaggedAt: string;
  flaggedByName: string | null;
};

/**
 * Somebody says a parent number is wrong. Nothing more goes to it while the
 * flag is open: every unsent message to it is withdrawn, with the reason, and
 * the flag is kept for an administrator to look at. A real send already made
 * is never touched — it is the record of what was disclosed.
 */
export async function flagRoute(input: {
  phone: string;
  studentId: string | null;
  reason: string;
  actorStaffId: string;
}): Promise<{ withdrawn: number }> {
  const admin = createAdminClient();
  const phone = normalisePhone(input.phone);
  const { error } = await admin.from("parent_route_flags").insert({
    phone,
    student_id: input.studentId,
    reason: input.reason,
    flagged_by: input.actorStaffId,
  });
  if (error) throw new Error(`Could not flag that number: ${error.message}`);

  const { data: withdrawn, error: withdrawError } = await admin
    .from("message_sends")
    .update({ status: "cancelled", error: "Withdrawn: the number was reported as wrong", stale_reason: "route_flagged" })
    .eq("to_phone", phone)
    // Unknown failed sends may already have reached the provider. Preserve
    // their evidence for reconciliation; the route flag blocks future sends.
    .in("status", ["draft", "queued"])
    .is("provider_message_id", null)
    .select("id");
  if (withdrawError) throw new Error(`Could not withdraw the messages: ${withdrawError.message}`);
  return { withdrawn: (withdrawn ?? []).length };
}

export async function openRouteFlags(): Promise<RouteFlag[]> {
  const { data, error } = await createAdminClient()
    .from("parent_route_flags")
    .select("id, phone, student_id, reason, flagged_at, staff_profiles(display_name)")
    .is("cleared_at", null)
    .order("flagged_at", { ascending: false })
    .returns<
      {
        id: string;
        phone: string;
        student_id: string | null;
        reason: string;
        flagged_at: string;
        staff_profiles: { display_name: string } | null;
      }[]
    >();
  if (error) throw new Error(`Could not read the flagged numbers: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    phone: row.phone,
    studentId: row.student_id,
    reason: row.reason,
    flaggedAt: row.flagged_at,
    flaggedByName: row.staff_profiles?.display_name ?? null,
  }));
}

/** An administrator clears a flag, saying why; the flag itself is kept. */
export async function clearRouteFlag(input: { id: string; note: string; actorStaffId: string }): Promise<void> {
  const { error } = await createAdminClient()
    .from("parent_route_flags")
    .update({ cleared_by: input.actorStaffId, cleared_at: new Date().toISOString(), clear_note: input.note })
    .eq("id", input.id)
    .is("cleared_at", null);
  if (error) throw new Error(`Could not clear that flag: ${error.message}`);
}
