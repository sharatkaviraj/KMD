"use server";

import { revalidatePath } from "next/cache";

import { m } from "@/messages";
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
  dispatch,
  getSend,
  listTemplates,
  markSentByHand,
  queueSend,
  recordDispatch,
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
import { decideSchema } from "@/modules/collection/domain/review";
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

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const parsed = decideSchema.safeParse({
    submissionIds: stringsFrom(formData, "submissionIds"),
    accept: formData.get("accept") === "true",
    note: (formData.get("note") ?? "").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  let result: { decided: number; recorded: number };

  try {
    result = await decideSubmissions({
      submissionIds: parsed.data.submissionIds,
      accept: parsed.data.accept,
      note: parsed.data.note,
      deciderStaffId: actor.id,
      sessionLabel,
    });
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath("/collection/review");
  revalidatePath("/collection");

  return {
    ...idleCollectionState,
    status: "saved",
    message: t(
      `${result.decided} पर फ़ैसला हुआ।`,
      `Decided ${result.decided}, recorded ${result.recorded}.`,
    ),
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
  if (!template) return failure(m.notSaved);

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

  const id = (formData.get("id") ?? "").toString();
  if (!id) return failure(m.notSaved);

  const send = await getSend(id);
  if (!send) return failure(m.notSaved);

  const result = await dispatch(send);
  await recordDispatch(id, result);

  revalidatePath("/collection/messages");

  if (!result.ok) {
    return failure(t(result.error, result.error));
  }

  return { ...idleCollectionState, status: "saved" };
}

export async function markSentAction(formData: FormData) {
  const actor = await assertPermission("collection:manage");

  const id = (formData.get("id") ?? "").toString();
  if (!id) return;

  await markSentByHand(id, actor.id);
  revalidatePath("/collection/messages");
}

export async function cancelSendAction(formData: FormData) {
  await assertPermission("collection:manage");

  const id = (formData.get("id") ?? "").toString();
  if (!id) return;

  await cancelSend(id);
  revalidatePath("/collection/messages");
}
