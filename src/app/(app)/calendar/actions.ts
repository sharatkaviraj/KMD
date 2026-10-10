"use server";

import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { upsertCalendarDays } from "@/modules/academics/data/class-teachers-repo";
import { dateLabel, shortDay } from "@/vx/format";
import { audienceSize, costPaise, eventById } from "@/vx/screens/calendar/data";
import { EVENT_KINDS, eventNotice, holidayNotice, whenLabel } from "@/vx/screens/calendar/domain";
import { isDay, isUuid } from "@/vx/screens/academics/domain";
import { p, type Pair } from "@/vx/text";
import { assertNotPreviewing } from "@/vx/view-as";

/*
 * Writes from the school calendar. `academics:manage` first, then the
 * preview guard. A holiday is a row in `academic_calendar_days` (so the
 * register and timetable close too); everything else is a `calendar_events`
 * row, cancelled rather than deleted. A parent notice is recorded waiting
 * for approval — nothing here sends a message to a parent.
 */

export type CalendarResult = { ok: boolean; text: Pair; id?: string };

const fail = (en: string, hi: string): CalendarResult => ({ ok: false, text: p(en, hi) });

const AUDIENCES = ["parents", "staff", "both"] as const;

export type AddEventInput = {
  kind: string;
  title: string;
  titleHi?: string;
  startsOn: string;
  endsOn?: string;
  allDay: boolean;
  startsAt?: string;
  endsAt?: string;
  place?: string;
  classIds?: string[];
  details?: string;
  notify: boolean;
  audience?: string;
};

async function recordNotice(input: { session: string; eventId?: string | null; holidayDay?: string | null; audience: string; classIds: string[]; text: Pair; actorId: string }) {
  const size = await audienceSize(input.session, input.classIds);
  const recipients = input.audience === "parents" ? size.parents : input.audience === "staff" ? size.staff : size.parents + size.staff;
  const { error } = await createAdminClient()
    .from("calendar_notices")
    .insert({
      session_label: input.session,
      event_id: input.eventId ?? null,
      holiday_day: input.holidayDay ?? null,
      audience: input.audience,
      recipients,
      cost_paise: costPaise(recipients),
      rendered_hi: input.text.hi ?? input.text.en,
      rendered_en: input.text.en,
      status: "awaiting_approval",
      requested_by: input.actorId,
    });
  if (error) throw error;
  return recipients;
}

export async function addEventAction(input: AddEventInput): Promise<CalendarResult> {
  const actor = await assertPermission("academics:manage");
  await assertNotPreviewing();
  const session = await resolveSessionLabel();
  if (!session) return fail("No session is open.", "कोई सत्र खुला नहीं है।");
  const kind = EVENT_KINDS.find((k) => k === input.kind);
  const title = (input.title ?? "").trim().slice(0, 120);
  const titleHi = (input.titleHi ?? "").trim().slice(0, 120) || null;
  const startsOn = input.startsOn;
  const endsOn = input.endsOn && isDay(input.endsOn) ? input.endsOn : startsOn;
  if (!kind) return fail("Choose what kind of day it is.", "किस तरह का दिन है, चुनें।");
  if (!title) return fail("Give it a name.", "नाम लिखें।");
  if (!isDay(startsOn) || endsOn < startsOn) return fail("Choose the dates.", "तारीख़ें चुनें।");
  const time = /^\d{2}:\d{2}$/;
  if (!input.allDay && !(input.startsAt && time.test(input.startsAt))) return fail("Give a start time, or make it all day.", "शुरू होने का समय दें या पूरे दिन का करें।");
  const classIds = (input.classIds ?? []).filter(isUuid).slice(0, 60);
  const audience = AUDIENCES.find((a) => a === input.audience) ?? "parents";

  if (kind === "holiday") {
    await upsertCalendarDays({ day: startsOn, until: endsOn === startsOn ? null : endsOn, kind: endsOn === startsOn ? "holiday" : "vacation", labelEn: title, labelHi: titleHi } as Parameters<typeof upsertCalendarDays>[0], session, actor.userId);
    let told = 0;
    if (input.notify) {
      told = await recordNotice({ session, holidayDay: startsOn, audience, classIds: [], text: holidayNotice(title, titleHi, endsOn === startsOn ? dateLabel(startsOn) : `${dateLabel(startsOn)} – ${dateLabel(endsOn)}`), actorId: actor.id });
    }
    revalidatePath("/calendar", "layout");
    revalidatePath("/academics");
    return { ok: true, text: input.notify ? p(`Holiday added. The notice to ${told} is saved; nothing is sent yet.`, `छुट्टी जोड़ी। ${told} के लिए सूचना सहेजी; अभी कुछ नहीं भेजा गया।`) : p("Holiday added. Registers and the timetable are closed that day.", "छुट्टी जोड़ी। उस दिन रजिस्टर और समय सारणी बंद।") };
  }

  const { data, error } = await createAdminClient()
    .from("calendar_events")
    .insert({
      session_label: session,
      kind,
      title,
      title_hi: titleHi,
      starts_on: startsOn,
      ends_on: endsOn,
      all_day: input.allDay,
      starts_at: input.allDay ? null : input.startsAt,
      ends_at: input.allDay || !input.endsAt || !time.test(input.endsAt) ? null : input.endsAt,
      place: (input.place ?? "").trim().slice(0, 120) || null,
      class_ids: classIds,
      details: (input.details ?? "").trim().slice(0, 1000) || null,
      created_by: actor.id,
      updated_by: actor.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) return fail("Could not add the event.", "कार्यक्रम नहीं जुड़ा।");
  let told = 0;
  if (input.notify) {
    const when = whenLabel({ startsOn, endsOn, allDay: input.allDay, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null }, shortDay);
    told = await recordNotice({ session, eventId: data.id, audience, classIds, text: eventNotice({ title, titleHi, place: input.place ?? null }, when), actorId: actor.id });
  }
  revalidatePath("/calendar", "layout");
  revalidatePath("/academics");
  return { ok: true, id: data.id, text: input.notify ? p(`Event added. The notice to ${told} is saved; nothing is sent yet.`, `कार्यक्रम जुड़ा। ${told} के लिए सूचना सहेजी; अभी कुछ नहीं भेजा गया।`) : p("Event added.", "कार्यक्रम जुड़ा।") };
}

export async function cancelEventAction(id: string): Promise<CalendarResult> {
  const actor = await assertPermission("academics:manage");
  await assertNotPreviewing();
  if (!isUuid(id)) return fail("Choose an event.", "कार्यक्रम चुनें।");
  const { error } = await createAdminClient().from("calendar_events").update({ cancelled_at: new Date().toISOString(), cancelled_by: actor.id, updated_by: actor.id }).eq("id", id).is("cancelled_at", null);
  if (error) return fail("Could not cancel it.", "रद्द नहीं हुआ।");
  revalidatePath("/calendar", "layout");
  revalidatePath("/academics");
  return { ok: true, text: p("Event cancelled. It stays in the record.", "कार्यक्रम रद्द। रिकॉर्ड में रहेगा।") };
}

/** Ask to tell parents (or staff) about a holiday or an event. Waits for approval. */
export async function requestNoticeAction(input: { holidayDay?: string; eventId?: string; audience: string }): Promise<CalendarResult> {
  const actor = await assertPermission("academics:manage");
  await assertNotPreviewing();
  const session = await resolveSessionLabel();
  if (!session) return fail("No session is open.", "कोई सत्र खुला नहीं है।");
  const audience = AUDIENCES.find((a) => a === input.audience) ?? "parents";
  const admin = createAdminClient();
  if (input.eventId && isUuid(input.eventId)) {
    const e = await eventById(session, input.eventId);
    if (!e || e.cancelled) return fail("That event is gone.", "वह कार्यक्रम नहीं मिला।");
    const told = await recordNotice({ session, eventId: e.id, audience, classIds: e.classIds, text: eventNotice(e, whenLabel(e, shortDay)), actorId: actor.id });
    revalidatePath("/calendar", "layout");
    return { ok: true, text: p(`The notice to ${told} is saved; nothing is sent yet.`, `${told} के लिए सूचना सहेजी; अभी कुछ नहीं भेजा गया।`) };
  }
  if (!isDay(input.holidayDay)) return fail("Choose a holiday.", "छुट्टी चुनें।");
  const { data: day } = await admin.from("academic_calendar_days").select("day, label_en, label_hi, kind").eq("session_label", session).eq("day", input.holidayDay).maybeSingle<{ day: string; label_en: string | null; label_hi: string | null; kind: string }>();
  if (!day || (day.kind !== "holiday" && day.kind !== "vacation")) return fail("That day is not a holiday.", "वह दिन छुट्टी नहीं है।");
  const told = await recordNotice({ session, holidayDay: day.day, audience, classIds: [], text: holidayNotice(day.label_en ?? "the holiday", day.label_hi, dateLabel(day.day)), actorId: actor.id });
  revalidatePath("/calendar", "layout");
  return { ok: true, text: p(`The notice to ${told} is saved; nothing is sent yet.`, `${told} के लिए सूचना सहेजी; अभी कुछ नहीं भेजा गया।`) };
}
