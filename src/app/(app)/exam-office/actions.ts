"use server";

import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { p } from "@/vx/text";
import { logActivity, marksLinkUrl } from "@/vx/screens/exams/data";
import { SETUP_KEYS } from "@/vx/screens/exams/domain/office";
import { newToken, previewRefusal } from "@/vx/screens/exams/guards";
import type { ActionResult } from "@/vx/screens/exams/save-types";

/*
 * The exam office's small writes: reminders to late teachers, a note of a
 * phone call, a ticked checklist step, and a teacher's marks link made,
 * renewed or stopped. Each checks the permission, then that an administrator
 * is not previewing another role.
 */

const UUID = /^[0-9a-f-]{36}$/i;
const RELOAD = p("Something was missing. Reload the page.", "कुछ अधूरा था। पेज फिर खोलें।");
const NOT_SAVED = p("Not saved. Try again.", "सहेजा नहीं गया। फिर से कोशिश करें।");

const db = () => createAdminClient();

async function liveToken(examId: string, staffId: string, actorId: string): Promise<string | null> {
  const { data: existing } = await db()
    .from("exam_marks_links")
    .select("token")
    .eq("assessment_id", examId)
    .eq("staff_profile_id", staffId)
    .is("revoked_at", null)
    .maybeSingle<{ token: string }>();
  if (existing) return existing.token;
  const token = newToken();
  const { error } = await db().from("exam_marks_links").insert({ assessment_id: examId, staff_profile_id: staffId, token, created_by: actorId });
  return error ? null : token;
}

/**
 * Record reminders to these teachers and hand back each one's marks link.
 * The message itself goes from the coordinator's own WhatsApp; the app only
 * writes down that it went.
 */
export async function remindTeachersAction(input: { examId: string; staffIds: string[]; channel?: "whatsapp" | "copy" }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  const ids = [...new Set(input.staffIds)].filter((id) => UUID.test(id)).slice(0, 80);
  if (!UUID.test(input.examId) || ids.length === 0) return { ok: false, message: RELOAD };

  const links: { staffId: string; url: string | null }[] = [];
  for (const id of ids) {
    const token = await liveToken(input.examId, id, staff.id);
    links.push({ staffId: id, url: token ? marksLinkUrl(token) : null });
  }
  const { error } = await db()
    .from("exam_reminders")
    .insert(ids.map((id) => ({ assessment_id: input.examId, staff_profile_id: id, channel: input.channel ?? "whatsapp", sent_by: staff.id })));
  if (error) return { ok: false, message: NOT_SAVED };
  await logActivity({
    assessmentId: input.examId,
    kind: "reminded",
    en: `${staff.displayName} reminded ${ids.length === 1 ? "1 teacher" : `${ids.length} teachers`} on WhatsApp`,
    hi: `${staff.displayName} ने ${ids.length} शिक्षकों को WhatsApp पर याद दिलाया`,
    actorId: staff.id,
  }).catch(() => undefined);
  revalidatePath("/exam-office");
  revalidatePath("/exams");
  return { ok: true, data: { links } };
}

const CALL_OUTCOMES = ["today", "saturday", "help", "no_answer"] as const;
const CALL_WORDS: Record<(typeof CALL_OUTCOMES)[number], { en: string; hi: string }> = {
  today: { en: "will finish today", hi: "आज पूरा करेंगे" },
  saturday: { en: "will finish by Saturday", hi: "शनिवार तक पूरा करेंगे" },
  help: { en: "needs help with the link", hi: "लिंक में मदद चाहिए" },
  no_answer: { en: "no answer", hi: "जवाब नहीं मिला" },
};

/** "You called Mr. X · will finish today", so the office knows who has been chased. */
export async function logCallAction(input: { examId: string; staffId: string; outcome: string }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  const outcome = CALL_OUTCOMES.find((o) => o === input.outcome);
  if (!UUID.test(input.examId) || !UUID.test(input.staffId) || !outcome) return { ok: false, message: RELOAD };
  const { data: who } = await db().from("staff_profiles").select("display_name").eq("id", input.staffId).maybeSingle<{ display_name: string }>();
  const name = who?.display_name ?? "—";
  await logActivity({
    assessmentId: input.examId,
    kind: "call",
    en: `${staff.displayName} called ${name} · ${CALL_WORDS[outcome].en}`,
    hi: `${staff.displayName} ने ${name} को फ़ोन किया · ${CALL_WORDS[outcome].hi}`,
    actorId: staff.id,
  });
  revalidatePath("/exam-office");
  return { ok: true };
}

/** Tick, or untick, a step of the next exam's setup that nothing else records. */
export async function markChecklistAction(input: { examId: string; key: string; done: boolean }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId) || !(SETUP_KEYS as readonly string[]).includes(input.key) || input.key === "created") {
    return { ok: false, message: RELOAD };
  }
  const { data: plan } = await db().from("exam_plans").select("checklist").eq("assessment_id", input.examId).maybeSingle<{ checklist: Record<string, unknown> | null }>();
  const checklist = { ...(plan?.checklist ?? {}) };
  if (input.done) checklist[input.key] = { at: new Date().toISOString(), by: staff.id };
  else delete checklist[input.key];
  const { error } = await db()
    .from("exam_plans")
    .upsert({ assessment_id: input.examId, checklist, updated_by: staff.id, updated_at: new Date().toISOString() }, { onConflict: "assessment_id" });
  if (error) return { ok: false, message: NOT_SAVED };
  if (input.done) {
    await logActivity({ assessmentId: input.examId, kind: "checklist", en: `${staff.displayName} marked a setup step done (${input.key})`, actorId: staff.id }).catch(() => undefined);
  }
  revalidatePath("/exam-office");
  return { ok: true };
}

/** Make a teacher's marks link, give her a new one (the old stops working), or stop it. */
export async function marksLinkAction(input: { examId: string; staffId: string; op: "make" | "renew" | "revoke" }): Promise<ActionResult> {
  const staff = await assertPermission("assessments:manage");
  const preview = await previewRefusal();
  if (preview) return { ok: false, message: preview };
  if (!UUID.test(input.examId) || !UUID.test(input.staffId) || !["make", "renew", "revoke"].includes(input.op)) return { ok: false, message: RELOAD };

  if (input.op !== "make") {
    const { error } = await db()
      .from("exam_marks_links")
      .update({ revoked_at: new Date().toISOString(), revoked_by: staff.id })
      .eq("assessment_id", input.examId)
      .eq("staff_profile_id", input.staffId)
      .is("revoked_at", null);
    if (error) return { ok: false, message: NOT_SAVED };
  }
  let url: string | null = null;
  if (input.op !== "revoke") {
    const token = await liveToken(input.examId, input.staffId, staff.id);
    if (!token) return { ok: false, message: NOT_SAVED };
    url = marksLinkUrl(token);
  }
  revalidatePath("/exams");
  return {
    ok: true,
    message: input.op === "revoke" ? p("Link stopped", "लिंक बंद किया") : input.op === "renew" ? p("New link made — the old one no longer opens", "नया लिंक बना — पुराना अब नहीं खुलेगा") : p("Link made", "लिंक बना"),
    data: { url },
  };
}
