import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import {
  documentPath,
  type DocumentKind,
  type StudentDocument,
} from "@/modules/collection/domain/review";

/**
 * Files about a child.
 *
 * The bucket is private and the row is the index. A document is served through
 * a **signed URL minted after a permission check** and never by a public path:
 * a birth certificate with a guessable URL is a birth certificate anybody has.
 *
 * The signed link is short-lived on purpose. It is enough to open the file
 * from the screen that just checked who is asking; it is not something to
 * paste into WhatsApp, and a minute is long enough that nobody tries.
 */

export const DOCUMENTS_BUCKET = "vppsone-documents";
const SIGNED_URL_SECONDS = 60;

type DocumentRow = {
  id: string;
  student_id: string;
  kind: DocumentKind;
  storage_path: string;
  file_name: string;
  content_type: string;
  byte_size: number;
  note: string | null;
  created_at: string;
  staff_profiles: { display_name: string } | null;
};

const COLUMNS =
  "id, student_id, kind, storage_path, file_name, content_type, byte_size, note, " +
  "created_at, staff_profiles(display_name)";

const toDocument = (row: DocumentRow): StudentDocument => ({
  id: row.id,
  studentId: row.student_id,
  kind: row.kind,
  storagePath: row.storage_path,
  fileName: row.file_name,
  contentType: row.content_type,
  byteSize: row.byte_size,
  note: row.note,
  uploadedByName: row.staff_profiles?.display_name ?? null,
  createdAt: row.created_at,
});

export async function documentsForStudent(
  studentId: string,
): Promise<StudentDocument[]> {
  await assertPermission("documents:view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("student_documents")
    .select(COLUMNS)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<DocumentRow[]>();

  if (error) throw new Error(`Could not read the documents: ${error.message}`);
  return data.map(toDocument);
}

/**
 * Store a file and index it.
 *
 * The row is created first so its id can name the object in the bucket: a
 * random path nobody can guess, and one that cannot collide when two parents
 * both send `aadhaar.pdf`. If the upload then fails the row is removed, so a
 * listing never offers a document that is not there.
 */
export async function storeDocument(input: {
  sessionLabel: string;
  studentId: string;
  kind: DocumentKind;
  fileName: string;
  contentType: string;
  bytes: ArrayBuffer;
  note: string | null;
  uploadedByStaffId: string;
}): Promise<StudentDocument> {
  const admin = createAdminClient();
  const byteSize = input.bytes.byteLength;

  const { data: row, error } = await admin
    .from("student_documents")
    .insert({
      session_label: input.sessionLabel,
      student_id: input.studentId,
      kind: input.kind,
      // Replaced immediately below; the row needs its id before the path can
      // be built from it.
      storage_path: `pending/${crypto.randomUUID()}`,
      file_name: input.fileName,
      content_type: input.contentType,
      byte_size: byteSize,
      note: input.note,
      uploaded_by: input.uploadedByStaffId,
    })
    .select(COLUMNS)
    .single<DocumentRow>();

  if (error) throw error;

  const path = documentPath({
    sessionLabel: input.sessionLabel,
    studentId: input.studentId,
    id: row.id,
    fileName: input.fileName,
  });

  const upload = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, input.bytes, { contentType: input.contentType, upsert: false });

  if (upload.error) {
    // No orphan rows: a listing must never offer a document that is not there.
    await admin.from("student_documents").delete().eq("id", row.id);
    throw upload.error;
  }

  const { data: updated, error: pathError } = await admin
    .from("student_documents")
    .update({ storage_path: path })
    .eq("id", row.id)
    .select(COLUMNS)
    .single<DocumentRow>();

  if (pathError) throw pathError;
  return toDocument(updated);
}

/**
 * A short-lived link to one document, after checking who is asking.
 *
 * The permission check is here rather than at the call site because this is
 * the function that mints the capability — and a capability minted without a
 * check is the whole risk, whatever the screen above it believed.
 */
export async function signedDocumentUrl(id: string): Promise<string | null> {
  await assertPermission("documents:view");

  const admin = createAdminClient();

  const { data: row } = await admin
    .from("student_documents")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle<{ storage_path: string }>();

  if (!row) return null;

  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_SECONDS);

  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Remove a document, file and row.
 *
 * The object goes first: a row with no file is a broken link on a screen, and
 * a file with no row is a byte nobody can reach — of the two failure modes,
 * the second is the one that does not confuse anybody.
 */
export async function deleteDocument(id: string): Promise<void> {
  await assertPermission("documents:manage");

  const admin = createAdminClient();

  const { data: row } = await admin
    .from("student_documents")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle<{ storage_path: string }>();

  if (row) {
    await admin.storage.from(DOCUMENTS_BUCKET).remove([row.storage_path]);
  }

  const { error } = await admin.from("student_documents").delete().eq("id", id);
  if (error) throw error;
}

/** What VPPS One has accepted about one child, for the student card. */
export async function recordsForStudent(
  studentId: string,
): Promise<{ fieldId: string; key: string; labelHi: string; labelEn: string; value: string | null; source: string }[]> {
  await assertPermission("collection:view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("student_records")
    .select(
      "field_id, value, source, collection_fields!inner(key, label_hi, label_en, sort_order)",
    )
    .eq("student_id", studentId)
    .returns<
      {
        field_id: string;
        value: string | null;
        source: string;
        collection_fields: {
          key: string;
          label_hi: string;
          label_en: string;
          sort_order: number;
        };
      }[]
    >();

  if (error) throw new Error(`Could not read the records: ${error.message}`);

  return data
    .sort((a, b) => a.collection_fields.sort_order - b.collection_fields.sort_order)
    .map((row) => ({
      fieldId: row.field_id,
      key: row.collection_fields.key,
      labelHi: row.collection_fields.label_hi,
      labelEn: row.collection_fields.label_en,
      value: row.value,
      source: row.source,
    }));
}

export type RecordChange = {
  id: number;
  fieldId: string;
  labelHi: string;
  labelEn: string;
  outcome: "written" | "blocked";
  reason: string | null;
  oldValue: string | null;
  newValue: string | null;
  source: string;
  sourceDetail: string | null;
  actorName: string | null;
  recordedAt: string;
};

/**
 * How one child's values came to be what they are (P10, S-10): every write and
 * every value precedence refused, newest first, read as the person asking —
 * the history is scoped exactly like the record.
 */
export async function historyForStudent(studentId: string, limit = 40): Promise<RecordChange[]> {
  await assertPermission("collection:view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("student_record_history")
    .select("id, field_id, outcome, reason, old_value, new_value, source, source_detail, actor_staff_id, recorded_at")
    .eq("student_id", studentId)
    .order("recorded_at", { ascending: false })
    .limit(limit)
    .returns<
      {
        id: number;
        field_id: string;
        outcome: "written" | "blocked";
        reason: string | null;
        old_value: string | null;
        new_value: string | null;
        source: string;
        source_detail: string | null;
        actor_staff_id: string | null;
        recorded_at: string;
      }[]
    >();
  if (error) throw new Error(`Could not read how the records changed: ${error.message}`);
  if (data.length === 0) return [];

  // The history keeps no foreign keys — it outlives fields and people — so
  // the labels and names are looked up, and a missing one reads as "—".
  const admin = createAdminClient();
  const fieldIds = [...new Set(data.map((row) => row.field_id))];
  const actorIds = [...new Set(data.map((row) => row.actor_staff_id).filter((id): id is string => Boolean(id)))];
  const [fields, actors] = await Promise.all([
    admin.from("collection_fields").select("id, label_hi, label_en").in("id", fieldIds)
      .returns<{ id: string; label_hi: string; label_en: string }[]>(),
    actorIds.length > 0
      ? admin.from("staff_profiles").select("id, display_name").in("id", actorIds)
          .returns<{ id: string; display_name: string }[]>()
      : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
  ]);
  const fieldOf = new Map((fields.data ?? []).map((row) => [row.id, row]));
  const nameOf = new Map((actors.data ?? []).map((row) => [row.id, row.display_name]));

  return data.map((row) => ({
    id: row.id,
    fieldId: row.field_id,
    labelHi: fieldOf.get(row.field_id)?.label_hi ?? "—",
    labelEn: fieldOf.get(row.field_id)?.label_en ?? "—",
    outcome: row.outcome,
    reason: row.reason,
    oldValue: row.old_value,
    newValue: row.new_value,
    source: row.source,
    sourceDetail: row.source_detail,
    actorName: row.actor_staff_id ? (nameOf.get(row.actor_staff_id) ?? null) : null,
    recordedAt: row.recorded_at,
  }));
}
