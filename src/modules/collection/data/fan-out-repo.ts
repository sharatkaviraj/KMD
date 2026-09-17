import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { MASTER_AUDIENCE_LABEL } from "@/modules/collection/domain/audience";
import {
  groupsStillNeeded,
  isRecipientMode,
  planFanOut,
  scopeKindFor,
  type FanOutPlan,
  type PlannableStudent,
  type ReadyGroup,
} from "@/modules/collection/domain/fan-out";
import type { Owner } from "@/modules/collection/domain/ownership";
import {
  freezeMembers,
  generateToken,
} from "@/modules/collection/data/requests-repo";
import {
  fieldsForRound,
  resolveAudience,
  type Round,
} from "@/modules/collection/data/rounds-repo";

/**
 * Turning a round into links, and keeping them together afterwards.
 *
 * **The fan-out is not one transaction, deliberately.** Per-link atomicity is
 * kept — a link whose roster fails to freeze deletes itself, so none ever
 * opens to an empty list. But if link seven of eleven fails, the first six are
 * **kept**: six live tokens with frozen rosters are six classes the office can
 * send to right now, and deleting them to satisfy an all-or-nothing aesthetic
 * destroys real work and buys nothing, because the office would simply do it
 * again. The round reports what is missing and Resume finishes the job.
 *
 * Sequential, not `Promise.all`. Nineteen concurrent bursts each doing a
 * chunked roster insert is how a connection cap is met, and going in order
 * means a failure stops at a known point rather than somewhere in the middle
 * of nineteen half-finished writes.
 */

/* ------------------------------------------------------- who can receive */

type ProfileRow = {
  id: string;
  display_name: string;
  phone: string | null;
  whatsapp_phone: string | null;
  is_active: boolean;
};

/**
 * Everybody a link could be handed to, with what they are in charge of.
 *
 * Classes come from `class_teachers` and houses and routes from
 * `staff_scopes` — one source of truth per kind, because a class teacher has
 * handover dates a bus route in-charge does not (B-32).
 *
 * The WhatsApp number wins where there is one: it is the number a link is
 * actually sent to, and falling back the other way would show the office a
 * number the send would not use.
 */
export async function recipientsFor(sessionLabel: string): Promise<Owner[]> {
  const admin = createAdminClient();

  const [profiles, classTeachers, scopes] = await Promise.all([
    admin
      .from("staff_profiles")
      .select("id, display_name, phone, whatsapp_phone, is_active")
      .eq("is_active", true)
      .order("display_name")
      .returns<ProfileRow[]>(),
    admin
      .from("class_teachers")
      .select("staff_profile_id, class_id")
      .eq("session_label", sessionLabel)
      .is("effective_to", null)
      .returns<{ staff_profile_id: string; class_id: string }[]>(),
    admin
      .from("staff_scopes")
      .select("staff_profile_id, kind, value")
      .eq("session_label", sessionLabel)
      .returns<{ staff_profile_id: string; kind: string; value: string }[]>(),
  ]);

  if (profiles.error) {
    throw new Error(`Could not read the staff: ${profiles.error.message}`);
  }

  const classesOf = new Map<string, string[]>();
  for (const row of classTeachers.data ?? []) {
    classesOf.set(row.staff_profile_id, [
      ...(classesOf.get(row.staff_profile_id) ?? []),
      row.class_id,
    ]);
  }

  const housesOf = new Map<string, string[]>();
  const routesOf = new Map<string, string[]>();
  for (const row of scopes.data ?? []) {
    const into = row.kind === "house" ? housesOf : routesOf;
    into.set(row.staff_profile_id, [...(into.get(row.staff_profile_id) ?? []), row.value]);
  }

  return (profiles.data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    phone: row.whatsapp_phone ?? row.phone,
    classIds: classesOf.get(row.id) ?? [],
    houses: housesOf.get(row.id) ?? [],
    routeIds: routesOf.get(row.id) ?? [],
  }));
}

/* ------------------------------------------------------------- the plan */

/**
 * What this round would create, without creating anything.
 *
 * A server call rather than something the browser assembles, for the same
 * reason the preview count is: only the server can resolve the audience, and
 * the number the office is shown has to be the number that gets frozen.
 */
export async function planForRound(
  round: Round,
  sessionLabel: string,
): Promise<FanOutPlan> {
  const [resolved, owners] = await Promise.all([
    resolveAudience(round.audience, sessionLabel),
    recipientsFor(sessionLabel),
  ]);

  const labels = new Map(
    resolved.students.map((row) => [row.classId, row.classLabel]),
  );

  const students: PlannableStudent[] = resolved.students.map((row) => ({
    studentId: row.studentId,
    fullName: row.fullName,
    classId: row.classId,
    classLabel: row.classLabel,
    house: row.house,
    routeId: row.routeId,
  }));

  const mode = isRecipientMode(round.recipientMode)
    ? round.recipientMode
    : "class_teacher";

  return planFanOut(students, owners, mode, (kind, value) =>
    kind === "class" ? (labels.get(value) ?? value) : value,
  );
}

/* ------------------------------------------------------------ the links */

export type RoundLink = {
  id: string;
  token: string;
  audienceKind: string;
  audienceLabel: string;
  classId: string | null;
  status: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  contactPhone: string | null;
  sentAt: string | null;
  remindedAt: string | null;
  reminderCount: number;
  members: number;
  answered: number;
};

type LinkRow = {
  id: string;
  token: string;
  audience_kind: string;
  audience_label: string;
  class_id: string | null;
  status: string;
  assigned_staff_id: string | null;
  contact_phone: string | null;
  sent_at: string | null;
  reminded_at: string | null;
  reminder_count: number;
};

/**
 * Every link a round has minted, with how far each has got.
 *
 * The counts are what makes this a board rather than a list: "Class 6, 14
 * children, 9 answered" is the sentence somebody chasing a round needs, and a
 * list of tokens is not.
 */
export async function linksForRound(roundId: string): Promise<RoundLink[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("collection_requests")
    .select(
      "id, token, audience_kind, audience_label, class_id, status, " +
        "assigned_staff_id, contact_phone, sent_at, reminded_at, reminder_count",
    )
    .eq("round_id", roundId)
    .is("archived_at", null)
    .order("audience_kind")
    .order("audience_label")
    .returns<LinkRow[]>();

  if (error) throw new Error(`Could not read the links: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);

  const [members, answers, staff] = await Promise.all([
    fetchAllRows<{ request_id: string; student_id: string }>(
      (from, to) =>
        admin
          .from("collection_request_members")
          .select("request_id, student_id")
          .in("request_id", ids)
          .order("request_id")
          .range(from, to)
          .returns<{ request_id: string; student_id: string }[]>(),
      "who was asked",
    ),
    fetchAllRows<{ request_id: string; student_id: string }>(
      (from, to) =>
        admin
          .from("collection_submissions")
          .select("request_id, student_id")
          .in("request_id", ids)
          .order("request_id")
          .range(from, to)
          .returns<{ request_id: string; student_id: string }[]>(),
      "the answers",
    ),
    admin
      .from("staff_profiles")
      .select("id, display_name")
      .returns<{ id: string; display_name: string }[]>(),
  ]);

  const nameOf = new Map((staff.data ?? []).map((row) => [row.id, row.display_name]));

  const countPerRequest = (
    list: { request_id: string; student_id: string }[],
  ): Map<string, number> => {
    // Distinct children, not rows: a child answering three fields is one
    // child, and counting rows would show "19 of 14 answered".
    const seen = new Map<string, Set<string>>();
    for (const row of list) {
      const set = seen.get(row.request_id) ?? new Set<string>();
      set.add(row.student_id);
      seen.set(row.request_id, set);
    }
    return new Map([...seen].map(([id, set]) => [id, set.size]));
  };

  const memberCount = countPerRequest(members);
  const answeredCount = countPerRequest(answers);

  return rows.map((row) => ({
    id: row.id,
    token: row.token,
    audienceKind: row.audience_kind,
    audienceLabel: row.audience_label,
    classId: row.class_id,
    status: row.status,
    assignedStaffId: row.assigned_staff_id,
    assignedStaffName: row.assigned_staff_id
      ? (nameOf.get(row.assigned_staff_id) ?? null)
      : null,
    contactPhone: row.contact_phone,
    sentAt: row.sent_at,
    remindedAt: row.reminded_at,
    reminderCount: row.reminder_count,
    members: memberCount.get(row.id) ?? 0,
    answered: answeredCount.get(row.id) ?? 0,
  }));
}

/**
 * Every scope this round has **ever** minted, archived ones included.
 *
 * Deliberately not `linksForRound()`, which hides archived links because the
 * board should not show them. The unique index does not hide them: it is on
 * `(round_id, audience_kind, audience_label)` with no `archived_at` in it, so
 * resuming against a list that skipped an archived group would try to mint a
 * second link for a scope that already has one — and fail, permanently, on a
 * round nobody could see the reason for.
 *
 * Archiving is "hide the clutter, keep the evidence" (see the migration). A
 * scope that was archived was still asked, and asking it again is a decision
 * somebody has to take deliberately rather than one Resume takes for them.
 */
async function scopesAlreadyMinted(
  roundId: string,
): Promise<{ kind: string; label: string }[]> {
  const { data, error } = await createAdminClient()
    .from("collection_requests")
    .select("audience_kind, audience_label")
    .eq("round_id", roundId)
    .returns<{ audience_kind: string; audience_label: string }[]>();

  if (error) throw new Error(`Could not read the links: ${error.message}`);

  return (data ?? []).map((row) => ({
    kind: row.audience_kind,
    label: row.audience_label,
  }));
}

export type FanOutResult = {
  created: number;
  /** Groups that were already there. Resume run twice is not an error. */
  skipped: number;
  /** The group that stopped the run, if one did. */
  failed: { label: string; message: string } | null;
};

/**
 * Mint the links this round is still missing.
 *
 * **This is both "send" and "resume".** There is no separate resume path,
 * because a resume *is* "create the groups that are not there yet" — and
 * making it the only path means the half that runs after a failure is the same
 * code that ran before it, rather than a second implementation nobody
 * exercises until something has already gone wrong.
 *
 * The unique index on `(round_id, audience_kind, audience_label)` is what
 * makes a double-tapped button safe: a racing second call hits the index
 * rather than minting a second token for a group that already has one.
 */
export async function createLinks(
  round: Round,
  plan: FanOutPlan,
  createdByUserId: string,
  sessionLabel: string,
): Promise<FanOutResult> {
  const admin = createAdminClient();
  const fields = await fieldsForRound(round.id);

  if (fields.length === 0) {
    throw new Error("This round asks for nothing, so it has no links to make.");
  }

  const existing = await scopesAlreadyMinted(round.id);
  const needed = groupsStillNeeded(plan.ready, existing);

  const result: FanOutResult = {
    created: 0,
    skipped: plan.ready.length - needed.length,
    failed: null,
  };

  for (const group of needed) {
    try {
      await createOneLink(admin, round, group, fields.map((f) => f.id), createdByUserId, sessionLabel);
      result.created += 1;
    } catch (error) {
      // **Stop, keep what was made, and say which group stopped it.** The
      // links already minted are real work the office can use right now.
      result.failed = {
        label: group.scope.label,
        message: error instanceof Error ? error.message : String(error),
      };
      break;
    }
  }

  return result;
}

async function createOneLink(
  admin: ReturnType<typeof createAdminClient>,
  round: Round,
  group: ReadyGroup,
  fieldIds: string[],
  createdByUserId: string,
  sessionLabel: string,
): Promise<void> {
  const isClass = group.scope.kind === "class";

  const { data, error } = await admin
    .from("collection_requests")
    .insert({
      session_label: sessionLabel,
      round_id: round.id,
      title_hi: round.titleHi,
      title_en: round.titleEn,
      audience_kind: group.scope.kind,
      audience_label: group.scope.label,
      // The check constraint requires a class for a class link, and forbids
      // pretending a house has one.
      class_id: isClass ? group.scope.value : null,
      class_label: isClass ? group.scope.label : null,
      assigned_staff_id: group.ownerId,
      token: generateToken(),
      due_date: round.dueDate,
      reason_hi: round.reasonHi,
      reason_en: round.reasonEn,
      status: "draft",
      created_by: createdByUserId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) throw new Error(`Could not make the link: ${error.message}`);

  try {
    const { error: fieldError } = await admin
      .from("collection_request_fields")
      .insert(
        fieldIds.map((fieldId, index) => ({
          request_id: data.id,
          field_id: fieldId,
          sort_order: index,
        })),
      );

    if (fieldError) throw new Error(fieldError.message);

    // Frozen from the ids the plan resolved, so the link asks about exactly
    // the children the preview counted — not about whoever is in that class
    // by the time somebody opens it (S-02).
    const frozen = await freezeMembers(
      data.id,
      isClass ? group.scope.value : null,
      sessionLabel,
      group.studentIds,
    );

    if (frozen === 0) throw new Error("No children could be frozen onto the link.");

    // Per-link atomicity, kept. A link that opens to an empty list is worse
    // than no link: the teacher reads it as "nothing to do" and says so.
    const notes = round.audience.notes;
    const withNotes = group.studentIds.filter((id) => notes[id]);

    if (withNotes.length > 0) {
      const { error: noteError } = await admin
        .from("collection_request_members")
        .upsert(
          withNotes.map((studentId) => ({
            request_id: data.id,
            student_id: studentId,
            ask_note: notes[studentId],
          })),
          { onConflict: "request_id,student_id" },
        );

      // A note that failed to attach is not worth destroying the link over:
      // the question still reaches the teacher, just without the aside.
      if (noteError) {
        console.error(`Could not attach the notes: ${noteError.message}`);
      }
    }
  } catch (error) {
    await admin.from("collection_requests").delete().eq("id", data.id);
    throw error;
  }
}

/**
 * The office's own link over the whole round.
 *
 * Written **after** the fan-out rather than planned with it: it is not a group
 * and has no owner, it covers whatever the round covers, and its label is a
 * constant so "one master link per round" is the unique index's job rather
 * than a check somebody remembers to write (D-145).
 */
export async function ensureMasterLink(
  round: Round,
  createdByUserId: string,
  sessionLabel: string,
  studentIds: readonly string[],
): Promise<string | null> {
  if (studentIds.length === 0) return null;

  const admin = createAdminClient();

  // Archived included, for the reason `scopesAlreadyMinted` exists: the unique
  // index does not care that a link is hidden.
  const already = (await scopesAlreadyMinted(round.id)).some(
    (scope) => scope.kind === "master",
  );
  if (already) return null;

  const fields = await fieldsForRound(round.id);
  if (fields.length === 0) return null;

  const { data, error } = await admin
    .from("collection_requests")
    .insert({
      session_label: sessionLabel,
      round_id: round.id,
      title_hi: round.titleHi,
      title_en: round.titleEn,
      audience_kind: "master",
      audience_label: MASTER_AUDIENCE_LABEL,
      class_id: null,
      class_label: null,
      assigned_staff_id: null,
      token: generateToken(),
      due_date: round.dueDate,
      reason_hi: round.reasonHi,
      reason_en: round.reasonEn,
      status: "draft",
      created_by: createdByUserId,
    })
    .select("id")
    .single<{ id: string }>();

  // A racing second press hits the unique index. That is the index doing its
  // job, not a failure worth showing anybody.
  if (error) return null;

  try {
    await admin.from("collection_request_fields").insert(
      fields.map((field, index) => ({
        request_id: data.id,
        field_id: field.id,
        sort_order: index,
      })),
    );

    const frozen = await freezeMembers(data.id, null, sessionLabel, studentIds);
    if (frozen === 0) throw new Error("No children could be frozen onto the link.");
  } catch {
    await admin.from("collection_requests").delete().eq("id", data.id);
    return null;
  }

  return data.id;
}

/* ------------------------------------------------------- handing it over */

/**
 * Open every link this round has, so its tokens start working.
 *
 * One statement rather than a loop: opening a round is a single decision, and
 * nineteen separate updates is nineteen chances to half-open one.
 */
export async function openRound(roundId: string): Promise<number> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("collection_requests")
    .update({ status: "open", opened_at: new Date().toISOString() })
    .eq("round_id", roundId)
    .eq("status", "draft")
    .select("id")
    .returns<{ id: string }[]>();

  if (error) throw new Error(`Could not open the links: ${error.message}`);

  const { error: roundError } = await admin
    .from("collection_rounds")
    .update({ status: "open" })
    .eq("id", roundId);

  if (roundError) throw new Error(`Could not open the round: ${roundError.message}`);

  return (data ?? []).length;
}

/**
 * Write down that a link was handed over, or chased again.
 *
 * Handing over happens once, so `sent_at` is both "when" and "whether". A
 * chase happens again every week the answers do not arrive, so the useful
 * facts there are the most recent one and how many there have been —
 * deliberately a different shape.
 */
export async function markSent(requestId: string, byStaffId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("collection_requests")
    .update({ sent_at: new Date().toISOString(), sent_by: byStaffId })
    .eq("id", requestId)
    .is("sent_at", null);

  if (error) throw new Error(`Could not record the send: ${error.message}`);
}

export async function markReminded(
  requestId: string,
  byStaffId: string,
  previousCount: number,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("collection_requests")
    .update({
      reminded_at: new Date().toISOString(),
      reminded_by: byStaffId,
      reminder_count: previousCount + 1,
    })
    .eq("id", requestId);

  if (error) throw new Error(`Could not record the reminder: ${error.message}`);
}

/** Everyone the round's plan would cover, for the master link. */
export function coveredStudentIds(plan: FanOutPlan): string[] {
  return [...new Set(plan.ready.flatMap((group) => group.studentIds))];
}

export { scopeKindFor };
