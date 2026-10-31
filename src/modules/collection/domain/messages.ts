import { z } from "zod";

import { encodeMessage, t, type Localized } from "@/platform/i18n/language";
import { normalisePhone, PHONE_LENGTH } from "@/modules/collection/domain/fields";

/**
 * WhatsApp templates, and the queue that never sends by itself.
 *
 * Ported in shape from `sampark/src/lib/whatsapp-templates.ts` and
 * `send-queue.ts`. The rule that shapes all of it is D-10, which predates this
 * app: **a parent-facing message is pressed by a person.** Not because an
 * automatic send is hard, but because the day one goes out wrong it goes out
 * wrong to four hundred families at once, and there is no recall.
 *
 * So the machinery here stops one step short. It works out exactly what would
 * be sent, to whom, and shows it — and then a person either opens their own
 * WhatsApp with the text already filled in (`wa.me`, which sends nothing until
 * they tap send), or presses a button that hands one queued row to the
 * provider. The second path needs credentials this app does not carry by
 * default; see `sendQueued()` in the data layer.
 */

export const sendStatuses = ["draft", "queued", "sent", "failed", "cancelled"] as const;
export type SendStatus = (typeof sendStatuses)[number];

export const sendStatusLabels: Record<SendStatus, Localized> = {
  draft: t("तैयार", "Ready"),
  queued: t("भेजने को", "To send"),
  sent: t("भेजा गया", "Sent"),
  failed: t("नहीं गया", "Failed"),
  cancelled: t("रद्द", "Cancelled"),
};

export const messageAudiences = ["staff", "parent"] as const;
export type MessageAudience = (typeof messageAudiences)[number];

export const messageAudienceLabels: Record<MessageAudience, Localized> = {
  staff: t("स्टाफ़", "Staff"),
  parent: t("अभिभावक", "Parents"),
};

export type MessageTemplate = {
  id: string;
  code: string;
  labelHi: string;
  labelEn: string;
  bodyHi: string;
  bodyEn: string;
  variables: string[];
  hasUrlButton: boolean;
  audience: MessageAudience;
  isActive: boolean;
  sortOrder: number;
};

/** The task namespace belongs exclusively to the reviewed task RPC/dispatcher. */
export function isTeacherTaskCampaign(code: string | undefined): boolean {
  return /^[A-Za-z0-9_-]+_teacher_task(?:_|$)/.test(code ?? "");
}

export function isGenericMessageTemplate(template: MessageTemplate): boolean {
  return template.isActive && !isTeacherTaskCampaign(template.code);
}

export type MessageSend = {
  /** Only the reviewed task RPC path can create these sends. Never a browser input. */
  taskId?: string;
  buttonSuffix?: string;
  id: string;
  /**
   * The academic session the message belongs to (`message_sends.session_label`).
   * The parent-send gate holds a TEST-session message to the test-recipient
   * allowlist whoever presses Send; a send without one is held to it too.
   */
  sessionLabel?: string | null;
  templateId: string;
  templateCode: string;
  templateLabelHi: string;
  templateLabelEn: string;
  audience: MessageAudience;
  toPhone: string;
  toName: string | null;
  studentId: string | null;
  requestId: string | null;
  staffProfileId: string | null;
  variables: string[];
  renderedHi: string;
  renderedEn: string;
  status: SendStatus;
  providerMessageId: string | null;
  error: string | null;
  requestedByName: string | null;
  requestedAt: string;
  /** P9: when a person approved it, and why it went out of date if it did. */
  approvedAt?: string | null;
  staleReason?: string | null;
  sentAt: string | null;
  updatedAt?: string;
};

/**
 * Fill a template's numbered placeholders.
 *
 * `{{1}}` is the first variable, and a placeholder with no value is left
 * standing rather than blanked: a message reading "Dear {{2}}" is obviously
 * unfinished, where one reading "Dear " looks sent and is not recoverable.
 */
export function render(body: string, variables: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (whole, index: string) => {
    const value = variables[Number(index) - 1];
    return value === undefined || value === "" ? whole : value;
  });
}

/** The placeholders a body actually uses, in order, deduplicated. */
export function placeholdersIn(body: string): number[] {
  const found = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  return [...new Set(found)].sort((a, b) => a - b);
}

export type RenderCheck =
  | { ok: true }
  | { ok: false; reason: Localized };

/**
 * Whether this message is ready to be seen by anybody outside the school.
 *
 * A placeholder left standing is the failure this catches. It is cheap to
 * check and expensive to miss: "Dear {{2}}, your fee of {{3}}" is the sort of
 * message a school gets remembered for.
 */
export function checkRendered(text: string): RenderCheck {
  if (placeholdersIn(text).length > 0) {
    return {
      ok: false,
      reason: t(
        "संदेश में कुछ खाली रह गया है।",
        "Something in the message has not been filled in.",
      ),
    };
  }

  if (text.trim() === "") {
    return {
      ok: false,
      reason: t("संदेश खाली है।", "The message is empty."),
    };
  }

  return { ok: true };
}

export function checkPhone(raw: string): RenderCheck {
  const digits = normalisePhone(raw);

  if (digits.length !== PHONE_LENGTH || !/^[6-9]/.test(digits)) {
    return {
      ok: false,
      reason: t(
        "दस अंकों का मोबाइल नंबर चाहिए।",
        "That is not a ten-digit mobile number.",
      ),
    };
  }

  return { ok: true };
}

/**
 * Whether the app may hand this row to the provider at all.
 *
 * Both halves matter. The status check stops a message being sent twice — the
 * expensive mistake, because a parent who gets the same fee reminder four
 * times rings the office. The audience check is D-10 in executable form: a
 * parent-facing row is never dispatched by the app, only opened in somebody's
 * own WhatsApp.
 */
export function isConfirmedProviderRejection(error: string | null | undefined): boolean {
  return typeof error === "string" && (error.startsWith("Provider rejected this request: ")
    || /^The provider refused it \((400|401|403|404|422|429)\)\.$/.test(error));
}
export function needsProviderReconciliation(send: Pick<MessageSend, "status"> & Partial<Pick<MessageSend, "providerMessageId" | "error">>): boolean {
  if (send.status === "sent" || send.status === "cancelled") return false;
  return send.providerMessageId != null || (send.status === "failed" && !isConfirmedProviderRejection(send.error));
}
export function mayDispatch(send: Pick<MessageSend, "status" | "audience"> & Partial<Pick<MessageSend, "providerMessageId" | "error">>): RenderCheck {
  if (needsProviderReconciliation(send)) return { ok: false, reason: t("प्रदाता का परिणाम जाँचे बिना दोबारा न भेजें।", "Check the provider result before sending again.") };
  if (send.status === "sent") {
    return {
      ok: false,
      reason: t("यह पहले ही भेजा जा चुका है।", "This has already been sent."),
    };
  }

  if (send.status === "cancelled") {
    return {
      ok: false,
      reason: t("यह रद्द कर दिया गया था।", "This was cancelled."),
    };
  }

  if (send.audience === "parent") {
    return {
      ok: false,
      reason: t(
        "अभिभावक को संदेश व्यक्ति स्वयं भेजता है — व्हाट्सएप खोलें।",
        "A message to a parent is sent by a person: open it in WhatsApp and press send (D-10).",
      ),
    };
  }

  return { ok: true };
}

/** Waiting first, then newest — the order the office works down. */
export function bySendOrder(a: MessageSend, b: MessageSend): number {
  const rank = (status: SendStatus) =>
    status === "queued" ? 0 : status === "draft" ? 1 : status === "failed" ? 2 : 3;

  const byStatus = rank(a.status) - rank(b.status);
  if (byStatus !== 0) return byStatus;
  return a.requestedAt < b.requestedAt ? 1 : -1;
}

export function queuedCount(sends: MessageSend[]): number {
  return sends.filter((send) => send.status === "queued" || send.status === "draft")
    .length;
}

/* ----------------------------------------------------------- validation */

export const templateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/, {
      message: encodeMessage(
        t(
          "कोड में अक्षर, अंक, _ और - ही चलेंगे",
          "A code is letters, digits, underscores and dashes — it has to match the provider exactly",
        ),
      ),
    }),
  labelHi: z.string().trim().min(1).max(80),
  labelEn: z.string().trim().min(1).max(80),
  bodyHi: z.string().trim().min(1).max(1024),
  bodyEn: z.string().trim().min(1).max(1024),
  variables: z.array(z.string().trim().max(40)),
  hasUrlButton: z.boolean(),
  audience: z.enum(messageAudiences),
  sortOrder: z.coerce.number().int().min(0).max(999),
});

export type TemplateInput = z.infer<typeof templateSchema>;

export const queueSchema = z.object({
  templateId: z.uuid({
    message: encodeMessage(t("टेम्पलेट चुनें", "Choose a template")),
  }),
  toPhone: z.string().trim().min(1, {
    message: encodeMessage(t("नंबर भरें", "Enter a number")),
  }),
  toName: z
    .string()
    .trim()
    .max(80)
    .transform((value) => (value === "" ? null : value))
    .nullable(),
  variables: z.array(z.string().trim().max(200)),
  studentId: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable(),
  requestId: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable(),
  staffProfileId: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable(),
});

export type QueueInput = z.infer<typeof queueSchema>;
