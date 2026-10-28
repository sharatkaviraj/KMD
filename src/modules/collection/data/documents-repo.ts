import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import { type DocumentKind, type StudentDocument } from "@/modules/collection/domain/review";

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

// The uploader's name, by the named key: since D-333 `removed_by` is a second
// key to the same table, and an unnamed embed of two is a PostgREST error.
const COLUMNS =
  "id, student_id, kind, storage_path, file_name, content_type, byte_size, note, " +
  "created_at, staff_profiles!student_documents_uploaded_by_fkey(display_name)";

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
    // An upload still in flight, one that failed its checks, or one removed
    // from Drive's side of the app is never offered (D-333).
    .eq("upload_state", "stored")
    .is("removed_at", null)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<DocumentRow[]>();

  if (error) throw new Error(`Could not read the documents: ${error.message}`);
  return data.map(toDocument);
}

export type OpenableDocument = {
  id: string;
  studentId: string;
  provider: "supabase" | "gdrive";
  storagePath: string;
  driveFileId: string | null;
  fileName: string;
  contentType: string;
  byteSize: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One document the person asking may open, or null.
 *
 * Read **as them**, through `student_documents_select_scoped`: the permission
 * and the class scope are the database's answer, not this function's. It used
 * to read with the service role after checking the permission alone, so a
 * class teacher holding another class's document id could open it (D-333).
 */
export async function openableDocument(id: string): Promise<OpenableDocument | null> {
  await assertPermission("documents:view");
  if (!UUID.test(id)) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("student_documents")
    .select("id, student_id, storage_provider, storage_path, drive_file_id, file_name, content_type, byte_size")
    .eq("id", id)
    .eq("upload_state", "stored")
    .is("removed_at", null)
    .maybeSingle<{
      id: string;
      student_id: string;
      storage_provider: "supabase" | "gdrive";
      storage_path: string;
      drive_file_id: string | null;
      file_name: string;
      content_type: string;
      byte_size: number;
    }>();

  if (!data) return null;
  return {
    id: data.id,
    studentId: data.student_id,
    provider: data.storage_provider,
    storagePath: data.storage_path,
    driveFileId: data.drive_file_id,
    fileName: data.file_name,
    contentType: data.content_type,
    byteSize: Number(data.byte_size),
  };
}

/**
 * A short-lived link to a document held in the Supabase bucket. Only ever
 * called with a path `openableDocument()` returned, so the person and the
 * class have already been checked; the service role is used for the signing
 * alone.
 */
export async function signedDocumentUrl(document: OpenableDocument): Promise<string | null> {
  if (document.provider !== "supabase") return null;

  const { data, error } = await createAdminClient()
    .storage.from(DOCUMENTS_BUCKET)
    .createSignedUrl(document.storagePath, SIGNED_URL_SECONDS);

  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * Remove a document.
 *
 * Only one the person may see: it is looked up as them first.
 *
 * In Drive, the row is hidden and the file is kept (D-333). The app never
 * deletes from the school's Drive; a removed document can be brought back by
 * clearing `removed_at`.
 *
 * In the Supabase bucket, row and file go — but only while it is still a
 * bucket row: the nightly move (D-334) may have pointed it at Drive in the
 * meantime, and then it is hidden like any Drive document and the bucket
 * original, its rollback, is kept. The row goes first and the object only if
 * a row went; a file with no row is a byte nobody can reach, the failure mode
 * that confuses nobody.
 */
export async function deleteDocument(id: string): Promise<void> {
  const actor = await assertPermission("documents:manage");

  const document = await openableDocument(id);
  if (!document) return;

  const admin = createAdminClient();
  const hide = async () => {
    const { error } = await admin
      .from("student_documents")
      .update({ removed_at: new Date().toISOString(), removed_by: actor.id })
      .eq("id", id)
      .is("removed_at", null);
    if (error) throw error;
  };

  if (document.provider === "gdrive") return hide();

  const { data: deleted, error } = await admin
    .from("student_documents")
    .delete()
    .eq("id", id)
    .eq("storage_provider", "supabase")
    .is("migrated_at", null)
    .select("storage_path");
  if (error) throw error;
  if (!deleted || deleted.length === 0) return hide();

  await admin.storage.from(DOCUMENTS_BUCKET).remove([document.storagePath]);
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
      : Promise.resolve({ data: [] as { id: string; display_name: string }[], error: null }),
  ]);
  if (fields.error || actors.error) throw new Error("Could not read the record history's labels and staff names.");
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
