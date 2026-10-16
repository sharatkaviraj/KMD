"use server";

import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { ms } from "@/messages/setup";
import { assertPermission } from "@/platform/auth/current-staff";
import { decodeMessage, t, type Localized } from "@/platform/i18n/language";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import {
  setFieldActive,
  upsertField,
} from "@/modules/collection/data/fields-repo";
import {
  createRequest,
  rotateToken,
  setRequestStatus,
} from "@/modules/collection/data/requests-repo";
import { decideSubmissions } from "@/modules/collection/data/submissions-repo";
import {
  cancelSend,
  confirmDispatchReceived,
  dispatch,
  getSend,
  listTemplates,
  markSentByHand,
  queueSend,
  setTemplateActive,
  upsertTemplate,
} from "@/modules/collection/data/messages-repo";
import {
  deleteDocument,
  storeDocument,
} from "@/modules/collection/data/documents-repo";
import { fieldSchema, slugFieldKey } from "@/modules/collection/domain/fields";
import {
  requestInputSchema,
  type RequestStatus,
} from "@/modules/collection/domain/requests";
import { decideSchema, decisionSentence } from "@/modules/collection/domain/review";
import { assertNotPreviewing } from "@/vx/view-as";
import { needsProviderReconciliation, isGenericMessageTemplate } from "@/modules/collection/domain/messages";
import {
  checkDocument,
  documentKinds,
  type DocumentKind,
} from "@/modules/collection/domain/review";
import { queueSchema, templateSchema } from "@/modules/collection/domain/messages";
import {
  idleCollectionState,
  type CollectionState,
} from "@/modules/collection/domain/form-state";
import {
  clearRouteFlag,
  flagRoute,
  markApproved,
  markStale,
  routeFlagged,
  savePolicy,
  staleness,
} from "@/modules/collection/data/parent-messages-repo";
import { parentCategories, staleReasonLabels, type ParentCategory } from "@/modules/collection/domain/parent-policy";
import type { ParentSendState } from "@/modules/collection/domain/parent-send-state";
import { waMeLink } from "@/modules/collection/domain/requests";

function failure(message: Localized): CollectionState {
  return { status: "error", message };
}

function fieldErrorsFrom(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Localized {
  return decodeMessage(error.issues[0]?.message ?? "");
}

const stringsFrom = (formData: FormData, field: string) =>
  formData
    .getAll(field)
    .map((value) => value.toString().trim())
    .filter(Boolean);

/* ------------------------------------------------------------- fields */

export async function saveFieldAction(
  _previous: CollectionState,
  formData: FormData,
): Promise<CollectionState> {
  const actor = await assertPermission("collection:manage");

  const labelEn = (formData.get("labelEn") ?? "").toString();
  const givenKey = (formData.get("key") ?? "").toString().trim();

  // The office types a label; the key is derived. Asking somebody to invent a
  // database identifier and then refusing what they type is the sort of form
  // people stop using.
  const key = givenKey || slugFieldKey(labelEn);

  if (!key) {
    return failure(
      t(
        "नाम में कुछ अंग्रेज़ी अक्षर होने चाहिए।",
        "The English label needs some letters in it, so a key can be made from it.",
      ),
    );
  }

  const options = stringsFrom(formData, "options");

  const parsed = fieldSchema.safeParse({
    key,
    labelHi: (formData.get("labelHi") ?? "").toString(),
    labelEn,
    inputType: (formData.get("inputType") ?? "text").toString(),
    mode: (formData.get("mode") ?? "confirm").toString(),
    exactLen: (formData.get("exactLen") ?? "").toString() || null,
    maxValue: (formData.get("maxValue") ?? "").toString() || null,
    options: options.length > 0 ? options : null,
    feeColumn: (formData.get("feeColumn") ?? "").toString(),
    helpHi: (formData.get("helpHi") ?? "").toString(),
    helpEn: (formData.get("helpEn") ?? "").toString(),
    sortOrder: (formData.get("sortOrder") ?? "0").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  try {
    await upsertField(parsed.data, actor.userId);
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath("/collection/fields");
  return { ...idleCollectionState, status: "saved" };
}

export async function retireFieldAction(formData: FormData) {
  await assertPermission("collection:manage");

  const id = (formData.get("id") ?? "").toString();
  if (!id) return;

  await setFieldActive(id, formData.get("active") === "true");
  revalidatePath("/collection/fields");
}

/* ----------------------------------------------------------- requests */

export async function createRequestAction(
  _previous: CollectionState,
  formData: FormData,
): Promise<CollectionState> {
  const actor = await assertPermission("collection:manage");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const parsed = requestInputSchema.safeParse({
    titleHi: (formData.get("titleHi") ?? "").toString(),
    titleEn: (formData.get("titleEn") ?? "").toString(),
    classId: (formData.get("classId") ?? "").toString(),
    assignedStaffId: (formData.get("assignedStaffId") ?? "").toString(),
    fieldIds: stringsFrom(formData, "fieldIds"),
    dueDate: (formData.get("dueDate") ?? "").toString(),
    reasonHi: (formData.get("reasonHi") ?? "").toString(),
    reasonEn: (formData.get("reasonEn") ?? "").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  const labels = await classLabelMap(sessionLabel);
  const classLabel = labels.get(parsed.data.classId);
  if (!classLabel) return failure(m.notSaved);

  try {
    await createRequest(parsed.data, classLabel, sessionLabel, actor.userId);
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath("/collection");
  return { ...idleCollectionState, status: "saved" };
}

export async function setRequestStatusAction(formData: FormData) {
  await assertPermission("collection:manage");

  const id = (formData.get("id") ?? "").toString();
  const status = (formData.get("status") ?? "").toString() as RequestStatus;
  if (!id || !["draft", "open", "closed"].includes(status)) return;

  await setRequestStatus(id, status);
  revalidatePath("/collection");
  revalidatePath(`/collection/${id}`);
}

export async function rotateTokenAction(formData: FormData) {
  await assertPermission("collection:manage");

  const id = (formData.get("id") ?? "").toString();
  if (!id) return;

  await rotateToken(id);
  revalidatePath(`/collection/${id}`);
}

/* ------------------------------------------------------------- review */

export async function decideSubmissionsAction(
  _previous: CollectionState,
  formData: FormData,
): Promise<CollectionState> {
  const actor = await assertPermission("collection:manage");
  if (actor.role !== "admin") return failure(m.accessDenied);

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const parsed = decideSchema.safeParse({
    submissionIds: stringsFrom(formData, "submissionIds"),
    accept: formData.get("accept") === "true",
    commandId: (formData.get("commandId") ?? "").toString(),
    replaceNewer: formData.get("replaceNewer") === "true",
    note: (formData.get("note") ?? "").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  const receipt = await decideSubmissions({
    commandId: parsed.data.commandId,
    submissionIds: parsed.data.submissionIds,
    accept: parsed.data.accept,
    note: parsed.data.note,
    replaceNewer: parsed.data.replaceNewer,
    deciderStaffId: actor.id,
    sessionLabel,
  });
  if (!receipt.ok) return failure(receipt.reason === "not_permitted" ? m.accessDenied : m.notSaved);

  revalidatePath("/collection/review");
  revalidatePath("/collection");

  const refusedFor = (reason: string) => receipt.refused.filter((entry) => entry.reason === reason).length;
  return {
    ...idleCollectionState,
    status: receipt.refused.length > 0 ? "error" : "saved",
    message: decisionSentence({
      accept: parsed.data.accept,
      decided: receipt.decided,
      recorded: receipt.recorded,
      confirmed: receipt.confirmed,
      alreadyDecided: receipt.alreadyDecided,
      superseded: refusedFor("superseded"),
      recordMoved: refusedFor("record_moved"),
    }),
  };
}

/* ---------------------------------------------------------- documents */

export async function uploadDocumentAction(
  _previous: CollectionState,
  formData: FormData,
): Promise<CollectionState> {
  const actor = await assertPermission("documents:manage");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const studentId = (formData.get("studentId") ?? "").toString();
  const kindRaw = (formData.get("kind") ?? "other").toString();
  const kind = (documentKinds as readonly string[]).includes(kindRaw)
    ? (kindRaw as DocumentKind)
    : "other";

  const file = formData.get("file");
  if (!studentId || !(file instanceof File) || file.size === 0) {
    return failure(t("फ़ाइल चुनें", "Choose a file"));
  }

  const allowed = checkDocument({
    contentType: file.type,
    byteSize: file.size,
  });

  if (!allowed.ok) return failure(allowed.reason);

  try {
    await storeDocument({
      sessionLabel,
      studentId,
      kind,
      fileName: file.name,
      contentType: file.type,
      bytes: await file.arrayBuffer(),
      note: (formData.get("note") ?? "").toString().trim() || null,
      uploadedByStaffId: actor.id,
    });
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath(`/teach/student/${studentId}`);
  return { ...idleCollectionState, status: "saved" };
}

export async function deleteDocumentAction(formData: FormData) {
  await assertPermission("documents:manage");

  const id = (formData.get("id") ?? "").toString();
  const studentId = (formData.get("studentId") ?? "").toString();
  if (!id) return;

  await deleteDocument(id);
  if (studentId) revalidatePath(`/teach/student/${studentId}`);
}

/* ----------------------------------------------------------- messages */

export async function saveTemplateAction(
  _previous: CollectionState,
  formData: FormData,
): Promise<CollectionState> {
  await assertPermission("collection:manage");

  const parsed = templateSchema.safeParse({
    code: (formData.get("code") ?? "").toString(),
    labelHi: (formData.get("labelHi") ?? "").toString(),
    labelEn: (formData.get("labelEn") ?? "").toString(),
    bodyHi: (formData.get("bodyHi") ?? "").toString(),
    bodyEn: (formData.get("bodyEn") ?? "").toString(),
    variables: stringsFrom(formData, "variables"),
    hasUrlButton: formData.get("hasUrlButton") === "on",
    audience: (formData.get("audience") ?? "staff").toString(),
    sortOrder: (formData.get("sortOrder") ?? "0").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  try {
    await upsertTemplate(parsed.data);
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath("/collection/messages");
  return { ...idleCollectionState, status: "saved" };
}

export async function setTemplateActiveAction(formData: FormData) {
  await assertPermission("collection:manage");

  const id = (formData.get("id") ?? "").toString();
  if (!id) return;

  await setTemplateActive(id, formData.get("active") === "true");
  revalidatePath("/collection/messages");
}

export async function queueMessageAction(
  _previous: CollectionState,
  formData: FormData,
): Promise<CollectionState> {
  const actor = await assertPermission("collection:manage");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const parsed = queueSchema.safeParse({
    templateId: (formData.get("templateId") ?? "").toString(),
    toPhone: (formData.get("toPhone") ?? "").toString(),
    toName: (formData.get("toName") ?? "").toString(),
    variables: stringsFrom(formData, "variables"),
    studentId: (formData.get("studentId") ?? "").toString(),
    requestId: (formData.get("requestId") ?? "").toString(),
    staffProfileId: (formData.get("staffProfileId") ?? "").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  const template = (await listTemplates()).find(
    (entry) => entry.id === parsed.data.templateId,
  );
  if (!template || !isGenericMessageTemplate(template)) return failure(m.notSaved);

  // A number somebody reported as wrong takes no new parent message until an
  // administrator clears it (P9, D-232). Staff messages are not routed by it.
  if (template.audience === "parent" && (await routeFlagged(parsed.data.toPhone))) {
    return failure(ms.messagesNumberFlagged);
  }

  try {
    await queueSend({
      queue: parsed.data,
      template,
      sessionLabel,
      requestedByStaffId: actor.id,
    });
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath("/collection/messages");
  return { ...idleCollectionState, status: "saved" };
}

/**
 * Hand one queued message to the provider.
 *
 * Refuses a parent-facing row outright — D-10, held in `mayDispatch()` — and
 * refuses everything else without an API key, which this repo does not carry
 * and which rule 8 makes somebody else's decision to add, because sending
 * costs money. Either way the row stays in the queue and the office can open
 * it in WhatsApp themselves.
 */
export async function sendMessageAction(
  _previous: CollectionState,
  formData: FormData,
): Promise<CollectionState> {
  await assertPermission("collection:manage");
  await assertNotPreviewing();

  const id = (formData.get("id") ?? "").toString();
  if (!id) return failure(m.notSaved);

  const send = await getSend(id);
  if (!send) return failure(m.notSaved);

  const result = await dispatch(send);

  revalidatePath("/collection/messages");

  if (!result.ok) {
    return failure(t(result.error, result.error));
  }

  return { ...idleCollectionState, status: "saved" };
}

export async function markSentAction(formData: FormData) {
  const actor = await assertPermission("collection:manage");
  await assertNotPreviewing();

  const id = (formData.get("id") ?? "").toString();
  if (!id) return;

  await markSentByHand(id, actor.id);
  revalidatePath("/collection/messages");
}

export async function cancelSendAction(formData: FormData) {
  await assertPermission("collection:manage");
  await assertNotPreviewing();

  const id = (formData.get("id") ?? "").toString();
  if (!id) return;

  await cancelSend(id);
  revalidatePath("/collection/messages");
}

/* ------------------------------------------------------ parent messages */
export async function confirmProviderResultAction(formData: FormData) {
  const actor = await assertPermission("collection:manage");
  await assertNotPreviewing();
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "");
  if (formData.get("checked") !== "yes" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Confirm the provider log check.");
  const send = await getSend(id);
  if (!send || !needsProviderReconciliation(send)) throw new Error("No provider attempt is waiting for confirmation.");
  await confirmDispatchReceived(id, send.providerMessageId, note, actor.id);
  revalidatePath("/collection/messages");
  revalidatePath("/messages");
}

/**
 * Approve one parent message and open it in WhatsApp (P9).
 *
 * The approval is checked against what is true now, not when it was queued:
 * the number, the guardian number on the child's record, the request it is
 * about, the text and the policy. Any of them changed, or the number was
 * reported as wrong, and it is not approved — the reasons are shown, and the
 * message is marked so nobody sends it as it was.
 */
export async function approveParentMessageAction(
  _previous: ParentSendState,
  formData: FormData,
): Promise<ParentSendState> {
  const actor = await assertPermission("collection:manage");
  const id = (formData.get("id") ?? "").toString();
  const send = id ? await getSend(id) : null;
  if (!send || send.audience !== "parent") return { status: "error", message: m.notFound };
  if (send.taskId) return { status: "error", message: ms.taskPreview };
  if (send.status === "sent" || send.status === "cancelled") return { status: "error", message: ms.messagesAlreadyClosed };

  const { reasons } = await staleness(send);
  if (reasons.length > 0) {
    await markStale(send.id, reasons);
    revalidatePath("/collection/messages");
    return { status: "stale", reasons: reasons.map((reason) => staleReasonLabels[reason]) };
  }

  await markApproved(send.id, actor.id);
  revalidatePath("/collection/messages");
  return {
    status: "approved",
    link: waMeLink(send.toPhone, actor.language === "en" ? send.renderedEn : send.renderedHi),
  };
}

/**
 * Say an approved parent message was sent (P9).
 *
 * It is recorded whatever has changed since: a message that went is a
 * disclosure that happened, and the record of it is kept, never coalesced
 * away. What changed between approving and now is returned as a warning, so
 * the office can prepare a correction rather than pretend.
 */
export async function confirmParentSentAction(
  _previous: ParentSendState,
  formData: FormData,
): Promise<ParentSendState> {
  const actor = await assertPermission("collection:manage");
  const id = (formData.get("id") ?? "").toString();
  const send = id ? await getSend(id) : null;
  if (!send || send.audience !== "parent") return { status: "error", message: m.notFound };

  const { reasons, extras } = await staleness(send);
  if (!extras?.approved_at) return { status: "error", message: ms.messagesApproveFirst };

  // What changed is written first: `markStale` leaves a sent row alone, so
  // that nothing later rewrites the record of a disclosure — this send's own
  // reasons have to land before it becomes one.
  if (reasons.length > 0) await markStale(send.id, reasons);
  await markSentByHand(send.id, actor.id);
  revalidatePath("/collection/messages");
  return { status: "sent", warnings: reasons.map((reason) => staleReasonLabels[reason]) };
}

/**
 * Somebody says a parent number is wrong (P9). Nothing more is sent to it,
 * every unsent message to it is withdrawn, and the flag waits for an
 * administrator. A message already sent stays on the record.
 */
export async function flagRouteAction(
  _previous: CollectionState,
  formData: FormData,
): Promise<CollectionState> {
  const actor = await assertPermission("collection:manage");
  const phone = (formData.get("phone") ?? "").toString();
  const studentId = (formData.get("studentId") ?? "").toString() || null;
  const reason = (formData.get("reason") ?? "").toString().trim();
  if (!/^\d{10}$/.test(phone.replace(/\D/g, "").slice(-10)) || reason === "") {
    return failure(ms.messagesFlagNeedsReason);
  }

  let withdrawn = 0;
  try {
    ({ withdrawn } = await flagRoute({ phone, studentId, reason: reason.slice(0, 300), actorStaffId: actor.id }));
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath("/collection/messages");
  return {
    status: "saved",
    message: t(
      `नंबर गलत बताया गया। ${withdrawn} न भेजे संदेश वापस लिए गए। प्रशासक देखेंगे।`,
      `Number reported as wrong. ${withdrawn} unsent message${withdrawn === 1 ? "" : "s"} withdrawn. An administrator will review it.`,
    ),
  };
}

/** An administrator clears a wrong-number flag, saying why. The flag is kept. */
export async function clearRouteFlagAction(formData: FormData) {
  const actor = await assertPermission("jobs:run");
  const id = (formData.get("id") ?? "").toString();
  const note = (formData.get("note") ?? "").toString().trim();
  if (!id || note === "") return;
  await clearRouteFlag({ id, note: note.slice(0, 300), actorStaffId: actor.id });
  revalidatePath("/collection/messages");
}

/**
 * Change one category's parent message policy (P9). An administrator's
 * decision: turning approval off needs an exception that names its
 * recipients, trigger, content and correction, and any change moves the
 * policy version, which makes every message approved under the old one stale.
 */
export async function saveParentPolicyAction(
  _previous: CollectionState,
  formData: FormData,
): Promise<CollectionState> {
  const actor = await assertPermission("jobs:run");
  const category = (formData.get("category") ?? "").toString() as ParentCategory;
  if (!parentCategories.includes(category)) return failure(m.notSaved);

  const text = (name: string) => (formData.get(name) ?? "").toString().trim().slice(0, 300) || null;
  const approvalRequired = formData.get("approvalRequired") === "on";
  const input = {
    category,
    approvalRequired,
    autoRecipients: text("autoRecipients"),
    autoTrigger: text("autoTrigger"),
    autoContent: text("autoContent"),
    autoCorrection: text("autoCorrection"),
    actorStaffId: actor.id,
  };
  if (!approvalRequired && [input.autoRecipients, input.autoTrigger, input.autoContent, input.autoCorrection].some((value) => !value)) {
    return failure(ms.policyExceptionIncomplete);
  }

  let outcome: "saved" | "stale";
  try {
    outcome = await savePolicy(input);
  } catch {
    return failure(m.notSaved);
  }
  revalidatePath("/collection/policy");
  if (outcome === "stale") return failure(ms.policyStale);
  return { ...idleCollectionState, status: "saved", message: ms.policySaved };
}
