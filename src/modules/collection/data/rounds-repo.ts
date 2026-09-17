import "server-only";

import { FEE_SCHEMA } from "@/platform/env";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { createAdminClient } from "@/platform/supabase/admin";
import {
  isAudienceEmpty,
  isFrozenSelection,
  parseAudience,
  type Audience,
} from "@/modules/collection/domain/audience";
import {
  feeColumnsFor,
  gapFields,
  isGapForAll,
  type HeldValue,
} from "@/modules/collection/domain/gaps";
import { activeFields } from "@/modules/collection/domain/fields";
import { listFieldsPublic } from "@/modules/collection/data/fields-repo";
import type { CollectionField } from "@/modules/collection/domain/fields";

/**
 * Turning a chosen audience into actual children.
 *
 * **One resolver, used by the preview and by the creation.** The number the
 * office is shown has to be the number that gets frozen; the day these were
 * two code paths is the day a preview could say nine and a round cover eleven.
 * So the preview is a server call rather than something the browser assembles
 * from what it happens to have loaded.
 *
 * Service-role throughout, because the fee app's RLS gates `public.*` on
 * `public.users.role` and VPPS One's staff hold none of them — a cookie client
 * reads zero rows and no error (D-32).
 *
 * Everything that can plausibly exceed a thousand rows goes through
 * `fetchAllRows`: PostgREST truncates at 1000 silently (D-62), and a resolver
 * that quietly stopped at a thousand children would mint links for the classes
 * it happened to reach.
 */

/** One child, resolved. */
export type ResolvedStudent = {
  studentId: string;
  fullName: string;
  admissionNo: string | null;
  rollNo: string | null;
  classId: string;
  classLabel: string;
  house: string | null;
  routeId: string | null;
};

export type ResolvedAudience = {
  students: ResolvedStudent[];
  /** Everyone the audience covered, before any gap filter narrowed it. */
  beforeGaps: number;
  /** The classes the resolved children fall across, in school order. */
  classIds: string[];
  /** Gap keys that named no field the registry still has. Reported, not hidden. */
  unknownGapKeys: string[];
};

type EnrolmentRow = {
  student_id: string;
  class_id: string;
  roll_no: string | null;
};

type FeeStudentRow = Record<string, string | null>;

type RecordRow = { student_id: string; field_id: string; value: string | null };

/**
 * Who this audience covers, right now.
 *
 * **Enrolment first, not `public.students.class_id`.** That column holds where
 * a child is *today* and the fee app overwrites it on promotion, so resolving
 * from it would put last year's Class 6 into this year's round (D-139).
 *
 * An empty audience resolves to **nobody**, never to everybody. A half-built
 * form has to fail small (D-150).
 */
export async function resolveAudience(
  audience: Audience,
  sessionLabel: string,
): Promise<ResolvedAudience> {
  const empty: ResolvedAudience = {
    students: [],
    beforeGaps: 0,
    classIds: [],
    unknownGapKeys: [],
  };

  if (isAudienceEmpty(audience)) return empty;

  const admin = createAdminClient();

  // 1. The roll. VPPS One's own record of who is in which class this session.
  const enrolments = await fetchAllRows<EnrolmentRow>(
    (from, to) => {
      let query = admin
        .from("enrolments")
        .select("student_id, class_id, roll_no")
        .eq("session_label", sessionLabel)
        .eq("status", "enrolled");

      // A frozen list is the whole audience and nothing else narrows it — but
      // `enrolled` still applies. A child who has left is not somebody to ask
      // a teacher about, whatever a list typed last term says.
      if (audience.studentIds.length > 0) {
        query = query.in("student_id", [...audience.studentIds]);
      } else if (audience.classIds.length > 0) {
        query = query.in("class_id", [...audience.classIds]);
      }

      return query.order("student_id").range(from, to);
    },
    "the roll",
  );

  if (enrolments.length === 0) return empty;

  // **A frozen list is the whole audience, and nothing else narrows it.**
  //
  // ANDing the ids back together with the filters they came from is the
  // nondeterminism freezing exists to remove: six numbers arrive overnight,
  // Resume re-resolves, and it finishes a round covering a smaller set than
  // the links it is completing — while a class whose last gap was filled gets
  // no link at all and the board still says nineteen groups.
  //
  // `enrolled` still applies, above: a child who has left is not somebody to
  // ask a teacher about, whatever a list typed last term says.
  const frozen = isFrozenSelection(audience);

  // 2. The fee app's own columns for those children. House, route and the
  //    values any gap filter compares against.
  const fields = activeFields(await listFieldsPublic());
  const wantedGapKeys = frozen ? [] : audience.gaps.map((gap) => gap.fieldKey);
  const filters = gapFields(fields, wantedGapKeys);
  const known = new Set(filters.map((field) => field.key));
  const unknownGapKeys = wantedGapKeys.filter((key) => !known.has(key));

  const columns = [
    "id",
    "full_name",
    "admission_no",
    "house",
    "transport_route_id",
    ...feeColumnsFor(filters),
  ];

  const ids = enrolments.map((row) => row.student_id);
  const feeRows = await readFeeStudents(admin, [...new Set(columns)], ids);
  const byId = new Map(feeRows.map((row) => [String(row.id), row]));

  // 3. VPPS One's own accepted answers, which beat the fee column.
  const recorded =
    filters.length === 0 ? new Map<string, string | null>() : await readRecords(admin, ids);

  const labels = await classLabels(admin, [
    ...new Set(enrolments.map((row) => row.class_id)),
  ]);

  // 4. Narrow. Each dimension is an AND, so every one of these is a filter
  //    that can only make the set smaller (D-150).
  const houses = new Set(frozen ? [] : audience.houses);
  const routes = new Set(frozen ? [] : audience.routeIds);
  const search = frozen ? "" : audience.search.trim().toLowerCase();

  const covered: ResolvedStudent[] = [];
  let beforeGaps = 0;

  for (const enrolment of enrolments) {
    const fee = byId.get(enrolment.student_id);

    // A child on VPPS One's roll with no fee record is a data-health problem
    // the enrolments screen already reports. Here they are simply not
    // resolvable — there is nothing to ask a teacher to confirm.
    if (!fee) continue;

    const house = blank(fee.house);
    const routeId = blank(fee.transport_route_id);
    const fullName = fee.full_name ?? "—";
    const admissionNo = blank(fee.admission_no);

    if (houses.size > 0 && (house === null || !houses.has(house))) continue;
    if (routes.size > 0 && (routeId === null || !routes.has(routeId))) continue;

    if (search !== "") {
      const haystack = `${fullName} ${admissionNo ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) continue;
    }

    beforeGaps += 1;

    if (filters.length > 0) {
      const heldFor = new Map<string, HeldValue>(
        filters.map((field) => [
          field.key,
          {
            recorded: recorded.get(`${enrolment.student_id}|${field.id}`) ?? null,
            fee: field.feeColumn ? (fee[field.feeColumn] ?? null) : null,
          },
        ]),
      );

      if (!isGapForAll(heldFor, filters.map((field) => field.key))) continue;
    }

    covered.push({
      studentId: enrolment.student_id,
      fullName,
      admissionNo,
      rollNo: enrolment.roll_no,
      classId: enrolment.class_id,
      classLabel: labels.get(enrolment.class_id) ?? "—",
      house,
      routeId,
    });
  }

  return {
    students: covered,
    beforeGaps,
    classIds: [...new Set(covered.map((row) => row.classId))],
    unknownGapKeys,
  };
}

/* ------------------------------------------------------------- the reads */

async function readFeeStudents(
  admin: ReturnType<typeof createAdminClient>,
  columns: string[],
  ids: string[],
): Promise<FeeStudentRow[]> {
  const out: FeeStudentRow[] = [];

  // Chunked on the *input*, not only on the output: a five-hundred-id `in()`
  // is a URL long enough to be refused before PostgREST ever counts rows.
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);

    const rows = await fetchAllRows<FeeStudentRow>(
      (from, to) =>
        admin
          .schema(FEE_SCHEMA)
          .from("students")
          .select(columns.join(", "))
          .in("id", slice)
          .order("id")
          .range(from, to)
          .returns<FeeStudentRow[]>(),
      "the students",
    );

    out.push(...rows);
  }

  return out;
}

async function readRecords(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, string | null>> {
  const held = new Map<string, string | null>();

  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);

    const rows = await fetchAllRows<RecordRow>(
      (from, to) =>
        admin
          .from("student_records")
          .select("student_id, field_id, value")
          .in("student_id", slice)
          .order("student_id")
          .range(from, to),
      "what the school holds",
    );

    for (const row of rows) held.set(`${row.student_id}|${row.field_id}`, row.value);
  }

  return held;
}

async function classLabels(
  admin: ReturnType<typeof createAdminClient>,
  classIds: string[],
): Promise<Map<string, string>> {
  if (classIds.length === 0) return new Map();

  const { data, error } = await admin
    .schema(FEE_SCHEMA)
    .from("classes")
    .select("id, class_name, sort_order")
    .in("id", classIds)
    .order("sort_order")
    .returns<{ id: string; class_name: string; sort_order: number | null }[]>();

  if (error) throw new Error(`Could not read the classes: ${error.message}`);

  // Insertion order is school order, so anything built from this Map is
  // already sorted and nothing downstream sorts a class label as text (D-130).
  return new Map((data ?? []).map((row) => [row.id, row.class_name]));
}

function blank(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/* ------------------------------------------------------------- the round */

export type RoundInput = {
  titleHi: string | null;
  titleEn: string | null;
  audience: Audience;
  fieldIds: readonly string[];
  dueDate: string | null;
  reasonHi: string | null;
  reasonEn: string | null;
  recipientMode: string;
};

export type Round = {
  id: string;
  sessionLabel: string;
  titleHi: string | null;
  titleEn: string | null;
  audience: Audience;
  dueDate: string | null;
  reasonHi: string | null;
  reasonEn: string | null;
  recipientMode: string;
  status: string;
  createdAt: string;
};

type RoundRow = {
  id: string;
  session_label: string;
  title_hi: string | null;
  title_en: string | null;
  audience: unknown;
  due_date: string | null;
  reason_hi: string | null;
  reason_en: string | null;
  recipient_mode: string;
  status: string;
  created_at: string;
};

const toRound = (row: RoundRow): Round => ({
  id: row.id,
  sessionLabel: row.session_label,
  titleHi: row.title_hi,
  titleEn: row.title_en,
  audience: parseAudience(row.audience),
  dueDate: row.due_date,
  reasonHi: row.reason_hi,
  reasonEn: row.reason_en,
  recipientMode: row.recipient_mode,
  status: row.status,
  createdAt: row.created_at,
});

const ROUND_COLUMNS =
  "id, session_label, title_hi, title_en, audience, due_date, reason_hi, " +
  "reason_en, recipient_mode, status, created_at";

/**
 * Write the round down. **It mints no links.**
 *
 * The round is the question and the selection; turning it into one link per
 * group is the fan-out, and it is R3.3's. Keeping them apart means the office
 * can write a round on Tuesday, look at the preview, and send on Wednesday —
 * and it means a fan-out that fails halfway has something to resume from.
 *
 * The audience is stored **as chosen**, not as resolved. The resolved set is
 * `collection_request_members`, frozen per link; keeping the description as
 * well is what lets the board still say "Class 6, no phone number" long after
 * the children in question have changed.
 */
export async function createRound(
  input: RoundInput,
  sessionLabel: string,
  createdByUserId: string,
): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("collection_rounds")
    .insert({
      session_label: sessionLabel,
      title_hi: input.titleHi,
      title_en: input.titleEn,
      audience: input.audience,
      due_date: input.dueDate,
      reason_hi: input.reasonHi,
      reason_en: input.reasonEn,
      recipient_mode: input.recipientMode,
      status: "draft",
      created_by: createdByUserId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) throw new Error(`Could not save the round: ${error.message}`);

  const { error: fieldError } = await createAdminClient()
    .from("collection_round_fields")
    .insert(
      input.fieldIds.map((fieldId, index) => ({
        round_id: data.id,
        field_id: fieldId,
        sort_order: index,
      })),
    );

  if (fieldError) throw new Error(`Could not save the round: ${fieldError.message}`);

  return data.id;
}

export async function roundById(id: string): Promise<Round | null> {
  const { data, error } = await createAdminClient()
    .from("collection_rounds")
    .select(ROUND_COLUMNS)
    .eq("id", id)
    .maybeSingle<RoundRow>();

  if (error) throw new Error(`Could not read the round: ${error.message}`);
  return data ? toRound(data) : null;
}

export async function listRounds(sessionLabel: string): Promise<Round[]> {
  const { data, error } = await createAdminClient()
    .from("collection_rounds")
    .select(ROUND_COLUMNS)
    .eq("session_label", sessionLabel)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<RoundRow[]>();

  if (error) throw new Error(`Could not read the rounds: ${error.message}`);
  return (data ?? []).map(toRound);
}

/** The fields a round asks for, in the order they were chosen. */
export async function fieldsForRound(roundId: string): Promise<CollectionField[]> {
  const all = await listFieldsPublic();
  const byId = new Map(all.map((field) => [field.id, field]));

  const { data, error } = await createAdminClient()
    .from("collection_round_fields")
    .select("field_id, sort_order")
    .eq("round_id", roundId)
    .order("sort_order")
    .returns<{ field_id: string; sort_order: number }[]>();

  if (error) throw new Error(`Could not read the round: ${error.message}`);

  return (data ?? [])
    .map((row) => byId.get(row.field_id))
    .filter((field): field is CollectionField => field !== undefined);
}
