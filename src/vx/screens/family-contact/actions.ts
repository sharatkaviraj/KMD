"use server";
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { schoolToday } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { assertNotPreviewing } from "@/vx/view-as";
import { familyContactAccess } from "./data";
import { contactRequest, latestContactCandidate, parseContact, type ContactCommand, type ContactRequest } from "./domain";

export type ContactResult = { ok: true; status: "saved"; attemptId: string; agreedOn: string | null } | { ok: false; status: "refused" | "uncertain" | "not_found" | "expired"; error: Pair; today?: string };
const refused = (error: Pair): ContactResult => ({ ok: false, status: "refused", error });
const unknown = (): ContactResult => ({ ok: false, status: "uncertain", error: p("Could not confirm the result. Check the original contact before retrying it.", "नतीजे की पुष्टि नहीं हो सकी। दोबारा प्रयास से पहले मूल संपर्क जाँचें।") });
type Row = { id: string; created_by: string; session_label: string; student_id: string; kind: string; outcome: string | null; note: string | null; agreed_on: string | null; note_id: string | null };
const columns = "id, created_by, session_label, student_id, kind, outcome, note, agreed_on, note_id";
const matches = (row: Row, c: ContactRequest) => row.id === c.attemptId && row.created_by === c.owner && row.session_label === c.sessionLabel && row.student_id === c.studentId && row.kind === "contact" && row.outcome === c.outcome && row.note === c.note && (row.agreed_on === c.agreedOn || !!c.dateCorrections?.includes(row.agreed_on ?? "")) && row.note_id === c.noteId;
const mismatch = () => refused(p("This contact ID belongs to a different entry. Keep the original and refresh this page.", "यह संपर्क पहचान किसी दूसरी प्रविष्टि की है। मूल प्रविष्टि रखें और पेज फिर से खोलें।"));
const saved = (c: ContactCommand, row: Row): ContactResult => { revalidatePath(`/students/${c.studentId}`); revalidatePath("/academics/progress"); return { ok: true, status: "saved", attemptId: c.attemptId, agreedOn: row.agreed_on }; };
async function prepare(input: unknown, actor: Awaited<ReturnType<typeof assertPermission>>) {
  const command = contactRequest(input);
  if (!command) {
    const validation = input && typeof input === "object" ? parseContact(input as ContactCommand, "") : null;
    return { result: refused(validation && !validation.ok ? validation.error : p("Refresh this page before recording a contact. A valid original contact ID is required.", "संपर्क दर्ज करने से पहले पेज फिर से खोलें। मूल संपर्क की सही पहचान ज़रूरी है।")) };
  }
  const session = await resolveSessionLabel();
  if (command.owner !== actor.id || command.sessionLabel !== session) return { result: refused(p("Your account or session changed. Return to the original contact context.", "आपका खाता या सत्र बदल गया है। मूल संपर्क के खाते और सत्र में लौटें।")) };
  const admin = createAdminClient();
  const { data: enrolment, error } = await admin.from("enrolments").select("class_id").eq("session_label", session).eq("student_id", command.studentId).maybeSingle<{ class_id: string }>();
  if (error) return { result: unknown() };
  if (!(await familyContactAccess(actor, session, enrolment?.class_id ?? null))) return { result: refused(p("Only the class teacher and the office record family contact.", "संपर्क का रिकॉर्ड केवल कक्षा शिक्षक और कार्यालय दर्ज करते हैं।")) };
  return { command, admin };
}
export async function checkFamilyContactAction(input: ContactRequest): Promise<ContactResult> {
  const actor = await assertPermission("students:view");
  await assertNotPreviewing();
  const prepared = await prepare(input, actor);
  if (prepared.result) return prepared.result;
  const { command, admin } = prepared;
  try {
    const { data, error } = await admin.from("student_followups").select(columns).eq("id", command.attemptId).maybeSingle<Row>();
    if (error) return unknown();
    if (!data) return { ok: false, status: "not_found", today: schoolToday(), error: p("The original contact is not found yet. Retry this same contact ID.", "मूल संपर्क अभी नहीं मिला। इसी संपर्क पहचान से फिर प्रयास करें।") };
    return matches(data, command) ? saved(command, data) : mismatch();
  } catch { return unknown(); }
}
/** Existing UUID PK supplies once-per-attempt append, never text deduplication. */
export async function logFamilyContactAction(input: ContactRequest): Promise<ContactResult> {
  const actor = await assertPermission("students:view");
  await assertNotPreviewing();
  const prepared = await prepare(input, actor);
  if (prepared.result) return prepared.result;
  const { command, admin } = prepared;
  try {
    const earlier = await admin.from("student_followups").select(columns).eq("id", command.attemptId).maybeSingle<Row>();
    if (earlier.error) return unknown();
    if (earlier.data) return matches(earlier.data, command) ? saved(command, earlier.data) : mismatch();
    // Recognize a committed original before applying today's new-date rule.
    const candidate = latestContactCandidate(command), today = schoolToday();
    const parsed = parseContact(candidate, today);
    if (!parsed.ok) return { ok: false, status: "expired", today, error: parsed.error };
    const { error } = await admin.from("student_followups").insert({ id: command.attemptId, session_label: command.sessionLabel, student_id: command.studentId, kind: "contact", outcome: command.outcome, note: command.note, agreed_on: candidate.agreedOn, note_id: command.noteId, created_by: command.owner });
    // Verify the exact persisted row even when INSERT reports success. A
    // missing/failed readback leaves recovery intact rather than claiming saved.
    if (error && error.code !== "23505") return unknown();
    const original = await admin.from("student_followups").select(columns).eq("id", command.attemptId).maybeSingle<Row>();
    if (original.error || !original.data) return unknown();
    return matches(original.data, command) ? saved(command, original.data) : mismatch();
  } catch { return unknown(); }
}
