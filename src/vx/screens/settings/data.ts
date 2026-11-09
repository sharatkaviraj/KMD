import "server-only";

import { readParentSwitches } from "./parent-switches";
import type { ParentSwitches } from "./domain/parent-switches";
import { requirePermission } from "@/platform/auth/current-staff";
import { roleLabel, staffRoles } from "@/platform/auth/permissions";
import { FEE_SCHEMA, getOptionalEnvVar, getSchoolName } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { classLabelMap, listSessionLabels, listSubjects, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listArchives, type ArchiveSummary } from "@/modules/archives/data/archive-repo";
import { parentDispatchSwitch } from "@/modules/collection/data/parent-messages-repo";
import { lastRunPerJob } from "@/modules/jobs/data/jobs-repo";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { taskDeliveryAvailability } from "@/modules/collection/data/message-provider";
import { readWhatsAppConfig } from "@/platform/whatsapp/config";
import { SCHOOL_WHATSAPP_NUMBER } from "@/platform/whatsapp/numbers";
import { readSwitches } from "@/platform/whatsapp/store";

import {
  areaForTable,
  auditPhrase,
  coverPhrase,
  cleanProfile,
  diffRows,
  EMPTY_PROFILE,
  type ActivityEvent,
  type BackupDay,
  type SchoolProfile,
} from "./domain/settings";

/*
 * Everything the Settings screen reads. Admin only (`settings:manage`).
 * The fee app's audit log and activity events are read, never written; the
 * profile and per-person preferences live in `vppsone`.
 */

export type MasterData = {
  classes: { id: string; label: string; students: number; classTeacher: string | null }[];
  subjects: { id: string; code: string; name: string; active: boolean }[];
  houses: { name: string; students: number }[];
  paymentModes: { mode: string; receipts: number }[];
  holidays: { day: string; label: string }[];
};

export type Integration = { key: string; name: string; sub: string; status: "on" | "off" | "partial" | "pending"; facts: [string, string][]; href?: string; settingsHref?: string; taskDelivery?: "ready" | "unavailable" | "test_mode"; localContracts?: number };

export type SettingsData = {
  profile: SchoolProfile;
  profileChangedAt: string | null;
  profileChangedBy: string | null;
  prefs: { largeText: boolean; alerts: Record<string, boolean> };
  sessionLabel: string | null;
  sessions: string[];
  staffCount: number;
  /** Every staff profile, active or not — the number the Staff list shows (B17). */
  staffTotal?: number;
  roleCount: number;
  activity: ActivityEvent[];
  backups: BackupDay[];
  archives: ArchiveSummary[];
  jobs: { job: string; status: string; at: string | null }[];
  master: MasterData;
  integrations: Integration[];
  /** The reader, for the phone top bar ("Name · Admin"). */
  me: { name: string; role: { en: string; hi: string } };
  /** What One may queue for parents (Settings → Parent messages). */
  parentSwitches?: ParentSwitches;
};

const BACKUP_BUCKET = "nightly-backups";

/** The nightly copies the fee cron writes, one folder a day (YYYY-MM-DD). */
async function nightlyBackups(): Promise<BackupDay[]> {
  const storage = createAdminClient().storage.from(BACKUP_BUCKET);
  const { data: folders, error } = await storage.list("", { limit: 60, sortBy: { column: "name", order: "desc" } });
  if (error || !folders) return [];
  const days = folders.map((f) => f.name).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).slice(0, 14);
  const out = await Promise.all(
    days.map(async (day) => {
      const { data } = await storage.list(day, { limit: 100 });
      const files = (data ?? []).filter((f) => f.id);
      const bytes = files.reduce((n, f) => n + Number((f.metadata as { size?: number } | null)?.size ?? 0), 0);
      return { day, files: files.length, bytes };
    }),
  );
  return out;
}

async function readActivity(nameByUser: Map<string, string>, nameByStaff: Map<string, string>): Promise<ActivityEvent[]> {
  const admin = createAdminClient();
  const fee = admin.schema(FEE_SCHEMA);
  const [audit, events, users, authority, matrix, settings, marks, registers, cover, notices] = await Promise.all([
    fee
      .from("audit_logs")
      .select("id, table_name, action, before_data, after_data, changed_by, created_at")
      .order("created_at", { ascending: false })
      .limit(200)
      .returns<{ id: string; table_name: string; action: string; before_data: unknown; after_data: unknown; changed_by: string | null; created_at: string }[]>(),
    fee
      .from("user_activity_events")
      .select("id, user_id, kind, created_at")
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<{ id: string; user_id: string | null; kind: string; created_at: string }[]>(),
    fee.from("users").select("id, full_name").returns<{ id: string; full_name: string | null }[]>(),
    admin
      .from("staff_authority_changes")
      .select("id, staff_profile_id, actor_staff_id, from_role, to_role, from_active, to_active, reason, changed_at")
      .order("changed_at", { ascending: false })
      .limit(100)
      .returns<{ id: string; staff_profile_id: string; actor_staff_id: string | null; from_role: string; to_role: string; from_active: boolean; to_active: boolean; reason: string | null; changed_at: string }[]>(),
    admin
      .from("role_permission_changes")
      .select("id, actor_staff_id, role, permission, granted, reason, changed_at")
      .order("changed_at", { ascending: false })
      .limit(100)
      .returns<{ id: string; actor_staff_id: string; role: string; permission: string; granted: boolean; reason: string | null; changed_at: string }[]>(),
    admin
      .from("school_settings_history")
      .select("id, key, before, after, changed_by, changed_at")
      .order("changed_at", { ascending: false })
      .limit(50)
      .returns<{ id: string; key: string; before: unknown; after: unknown; changed_by: string | null; changed_at: string }[]>(),
    admin
      .from("marks_change_log")
      .select("id, from_value, to_value, from_absent, to_absent, reason, changed_by, changed_at")
      .order("changed_at", { ascending: false })
      .limit(100)
      .returns<{ id: string; from_value: number | null; to_value: number | null; from_absent: boolean | null; to_absent: boolean | null; reason: string | null; changed_by: string | null; changed_at: string }[]>(),
    admin
      .from("attendance_register_revisions")
      .select("id, revision, kind, actor_staff_id, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<{ id: string; revision: number; kind: string; actor_staff_id: string | null; reason: string | null; created_at: string }[]>(),
    // Absences and cover, and notices, were missing from the log (school-day run, admin B17).
    admin
      .from("cover_commands")
      .select("id, kind, day, actor_staff_id, created_at")
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<{ id: string; kind: string; day: string; actor_staff_id: string | null; created_at: string }[]>(),
    admin
      .from("message_campaigns")
      .select("id, title, audience, audience_label, recipient_count, created_by, created_at")
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<{ id: string; title: string; audience: string; audience_label: string | null; recipient_count: number; created_by: string | null; created_at: string }[]>(),
  ]);

  for (const u of users.data ?? []) if (u.full_name && !nameByUser.has(u.id)) nameByUser.set(u.id, u.full_name);
  const byUser = (id: string | null) => (id ? (nameByUser.get(id) ?? "Fee app user") : "System");
  const byStaff = (id: string | null) => (id ? (nameByStaff.get(id) ?? "Staff") : "System");

  const out: ActivityEvent[] = [];
  for (const row of audit.data ?? []) {
    out.push({ id: `a-${row.id}`, at: row.created_at, who: byUser(row.changed_by), area: areaForTable(row.table_name), text: auditPhrase(row.table_name, row.action), changes: row.action === "insert" ? [] : diffRows(row.before_data, row.after_data) });
  }
  for (const row of events.data ?? []) {
    const signin = /login|sign/i.test(row.kind);
    out.push({ id: `e-${row.id}`, at: row.created_at, who: byUser(row.user_id), area: signin ? "signin" : row.kind.startsWith("payment") ? "money" : "students", text: row.kind.replace(/_/g, " "), changes: [] });
  }
  for (const row of authority.data ?? []) {
    out.push({
      id: `s-${row.id}`,
      at: row.changed_at,
      who: byStaff(row.actor_staff_id),
      area: "staff",
      text: row.from_active !== row.to_active ? `${row.to_active ? "turned on" : "turned off"} ${byStaff(row.staff_profile_id)}'s login${row.reason ? ` · ${row.reason}` : ""}` : `changed ${byStaff(row.staff_profile_id)}'s role`,
      changes: row.from_role !== row.to_role ? [{ field: "role", before: row.from_role.replace(/_/g, " "), after: row.to_role.replace(/_/g, " ") }] : [],
    });
  }
  for (const row of matrix.data ?? []) {
    out.push({ id: `r-${row.id}`, at: row.changed_at, who: byStaff(row.actor_staff_id), area: "settings", text: `${row.granted ? "allowed" : "took away"} ${row.permission} for ${row.role.replace(/_/g, " ")}`, changes: [{ field: row.permission, before: row.granted ? "off" : "on", after: row.granted ? "on" : "off" }] });
  }
  for (const row of settings.data ?? []) {
    out.push({ id: `p-${row.id}`, at: row.changed_at, who: byStaff(row.changed_by), area: "settings", text: `changed the ${row.key.replace(/_/g, " ")}`, changes: diffRows(row.before, row.after).filter((c) => c.field !== "logo" && c.field !== "signature") });
  }
  for (const row of marks.data ?? []) {
    const v = (value: number | null, absent: boolean | null) => (absent ? "absent" : value === null ? "—" : String(value));
    out.push({ id: `m-${row.id}`, at: row.changed_at, who: byStaff(row.changed_by), area: "marks", text: `corrected a mark${row.reason ? ` · ${row.reason}` : ""}`, changes: [{ field: "mark", before: v(row.from_value, row.from_absent), after: v(row.to_value, row.to_absent) }] });
  }
  for (const row of registers.data ?? []) {
    out.push({ id: `t-${row.id}`, at: row.created_at, who: byStaff(row.actor_staff_id), area: "attendance", text: `${row.revision > 1 ? "corrected" : "took"} attendance${row.reason ? ` · ${row.reason}` : ""}`, changes: [] });
  }
  for (const row of cover.data ?? []) {
    out.push({ id: `c-${row.id}`, at: row.created_at, who: byStaff(row.actor_staff_id), area: "staff", text: coverPhrase(row.kind, row.day), changes: [] });
  }
  for (const row of notices.data ?? []) {
    out.push({ id: `n-${row.id}`, at: row.created_at, who: byStaff(row.created_by), area: row.audience === "staff" ? "staff" : "students", text: `queued a notice · ${row.title} · ${row.audience_label ?? row.audience} · ${row.recipient_count}`, changes: [] });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 400);
}

async function readMaster(sessionLabel: string | null, staffNames: Map<string, string>): Promise<MasterData> {
  const admin = createAdminClient();
  const fee = admin.schema(FEE_SCHEMA);
  const labels = sessionLabel ? await classLabelMap(sessionLabel) : new Map<string, string>();
  const classIds = [...labels.keys()];
  const [students, subjects, receipts, holidays, teachers] = await Promise.all([
    classIds.length
      ? fee.from("students").select("class_id, house").eq("status", "active").in("class_id", classIds).limit(5000).returns<{ class_id: string; house: string | null }[]>()
      : Promise.resolve({ data: [] as { class_id: string; house: string | null }[] }),
    listSubjects(),
    fee.from("receipts").select("payment_mode").limit(20000).returns<{ payment_mode: string | null }[]>(),
    fee.from("school_holidays").select("holiday_date, label").order("holiday_date", { ascending: false }).limit(60).returns<{ holiday_date: string; label: string | null }[]>(),
    sessionLabel
      ? admin.from("class_teachers").select("class_id, staff_profile_id, effective_to").eq("session_label", sessionLabel).is("effective_to", null).returns<{ class_id: string; staff_profile_id: string; effective_to: string | null }[]>()
      : Promise.resolve({ data: [] as { class_id: string; staff_profile_id: string; effective_to: string | null }[] }),
  ]);
  const perClass = new Map<string, number>();
  const perHouse = new Map<string, number>();
  for (const s of students.data ?? []) {
    perClass.set(s.class_id, (perClass.get(s.class_id) ?? 0) + 1);
    if (s.house) perHouse.set(s.house, (perHouse.get(s.house) ?? 0) + 1);
  }
  const perMode = new Map<string, number>();
  for (const r of receipts.data ?? []) {
    const mode = r.payment_mode ?? "unknown";
    perMode.set(mode, (perMode.get(mode) ?? 0) + 1);
  }
  const teacherOf = new Map((teachers.data ?? []).map((t) => [t.class_id, staffNames.get(t.staff_profile_id) ?? null]));
  return {
    classes: [...labels.entries()].map(([id, label]) => ({ id, label, students: perClass.get(id) ?? 0, classTeacher: teacherOf.get(id) ?? null })),
    subjects: subjects.map((s) => ({ id: s.id, code: s.code, name: s.nameEn, active: s.isActive })),
    houses: [...perHouse.entries()].map(([name, n]) => ({ name, students: n })).sort((a, b) => a.name.localeCompare(b.name)),
    paymentModes: [...perMode.entries()].map(([mode, n]) => ({ mode, receipts: n })).sort((a, b) => b.receipts - a.receipts),
    holidays: (holidays.data ?? []).map((h) => ({ day: h.holiday_date, label: h.label ?? "Holiday" })),
  };
}

export async function loadSettingsScreen(): Promise<SettingsData> {
  const me = await requirePermission("settings:manage", "/settings");
  const admin = createAdminClient();
  const sessionLabel = await resolveSessionLabel();
  const staff = await listStaff();
  const nameByStaff = new Map(staff.map((s) => [s.id, s.displayName]));
  const nameByUser = new Map(staff.filter((s) => s.userId).map((s) => [s.userId as string, s.displayName]));

  const [profileRow, prefsRow, sessions, activity, backups, archives, jobs, master, dispatchOn, templates, links, parentSwitches, whatsappSwitches] = await Promise.all([
    admin.from("school_settings").select("value, updated_by, updated_at").eq("key", "profile").maybeSingle<{ value: unknown; updated_by: string | null; updated_at: string }>(),
    admin.from("staff_ui_preferences").select("large_text, alerts").eq("staff_profile_id", me.id).maybeSingle<{ large_text: boolean; alerts: Record<string, boolean> | null }>(),
    listSessionLabels().catch(() => [] as string[]),
    readActivity(nameByUser, nameByStaff).catch(() => [] as ActivityEvent[]),
    nightlyBackups().catch(() => [] as BackupDay[]),
    listArchives().catch(() => [] as ArchiveSummary[]),
    lastRunPerJob().catch(() => new Map()),
    readMaster(sessionLabel, nameByStaff).catch(() => ({ classes: [], subjects: [], houses: [], paymentModes: [], holidays: [] }) as MasterData),
    parentDispatchSwitch().catch(() => false),
    admin.from("message_templates").select("is_active").returns<{ is_active: boolean }[]>(),
    admin.from("collection_requests").select("id", { count: "exact", head: true }),
    readParentSwitches(),
    readSwitches().catch(() => null),
  ]);

  const fallback: SchoolProfile = {
    ...EMPTY_PROFILE,
    nameEn: getSchoolName(),
    address: getOptionalEnvVar("NEXT_PUBLIC_SCHOOL_ADDRESS") ?? "",
    phone: getOptionalEnvVar("NEXT_PUBLIC_SCHOOL_PHONE") ?? "",
  };
  const profile = profileRow.data ? cleanProfile(profileRow.data.value, fallback) : fallback;
  const localContracts = (templates.data ?? []).filter((t) => t.is_active).length;
  const taskDelivery = taskDeliveryAvailability();
  const lastBackup = backups[0];

  const integrations: Integration[] = [
    {
      key: "whatsapp",
      name: "School WhatsApp",
      sub: "Messages and receipts to parents",
      status: taskDelivery === "ready" ? "on" : "pending",
      taskDelivery,
      localContracts,
      facts: [
        ["Number", `+91 ${SCHOOL_WHATSAPP_NUMBER.slice(3, 8)} ${SCHOOL_WHATSAPP_NUMBER.slice(8)}`],
        ["Connection", readWhatsAppConfig().ok ? "Connected" : "Not connected yet"],
        ["Practice mode", whatsappSwitches === null ? "Unknown" : whatsappSwitches.dryRun ? "On · nothing leaves the school" : "Off"],
        ["Parent sending", dispatchOn ? "On" : "Off · messages wait in the queue"],
      ],
      href: "/inbox?tasks=all",
      settingsHref: "/settings/whatsapp",
    },
    {
      key: "sampark",
      name: "Sampark links",
      sub: "Collection and marks without a login",
      status: (links.count ?? 0) > 0 ? "on" : "partial",
      facts: [["Links made", String(links.count ?? 0)]],
      href: "/collection",
    },
    {
      key: "backups",
      name: "Nightly backup",
      sub: "Fee records copied every night",
      status: getOptionalEnvVar("CRON_SECRET") ? (lastBackup ? "on" : "partial") : "off",
      facts: [
        ["Schedule", getOptionalEnvVar("CRON_SECRET") ? "Every night" : "Cron secret not set"],
        ["Last copy", lastBackup ? lastBackup.day : "None yet"],
      ],
      href: "/settings?s=backups",
    },
    {
      key: "jobs",
      name: "Scheduled jobs",
      sub: "Registers, reminders and summaries",
      status: getOptionalEnvVar("JOBS_SECRET") || getOptionalEnvVar("CRON_SECRET") ? "on" : "off",
      facts: [...jobs.values()].slice(0, 3).map((r) => [r.job.replace(/_/g, " "), `${r.status} · ${r.startedAt.slice(0, 10)}`] as [string, string]),
      href: "/jobs",
    },
  ];

  return {
    profile,
    profileChangedAt: profileRow.data?.updated_at ?? null,
    profileChangedBy: profileRow.data?.updated_by ? (nameByStaff.get(profileRow.data.updated_by) ?? null) : null,
    prefs: { largeText: prefsRow.data?.large_text ?? false, alerts: prefsRow.data?.alerts ?? {} },
    sessionLabel,
    sessions,
    staffCount: staff.filter((s) => s.isActive).length,
    staffTotal: staff.length,
    roleCount: staffRoles.length,
    activity,
    backups,
    archives,
    jobs: [...jobs.values()].map((r) => ({ job: r.job, status: r.status, at: r.startedAt })),
    master,
    integrations,
    me: { name: me.displayName, role: roleLabel(me.role) },
    parentSwitches,
  };
}
