import "server-only";

import { assertPermission, assertStaff } from "@/platform/auth/current-staff";
import { ACTIVE_SESSION_KEY, pickSessionLabel } from "@/platform/config/active-session";
import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import type {
  ClassAlias,
  ClassAliasInput,
  CreateSubjectInput,
  FeeClass,
  Subject,
  UpdateSubjectInput,
} from "@/modules/academics/domain/subjects";
import {
  inSchoolOrder,
  type ClassChoice,
} from "@/modules/academics/domain/class-order";

/**
 * Reads and writes for the academics master data, plus the one read that
 * crosses into the fee app's schema.
 */

/* ---------------------------------------------------------------- classes */

type FeeClassRow = {
  id: string;
  class_name: string;
  section: string | null;
  stream_name: string | null;
  sort_order: number | null;
  session_label: string;
};

/**
 * The fee app's classes. **SELECT only, forever** (rule 2, D-5).
 *
 * Two things about this read are deliberate:
 *
 * **`.schema(FEE_SCHEMA)` is explicit at the call site**, not hidden behind a
 * helper. Every client defaults to `vppsone`, so reaching into `public` should
 * be visible to whoever is reading.
 *
 * **It uses the service-role client**, which is the only way it can work. The
 * fee app's RLS gates `public.classes` on `has_any_permission(...)`, which
 * reads `public.users.role` — the fee app's own role column. VPPS One staff
 * have no row there by design (D-6), so through the cookie client this query
 * returns zero rows and no error, which reads as "the school has no classes".
 *
 * The fix cannot be a policy: rule 2 forbids adding one to a fee table. So the
 * read bypasses RLS and VPPS One's own permission check becomes the thing
 * protecting it — which is why `assertPermission` is called here rather than
 * left to the caller (D-32). It is free: the profile is cached per request.
 */
export async function listFeeClasses(sessionLabel: string): Promise<FeeClass[]> {
  await assertPermission("academics:view");

  const { data, error } = await createAdminClient()
    .schema(FEE_SCHEMA)
    .from("classes")
    .select("id, class_name, section, stream_name, sort_order, session_label")
    .eq("session_label", sessionLabel)
    .order("sort_order")
    .returns<FeeClassRow[]>();

  if (error) {
    throw new Error(`Could not read the fee app's classes: ${error.message}`);
  }

  return data.map((row) => ({
    id: row.id,
    className: row.class_name,
    section: row.section,
    streamName: row.stream_name,
    sortOrder: row.sort_order ?? 0,
    sessionLabel: row.session_label,
  }));
}

/**
 * Every session the fee app's classes belong to, newest first.
 *
 * There is no `public.sessions` table on this database — the label lives on
 * each class row — so the list of sessions is a DISTINCT over classes.
 *
 * Service-role for the same reason as `listFeeClasses`: the fee app's RLS
 * would silently return nothing.
 *
 * **Gated on being staff rather than on `academics:view`**, unlike the class
 * list above. Which session the school is in is not master data somebody
 * manages — it is the year, and every screen in the app needs it to ask any
 * question at all. Gating it on `academics:view` meant a teacher opening their
 * own register threw "Permission denied: academics:view" before it could read
 * a single mark (D-53).
 */
export async function listSessionLabels(): Promise<string[]> {
  await assertStaff();

  const { data, error } = await createAdminClient()
    .schema(FEE_SCHEMA)
    .from("classes")
    .select("session_label")
    .returns<{ session_label: string }[]>();

  if (error) {
    throw new Error(`Could not read the sessions: ${error.message}`);
  }

  return [...new Set(data.map((row) => row.session_label))].sort().reverse();
}

/**
 * Every class's name, by id — the labels a screen needs to say anything.
 *
 * The alias wins when the school has given one, because that is the name they
 * chose to see; otherwise the fee app's own name. A class with neither is
 * still in the map under a dash rather than missing, so a register never
 * renders a bare UUID at a teacher.
 *
 * **In school order** (`sort_order`, alias first), because a Map keeps its
 * insertion order and four screens were each turning this into a list and
 * sorting it alphabetically — which puts Class 10, 11 and 12 between Class 1
 * and Class 2 (B-06). Iterating it now gives the order the school agreed on.
 *
 * Gated on being staff, for the reason `listSessionLabels()` is: a class is
 * called "Class 6 A" and knowing that is not a privilege. Every teacher screen
 * needs it, and the screens that *edit* classes keep their `academics:view`
 * gate.
 */
export async function classLabelMap(
  sessionLabel: string,
): Promise<Map<string, string>> {
  await assertStaff();

  const [classes, aliases] = await Promise.all([
    (async () => {
      const { data, error } = await createAdminClient()
        .schema(FEE_SCHEMA)
        .from("classes")
        .select("id, class_name, section, sort_order")
        .eq("session_label", sessionLabel)
        .returns<
          {
            id: string;
            class_name: string;
            section: string | null;
            sort_order: number | null;
          }[]
        >();

      if (error) {
        throw new Error(`Could not read the classes: ${error.message}`);
      }
      return data;
    })(),
    listClassAliases(sessionLabel),
  ]);

  const aliasById = new Map(aliases.map((alias) => [alias.classId, alias]));

  const ordered = inSchoolOrder(
    classes.map((row) => {
      const alias = aliasById.get(row.id);
      const preferred = alias?.displayName ?? alias?.timetableLabel;

      return {
        id: row.id,
        label:
          preferred ||
          [row.class_name, row.section].filter(Boolean).join(" ") ||
          "—",
        sortOrder: alias?.sortOrder ?? row.sort_order ?? 0,
      };
    }),
  );

  return new Map(ordered.map((choice) => [choice.id, choice.label]));
}

/**
 * Every class as a choice, in the order the school puts them in.
 *
 * The one list four screens were each deriving for themselves, and each
 * sorting alphabetically — which gives Class 1, Class 10, Class 11, Class 12,
 * Class 2 (B-06). The order already existed on both tables and was simply
 * being thrown away by `[...map.entries()].sort(byLabel)`.
 *
 * Gated on being staff like `classLabelMap()`, and for the same reason: which
 * classes the school has is not a privilege, and every teacher screen needs it.
 */
export async function listClassChoices(
  sessionLabel: string,
): Promise<ClassChoice[]> {
  await assertStaff();

  const [classes, aliases] = await Promise.all([
    (async () => {
      const { data, error } = await createAdminClient()
        .schema(FEE_SCHEMA)
        .from("classes")
        .select("id, class_name, section, sort_order")
        .eq("session_label", sessionLabel)
        .returns<
          {
            id: string;
            class_name: string;
            section: string | null;
            sort_order: number | null;
          }[]
        >();

      if (error) {
        throw new Error(`Could not read the classes: ${error.message}`);
      }
      return data;
    })(),
    listClassAliases(sessionLabel),
  ]);

  const aliasById = new Map(aliases.map((alias) => [alias.classId, alias]));

  return inSchoolOrder(
    classes.map((row) => {
      const alias = aliasById.get(row.id);
      const label =
        alias?.displayName ??
        alias?.timetableLabel ??
        [row.class_name, row.section].filter(Boolean).join(" ");

      return {
        id: row.id,
        label: label || "—",
        // The alias sort order wins when the school set one: it is the order
        // they chose to see, and the fee app own is what it falls back to.
        sortOrder: alias?.sortOrder ?? row.sort_order ?? 0,
      };
    }),
  );
}

/* --------------------------------------------------------------- subjects */

const SUBJECT_COLUMNS = "id, code, name_hi, name_en, is_active, sort_order";

type SubjectRow = {
  id: string;
  code: string;
  name_hi: string;
  name_en: string;
  is_active: boolean;
  sort_order: number;
};

const toSubject = (row: SubjectRow): Subject => ({
  id: row.id,
  code: row.code,
  nameHi: row.name_hi,
  nameEn: row.name_en,
  isActive: row.is_active,
  sortOrder: row.sort_order,
});

export async function listSubjects(): Promise<Subject[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subjects")
    .select(SUBJECT_COLUMNS)
    .order("sort_order")
    .returns<SubjectRow[]>();

  if (error) {
    throw new Error(`Could not read the subjects: ${error.message}`);
  }

  return data.map(toSubject);
}

export async function getSubjectById(id: string): Promise<Subject | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subjects")
    .select(SUBJECT_COLUMNS)
    .eq("id", id)
    .maybeSingle<SubjectRow>();

  if (error) throw new Error(`Could not read that subject: ${error.message}`);
  return data ? toSubject(data) : null;
}

export async function findSubjectByCode(code: string): Promise<Subject | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subjects")
    .select(SUBJECT_COLUMNS)
    .ilike("code", code)
    .maybeSingle<SubjectRow>();

  if (error) throw new Error(`Could not check that code: ${error.message}`);
  return data ? toSubject(data) : null;
}

export async function createSubject(
  input: CreateSubjectInput,
  createdByUserId: string,
): Promise<void> {
  const { error } = await createAdminClient().from("subjects").insert({
    code: input.code,
    name_hi: input.nameHi,
    name_en: input.nameEn,
    sort_order: input.sortOrder,
    is_active: true,
    created_by: createdByUserId,
  });

  if (error) throw error;
}

/** `code` is absent: immutable, enforced by a trigger. */
export async function updateSubject(
  id: string,
  input: UpdateSubjectInput,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("subjects")
    .update({
      name_hi: input.nameHi,
      name_en: input.nameEn,
      sort_order: input.sortOrder,
    })
    .eq("id", id);

  if (error) throw error;
}

export async function setSubjectActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await createAdminClient()
    .from("subjects")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) throw error;
}

/* ---------------------------------------------------------- class aliases */

const ALIAS_COLUMNS =
  "id, class_id, session_label, timetable_label, display_name, sort_order";

type AliasRow = {
  id: string;
  class_id: string;
  session_label: string;
  timetable_label: string;
  display_name: string | null;
  sort_order: number;
};

const toAlias = (row: AliasRow): ClassAlias => ({
  id: row.id,
  classId: row.class_id,
  sessionLabel: row.session_label,
  timetableLabel: row.timetable_label,
  displayName: row.display_name,
  sortOrder: row.sort_order,
});

export async function listClassAliases(sessionLabel: string): Promise<ClassAlias[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_aliases")
    .select(ALIAS_COLUMNS)
    .eq("session_label", sessionLabel)
    .order("sort_order")
    .returns<AliasRow[]>();

  if (error) {
    throw new Error(`Could not read the class aliases: ${error.message}`);
  }

  return data.map(toAlias);
}

/**
 * Create or replace the alias for one class in one session.
 *
 * An upsert on `(class_id, session_label)` rather than an insert: the screen
 * offers one field per class, so saving it twice is an edit, not a duplicate.
 */
export async function upsertClassAlias(
  input: ClassAliasInput,
  sessionLabel: string,
  createdByUserId: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("class_aliases")
    .upsert(
      {
        class_id: input.classId,
        session_label: sessionLabel,
        timetable_label: input.timetableLabel,
        display_name: input.displayName,
        sort_order: input.sortOrder,
        created_by: createdByUserId,
      },
      { onConflict: "class_id,session_label" },
    );

  if (error) throw error;
}

export async function deleteClassAlias(id: string): Promise<void> {
  // Deleting an alias is safe in a way that deleting a staff profile is not:
  // it is a mapping, not a fact about a person, and nothing records history
  // against it. Phase 2 resolves against whatever the map says today.
  const { error } = await createAdminClient()
    .from("class_aliases")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

/* ---------------------------------------------------------------- session */

/**
 * Which academic session every screen in this app is looking at.
 *
 * Derived from the fee app's own rows rather than configured, so at cutover it
 * follows the real session with no variable to remember. The
 * `VPPSONE_SESSION_LABEL` override exists for the weeks when two sessions
 * overlap and the newest label is not the one being worked on.
 *
 * **It used to end `return labels[0]`, and `listSessionLabels()` sorts
 * descending — so "the session the school is in" meant "the label that sorts
 * last".** Those are the same answer only while there is one session. The fee
 * database has three: `2026-27`, `2027-28` and `TEST-2026-27`, the rehearsal
 * session the bulk-payment template tells people to practise in. `T` sorts
 * above `2`, so the answer was `TEST-2026-27`.
 *
 * Ninety-two call sites ask this question — every register, every mark, every
 * cover plan, the teacher's day and the administrator's dashboard. On a
 * database with a rehearsal session they would all quietly work in it: screens
 * read empty because the real children are elsewhere, and anything saved is
 * written into the rehearsal year. Nothing raises. A teacher would see "no
 * timetable in effect" on a school day and have no way to tell why.
 *
 * `schoolfees-dev` had exactly one session until its data was replaced with a
 * masked copy of live, which is the first time this could be seen at all, and
 * it is what cutover would have hit on day one.
 *
 * `app_settings.active_session_label` is the row the fee app's own
 * `getActiveSessionLabel()` reads, so both halves of the merged application
 * now answer this question the same way. The sort survives only for a database
 * that has no such row.
 */
export async function resolveSessionLabel(
  requested?: string | null,
): Promise<string | null> {
  const [labels, { data: setting }] = await Promise.all([
    listSessionLabels(),
    createAdminClient()
      .schema(FEE_SCHEMA)
      .from("app_settings")
      .select("value")
      .eq("key", ACTIVE_SESSION_KEY)
      .maybeSingle<{ value: string | null }>(),
  ]);

  return pickSessionLabel({
    requested,
    configured: process.env.VPPSONE_SESSION_LABEL,
    active: setting?.value,
    labels,
  });
}
