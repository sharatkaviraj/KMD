import { t, type Localized } from "@/platform/i18n/language";

/**
 * Messages to parents: approved by a person, against what is true when they
 * go (P9, plan §14).
 *
 * A parent message is never handed to a provider by the app unless three
 * things all hold — the school's switch is on, the category names an
 * automatic exception, and nothing about the message has gone stale — and by
 * default none of them does: a person opens it in their own WhatsApp (D-10).
 *
 * What makes an approval stale is written down once, here. When a message is
 * queued, its **snapshot** keeps the destination, the guardian number on
 * record for the child, the version of the record it is about, a hash of the
 * text and the category's policy version. Approving it and marking it sent
 * each compare that snapshot with today's, and any difference is a reason the
 * person sees — never a silent send to a number that changed on Tuesday.
 */

export const parentCategories = ["collection_request", "report_delivery", "absence_notice", "general"] as const;
export type ParentCategory = (typeof parentCategories)[number];

export type ParentPolicy = {
  category: ParentCategory;
  labelHi: string;
  labelEn: string;
  approvalRequired: boolean;
  autoRecipients: string | null;
  autoTrigger: string | null;
  autoContent: string | null;
  autoCorrection: string | null;
  policyVersion: number;
};

/** An automatic exception is real only when it names all four things. */
export function exceptionIsNamed(policy: Pick<ParentPolicy, "autoRecipients" | "autoTrigger" | "autoContent" | "autoCorrection">): boolean {
  return [policy.autoRecipients, policy.autoTrigger, policy.autoContent, policy.autoCorrection].every(
    (field) => typeof field === "string" && field.trim() !== "",
  );
}

export type ParentSnapshot = {
  /** The number the message was going to. */
  destination: string;
  /** The guardian number on the child's record when it was queued, or null. */
  contact: string | null;
  /** The record it is about and its version, e.g. a collection request's last change. */
  record: { kind: "request" | "student" | "none"; id: string | null; version: string | null };
  /** A hash of the text exactly as it would read. */
  content: string;
  policyVersion: number;
};

export type StaleReason =
  | "destination_changed"
  | "contact_changed"
  | "record_changed"
  | "content_changed"
  | "policy_changed"
  | "route_flagged";

/**
 * Why an approval no longer holds, or an empty list when it does.
 *
 * Every difference is reported, not just the first: "the number changed and
 * the request was corrected" is two things a person should check.
 */
export function staleReasons(was: ParentSnapshot, now: ParentSnapshot, routeFlagged: boolean): StaleReason[] {
  const reasons: StaleReason[] = [];
  if (was.destination !== now.destination) reasons.push("destination_changed");
  if (was.contact !== now.contact) reasons.push("contact_changed");
  if (was.record.version !== now.record.version) reasons.push("record_changed");
  if (was.content !== now.content) reasons.push("content_changed");
  if (was.policyVersion !== now.policyVersion) reasons.push("policy_changed");
  if (routeFlagged) reasons.push("route_flagged");
  return reasons;
}

export const staleReasonLabels: Record<StaleReason, Localized> = {
  destination_changed: t("भेजने का नंबर बदल गया है", "The number it was going to has changed"),
  contact_changed: t(
    "बच्चे के रिकॉर्ड में अभिभावक का नंबर बदल गया है",
    "The guardian's number on the child's record has changed",
  ),
  record_changed: t("जिसके बारे में संदेश है वह बदल गया है", "What the message is about has changed since"),
  content_changed: t("संदेश का पाठ बदल गया है", "The text has changed"),
  policy_changed: t("अभिभावक संदेश का नियम बदल गया है", "The parent message policy has changed"),
  route_flagged: t("इस नंबर को गलत बताया गया है", "This number has been reported as wrong"),
};

/**
 * Whether the app itself may hand a parent message to a provider.
 *
 * Off unless the switch is on, the category's policy names an automatic
 * exception, and nothing is stale. Even then the provider gate applies — this
 * says "may", the transport says whether anything is configured to send.
 */
export function mayDispatchToParent(input: {
  switchOn: boolean;
  policy: Pick<ParentPolicy, "approvalRequired" | "autoRecipients" | "autoTrigger" | "autoContent" | "autoCorrection"> | null;
  stale: StaleReason[];
}): { ok: true } | { ok: false; reason: Localized } {
  if (!input.switchOn) {
    return {
      ok: false,
      reason: t(
        "अभिभावक को संदेश व्यक्ति स्वयं भेजता है — व्हाट्सएप खोलें।",
        "A message to a parent is sent by a person: open it in WhatsApp and press send (D-10).",
      ),
    };
  }
  if (!input.policy || input.policy.approvalRequired || !exceptionIsNamed(input.policy)) {
    return {
      ok: false,
      reason: t(
        "इस प्रकार के संदेश को व्यक्ति की स्वीकृति चाहिए।",
        "This kind of message needs a person to approve it.",
      ),
    };
  }
  if (input.stale.length > 0) {
    return { ok: false, reason: staleReasonLabels[input.stale[0]] };
  }
  return { ok: true };
}
