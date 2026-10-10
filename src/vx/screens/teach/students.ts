import "server-only";

import { FEE_SCHEMA } from "@/platform/env";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";

/*
 * Children's names and birthdays for the teacher screens. Read with the
 * service role, as `rosterOn()` does — the fee app's RLS keys on its own
 * `public.users.role`, which staff here do not have (D-32). Every caller has
 * already decided the reader may see these children. No money is read here.
 */

export type ChildBasics = {
  id: string;
  fullName: string;
  admissionNo: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  photoPath: string | null;
};

export async function childBasics(ids: readonly string[]): Promise<Map<string, ChildBasics>> {
  const wanted = [...new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  if (wanted.length === 0) return new Map();
  const { data, error } = await fetchInChunks<{
    id: string;
    full_name: string;
    admission_no: string | null;
    date_of_birth: string | null;
    gender: string | null;
    photo_path: string | null;
  }>(wanted, IN_FILTER_CHUNK_SIZE, (chunk) =>
    createAdminClient()
      .schema(FEE_SCHEMA)
      .from("students")
      .select("id, full_name, admission_no, date_of_birth, gender, photo_path")
      .in("id", chunk),
  );
  if (error) throw new Error("Could not read the children.");
  return new Map(
    data.map((row) => [
      row.id,
      {
        id: row.id,
        fullName: row.full_name,
        admissionNo: row.admission_no,
        dateOfBirth: row.date_of_birth,
        gender: row.gender,
        photoPath: row.photo_path,
      },
    ]),
  );
}

/** Children enrolled in these classes this session: id → class. */
export async function enrolledIn(classIds: readonly string[], sessionLabel: string): Promise<{ studentId: string; classId: string; rollNo: string | null }[]> {
  if (classIds.length === 0) return [];
  const { data, error } = await fetchInChunks<{ student_id: string; class_id: string; roll_no: string | null }>(
    [...classIds],
    IN_FILTER_CHUNK_SIZE,
    (chunk) =>
      createAdminClient()
        .from("enrolments")
        .select("student_id, class_id, roll_no")
        .eq("session_label", sessionLabel)
        .eq("status", "enrolled")
        .in("class_id", chunk),
  );
  if (error) throw new Error("Could not read the classes' children.");
  return data.map((row) => ({ studentId: row.student_id, classId: row.class_id, rollNo: row.roll_no }));
}

/** Staff display names by id. */
export async function staffNames(ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const { data, error } = await fetchInChunks<{ id: string; display_name: string }>(wanted, IN_FILTER_CHUNK_SIZE, (chunk) =>
    createAdminClient().from("staff_profiles").select("id, display_name").in("id", chunk),
  );
  if (error) return new Map();
  return new Map(data.map((row) => [row.id, row.display_name]));
}
