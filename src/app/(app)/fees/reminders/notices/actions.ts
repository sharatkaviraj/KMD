"use server";

import { redirect } from "next/navigation";

import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { requireStaffPermission } from "@/modules/fees/platform/session";
import { assertStudentsVisible } from "@/platform/auth/test-session-access";
import { resolveReminderSessionLabel } from "@/modules/whatsapp/data/reminder-session";
import { sendSchoolNotice } from "@/modules/whatsapp/data/school-notice-sender";
import { istToday } from "@/modules/whatsapp/domain/fee-reminders";
import { isNoticeLanguage } from "@/modules/whatsapp/domain/campaigns";
import {
  isSchoolNoticeKind,
  isSchoolNoticeApproved,
  schoolNoticeFor,
} from "@/modules/whatsapp/domain/school-notices";
import { formatDdMmYyyy } from "@/platform/helpers/date";

/**
 * Send one school notice to the students the office picked.
 *
 * `settings:write`, the same authority as sending a fee reminder: it is a real,
 * billed WhatsApp message to a parent. The recipients travel as the ticked
 * student ids and are re-read from the roll inside the sender, so a child who
 * left this morning or a number changed an hour ago is what decides.
 *
 * A required "I have read the message" tick stands in for the fee screen's
 * confirm step, so a send never happens on one accidental tap.
 */
export async function sendSchoolNoticeAction(formData: FormData): Promise<void> {
  const staff = await requireStaffPermission("settings:write", { onDenied: "redirect" });

  const kindRaw = formData.get("kind");
  const kind = isSchoolNoticeKind(kindRaw) ? kindRaw : "absent_today";
  const languageRaw = formData.get("language");
  const language = isNoticeLanguage(languageRaw) ? languageRaw : "hi";

  // Back to the same screen, with the same choices, plus the outcome.
  const back = new URLSearchParams({ kind, language });
  for (const key of ["classId", "classes"]) {
    const value = formData.getAll(key).map(String).filter(Boolean).join(",");
    if (value) back.set(key, value);
  }

  const definition = schoolNoticeFor(kind);
  const fields: Record<string, string> = {};
  for (const field of definition.fields) {
    const raw = String(formData.get(`field:${field.name}`) ?? "").trim();
    back.set(`field:${field.name}`, raw);
    const limited = field.maxLength ? raw.slice(0, field.maxLength) : raw;
    // The date control posts ISO; the message prints the school's DD-MM-YYYY.
    fields[field.name] = field.kind === "date" ? formatDdMmYyyy(limited) || limited : limited;
  }

  const missing = definition.fields.filter((field) => !fields[field.name]);
  if (missing.length > 0) {
    back.set("error", `Fill in ${missing.map((field) => field.label.toLowerCase()).join(", ")} first.`);
    redirect(`/fees/reminders/notices?${back.toString()}`);
  }
  if (formData.get("confirm") !== "on") {
    back.set("error", "Tick the box to say you have read the message, then press Send.");
    redirect(`/fees/reminders/notices?${back.toString()}`);
  }
  if (!isSchoolNoticeApproved(kind, "hi") && !isSchoolNoticeApproved(kind, "en")) {
    back.set("error", "This notice is still waiting for Meta to approve its template.");
    redirect(`/fees/reminders/notices?${back.toString()}`);
  }

  const studentIds = formData
    .getAll("studentId")
    .map((value) => String(value).trim())
    .filter(Boolean);

  let outcome: Awaited<ReturnType<typeof sendSchoolNotice>>;
  try {
    const supabase = createAdminClient();
    const sessionLabel = await resolveReminderSessionLabel(supabase);
    // One only (D-340): every child picked is in a session this viewer may write.
    await assertStudentsVisible(null, studentIds);
    outcome = await sendSchoolNotice({
      supabase,
      sessionLabel,
      kind,
      language,
      fields,
      studentIds,
      staffId: String(staff.id ?? "") || null,
      today: istToday(),
    });
  } catch (caught) {
    back.set("error", caught instanceof Error ? caught.message.slice(0, 200) : "Could not send.");
    redirect(`/fees/reminders/notices?${back.toString()}`);
  }

  back.set(outcome.status === "error" ? "error" : "done", outcome.message.slice(0, 400));
  redirect(`/fees/reminders/notices?${back.toString()}`);
}
