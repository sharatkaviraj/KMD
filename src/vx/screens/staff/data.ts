import "server-only";

import { requirePermission } from "@/platform/auth/current-staff";
import { can, staffRoles, type StaffRole } from "@/platform/auth/permissions";
import { createAdminClient } from "@/platform/supabase/admin";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { getPublishedVersion, listSlots } from "@/modules/timetable/data/timetable-repo";
import { schoolToday } from "@/vx/format";
import { p, type Pair } from "@/vx/text";

import { matrixFromRows, type Matrix } from "./domain/matrix";
import type { StaffRow } from "./domain/people";

export type StaffEvent = { id: string; staffId: string; at: string; text: Pair; kind: "disabled" | "enabled" | "role"; actor: string | null };

export type StaffScreenData = {
  sessionLabel: string | null;
  rows: StaffRow[];
  /** Periods per weekday (Mon..Sat) for each staff member, from the live timetable. */
  load: Record<string, number[]>;
  matrix: Matrix;
  roleCounts: Record<StaffRole, number>;
  events: StaffEvent[];
  mayManage: boolean;
  isAdmin: boolean;
  mayEditMatrix: boolean;
  meId: string;
};

const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type AuthInfo = { email: string | null; lastSignInAt: string | null };

/** Sign-in facts from Supabase Auth, for the profiles that have a login. */
async function authUsers(): Promise<Map<string, AuthInfo>> {
  const out = new Map<string, AuthInfo>();
  const admin = createAdminClient();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) break;
    for (const user of data.users) {
      out.set(user.id, { email: user.email ?? null, lastSignInAt: user.last_sign_in_at ?? null });
    }
    if (data.users.length < 200) break;
  }
  return out;
}

/**
 * Everything the Staff & roles screen draws, read once. Guarded on
 * `staff:view` here as well as on the page, because it reads phone numbers
 * and sign-in facts through the service role.
 */
export async function loadStaffScreen(): Promise<StaffScreenData> {
  const me = await requirePermission("staff:view", "/staff");
  const sessionLabel = await resolveSessionLabel();
  const admin = createAdminClient();
  const today = schoolToday();

  const [people, users, matrixRows, classTeacherRows, published, labels, subjects, authorityRows] = await Promise.all([
    listStaff(),
    authUsers().catch(() => new Map<string, AuthInfo>()),
    admin.from("role_permissions").select("role, permission").returns<{ role: string; permission: string }[]>(),
    sessionLabel
      ? admin
          .from("class_teachers")
          .select("class_id, staff_profile_id, effective_from, effective_to")
          .eq("session_label", sessionLabel)
          .returns<{ class_id: string; staff_profile_id: string; effective_from: string; effective_to: string | null }[]>()
      : Promise.resolve({ data: [] as { class_id: string; staff_profile_id: string; effective_from: string; effective_to: string | null }[] }),
    sessionLabel ? getPublishedVersion(sessionLabel) : Promise.resolve(null),
    sessionLabel ? classLabelMap(sessionLabel) : Promise.resolve(new Map<string, string>()),
    admin.from("subjects").select("id, code, name_en").returns<{ id: string; code: string; name_en: string }[]>(),
    admin
      .from("staff_authority_changes")
      .select("id, staff_profile_id, actor_staff_id, from_role, to_role, from_active, to_active, reason, changed_at")
      .order("changed_at", { ascending: false })
      .limit(200)
      .returns<{ id: string; staff_profile_id: string; actor_staff_id: string | null; from_role: string; to_role: string; from_active: boolean; to_active: boolean; reason: string | null; changed_at: string }[]>(),
  ]);

  const slots = published ? await listSlots(published.id) : [];
  const subjectName = new Map((subjects.data ?? []).map((s) => [s.id, s.name_en || s.code]));

  const classTeacherOf = new Map<string, string[]>();
  const classRank = new Map<string, number>();
  // classLabelMap iterates in the school's class order.
  const order = new Map([...labels.keys()].map((id, i) => [id, i]));
  for (const row of classTeacherRows.data ?? []) {
    if (row.effective_from > today || (row.effective_to && row.effective_to < today)) continue;
    const label = labels.get(row.class_id) ?? "Class";
    classTeacherOf.set(row.staff_profile_id, [...(classTeacherOf.get(row.staff_profile_id) ?? []), label]);
    const rank = order.get(row.class_id);
    if (rank !== undefined) classRank.set(row.staff_profile_id, Math.min(rank, classRank.get(row.staff_profile_id) ?? rank));
  }

  // What each person teaches and how many periods a weekday, from the live timetable.
  const teaches = new Map<string, Map<string, Set<string>>>();
  const load: Record<string, number[]> = {};
  const seen = new Set<string>();
  for (const slot of slots) {
    const key = `${slot.staffProfileId}|${slot.day}|${slot.period}`;
    const dayIndex = WEEK.indexOf(slot.day);
    if (!seen.has(key) && dayIndex >= 0) {
      seen.add(key);
      (load[slot.staffProfileId] ??= [0, 0, 0, 0, 0, 0])[dayIndex] += 1;
    }
    const byClass = teaches.get(slot.staffProfileId) ?? new Map<string, Set<string>>();
    const label = labels.get(slot.classId) ?? slot.classLabel;
    byClass.set(label, (byClass.get(label) ?? new Set()).add(subjectName.get(slot.subjectId) ?? slot.subjectCode));
    teaches.set(slot.staffProfileId, byClass);
  }

  const rows: StaffRow[] = people.map((person) => {
    const auth = person.userId ? users.get(person.userId) : undefined;
    const byClass = teaches.get(person.id);
    return {
      id: person.id,
      name: person.displayName,
      shortName: person.shortName,
      role: person.role,
      phone: person.whatsappPhone ?? person.phone,
      isTeaching: person.isTeaching,
      isActive: person.isActive,
      hasLogin: Boolean(person.userId),
      email: auth?.email ?? null,
      lastSignInAt: auth?.lastSignInAt ?? null,
      joinedAt: person.createdAt,
      classTeacherOf: classTeacherOf.get(person.id) ?? [],
      teaches: byClass ? [...byClass.entries()].map(([cls, subs]) => `${cls} · ${[...subs].join(", ")}`) : [],
      periodsPerWeek: (load[person.id] ?? []).reduce((a, b) => a + b, 0),
      classRank: classRank.get(person.id) ?? null,
    };
  });

  const roleCounts = Object.fromEntries(staffRoles.map((role) => [role, 0])) as Record<StaffRole, number>;
  for (const row of rows) if (row.isActive) roleCounts[row.role] += 1;

  const nameOf = new Map(rows.map((r) => [r.id, r.name]));
  const events: StaffEvent[] = (authorityRows.data ?? []).map((row) => ({
    id: row.id,
    staffId: row.staff_profile_id,
    at: row.changed_at,
    actor: row.actor_staff_id ? (nameOf.get(row.actor_staff_id) ?? null) : null,
    kind: row.from_active !== row.to_active ? (row.to_active ? "enabled" : "disabled") : "role",
    text:
      row.from_active !== row.to_active
        ? row.to_active
          ? p("Login turned back on", "लॉगिन फिर चालू")
          : p(`Login disabled${row.reason ? ` · ${row.reason}` : ""}`, `लॉगिन बंद${row.reason ? ` · ${row.reason}` : ""}`)
        : p(
            `Role changed: ${row.from_role.replace(/_/g, " ")} → ${row.to_role.replace(/_/g, " ")}`,
            `भूमिका बदली: ${row.from_role.replace(/_/g, " ")} → ${row.to_role.replace(/_/g, " ")}`,
          ),
  }));

  return {
    sessionLabel,
    rows,
    load,
    matrix: matrixFromRows(matrixRows.data ?? []),
    roleCounts,
    events,
    mayManage: can(me, "staff:manage"),
    isAdmin: me.role === "admin",
    mayEditMatrix: me.role === "admin" && can(me, "settings:manage"),
    meId: me.id,
  };
}
