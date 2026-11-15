import "server-only";

import type { ChatViewer } from "@/modules/chats/domain/access";
import type { ChatDesk } from "@/modules/chats/domain/types";
import { hasConsent } from "@/modules/staff-notices/domain/gates";
import { staffLanguage, type StaffLanguage } from "@/modules/whatsapp/domain/helper-handoff";
import { getCurrentStaff, type CurrentStaff } from "@/platform/auth/current-staff";
import { can, isStaffRole } from "@/platform/auth/permissions";
import { viewingTestSession } from "@/platform/auth/staff-scope";
import { staffBelongsToSession } from "@/platform/auth/test-session-policy";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { toE164 } from "@/platform/whatsapp/numbers";
import { whatsappDb } from "@/platform/whatsapp/store";

import { ChatStoreError, isUuid } from "./store";

/**
 * The people behind the chats (D-616): who a reader is to the chats, who is
 * on each desk (for the WhatsApp nudge), and the names the screens show.
 */

type Db = ReturnType<typeof whatsappDb>;

/** A reader as the desk rules need them. `viewingTest`: they are looking at the test year, so they see practice chats. */
export function viewerFor(staff: CurrentStaff, viewingTest: boolean): ChatViewer {
  return {
    staffId: staff.id,
    role: staff.role,
    replies: can(staff, "chats:reply"),
    seesAll: can(staff, "chats:all"),
    feesDesk: can(staff, "fees:collect"),
    viewingTest,
  };
}

/**
 * The signed-in person as the chats see them, for a screen, a file or an
 * action; null when nobody is signed in or Chats are not theirs at all.
 */
export async function currentChatViewer(): Promise<{ staff: CurrentStaff; viewer: ChatViewer } | null> {
  const staff = await getCurrentStaff().catch(() => null);
  if (!staff) return null;
  const viewer = viewerFor(staff, await viewingTestSession().catch(() => false));
  return viewer.replies || viewer.seesAll ? { staff, viewer } : null;
}

/** A member of staff who may be told on WhatsApp that parents are waiting. */
export type DeskPerson = {
  staffId: string;
  name: string;
  role: string;
  /** Their WhatsApp number, or null when One has none. */
  e164: string | null;
  /** They said yes to WhatsApp from the school app and have not stopped it (D-583). */
  consented: boolean;
  language: StaffLanguage;
};

type StaffRow = {
  id: string;
  display_name: string | null;
  short_name: string | null;
  role: string;
  phone: string | null;
  whatsapp_phone: string | null;
  preferred_language: string | null;
  is_active: boolean;
  is_test_account: boolean | null;
  whatsapp_opt_in_at: string | null;
  whatsapp_opt_out_at: string | null;
  created_at: string;
};

const STAFF_COLUMNS =
  "id, display_name, short_name, role, phone, whatsapp_phone, preferred_language, is_active, is_test_account, whatsapp_opt_in_at, whatsapp_opt_out_at, created_at";

function personFrom(row: StaffRow): DeskPerson {
  return {
    staffId: row.id,
    name: (row.display_name ?? row.short_name ?? "").trim().slice(0, 80) || "-",
    role: row.role,
    e164: toE164(row.whatsapp_phone ?? "") ?? toE164(row.phone ?? ""),
    consented: hasConsent({ optInAt: row.whatsapp_opt_in_at, optOutAt: row.whatsapp_opt_out_at }) === "yes",
    language: staffLanguage(row.preferred_language),
  };
}

/** The roles that hold every one of these permissions in Staff -> Roles now (the admin always does). */
async function rolesWith(permissions: readonly string[], db: Db): Promise<string[]> {
  const { data, error } = await db
    .from("role_permissions")
    .select("role, permission")
    .in("permission", [...permissions])
    .returns<Array<{ role: string; permission: string }>>();
  if (error || !data) throw new ChatStoreError("read the roles");
  const held = new Map<string, Set<string>>();
  for (const row of data) {
    const set = held.get(row.role) ?? new Set<string>();
    set.add(row.permission);
    held.set(row.role, set);
  }
  return [...held.entries()].filter(([role, set]) => role !== "admin" && permissions.every((p) => set.has(p))).map(([role]) => role);
}

async function activeIn(roles: readonly string[], sessionLabel: string, db: Db): Promise<DeskPerson[]> {
  if (roles.length === 0) return [];
  const { data, error } = await db
    .from("staff_profiles")
    .select(STAFF_COLUMNS)
    .in("role", [...roles])
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(60)
    .returns<StaffRow[]>();
  if (error || !data) throw new ChatStoreError("read the staff");
  return data.filter((row) => staffBelongsToSession(row.is_test_account, sessionLabel)).map(personFrom);
}

/** The most people one desk's nudge goes to. */
const MAX_DESK_PEOPLE = 3;

/**
 * Who answers a chat on its desk, for the WhatsApp nudge, oldest account
 * first and at most three, of the chat's own kind (test accounts for a
 * practice chat, real staff for a real one: the owner's rule, 8 Nov 2026):
 *
 *  - class: the class teacher;
 *  - accounts: the roles at the fee desk (`fees:collect` and `chats:reply`);
 *  - admin: the office (`chats:reply`), or the admins when the parent asked
 *    for the principal;
 *  - passed up, or a desk with nobody on it: the admins.
 */
export async function readDeskPeople(
  input: { desk: ChatDesk; classTeacherId: string | null; wantsAdmin: boolean; sessionLabel: string; admins: boolean },
  db: Db = whatsappDb(),
): Promise<DeskPerson[]> {
  const admins = () => activeIn(["admin"], input.sessionLabel, db).then((people) => people.slice(0, MAX_DESK_PEOPLE));
  if (input.admins || (input.desk === "admin" && input.wantsAdmin)) return admins();
  if (input.desk === "class") {
    if (!input.classTeacherId || !isUuid(input.classTeacherId)) return [];
    const { data, error } = await db.from("staff_profiles").select(STAFF_COLUMNS).eq("id", input.classTeacherId).maybeSingle<StaffRow>();
    if (error) throw new ChatStoreError("read the class teacher");
    if (!data || !data.is_active || !staffBelongsToSession(data.is_test_account, input.sessionLabel)) return [];
    return [personFrom(data)];
  }
  const roles =
    input.desk === "accounts"
      ? await rolesWith(["fees:collect", "chats:reply"], db)
      : (await rolesWith(["chats:reply"], db)).filter((role) => role === "office");
  // The accountant before the fee collector, then whoever else holds the desk.
  const order = ["accountant", "fee_collector", "office"];
  const people = (await activeIn(roles, input.sessionLabel, db)).sort(
    (a, b) => (order.indexOf(a.role) + 1 || 9) - (order.indexOf(b.role) + 1 || 9),
  );
  return people.length > 0 ? people.slice(0, MAX_DESK_PEOPLE) : admins();
}

/**
 * What each of these roles may do in Staff -> Roles now, as the permission
 * check reads it: the rows for the chats' own three permissions. The admin's
 * row is never read, since an admin may do everything.
 */
export async function readRolePermissions(roles: readonly string[], db: Db = whatsappDb()): Promise<Map<string, string[]>> {
  const wanted = [...new Set(roles)].filter((role) => role !== "admin" && /^[a-z_]{2,40}$/.test(role));
  const held = new Map<string, string[]>();
  if (wanted.length === 0) return held;
  const { data, error } = await db
    .from("role_permissions")
    .select("role, permission")
    .in("role", wanted)
    .in("permission", ["chats:reply", "chats:all", "fees:collect"])
    .returns<Array<{ role: string; permission: string }>>();
  if (error || !data) throw new ChatStoreError("read the roles");
  for (const row of data) held.set(row.role, [...(held.get(row.role) ?? []), row.permission]);
  return held;
}

/** A desk person as the desk rules read them, with their role's permissions (`readRolePermissions`). */
export function viewerOfPerson(person: Pick<DeskPerson, "staffId" | "role">, permissions: ReadonlyMap<string, readonly string[]>, viewingTest: boolean): ChatViewer {
  const subject = isStaffRole(person.role) ? { role: person.role, permissions: permissions.get(person.role) ?? [] } : null;
  return {
    staffId: person.staffId,
    role: person.role,
    replies: can(subject, "chats:reply"),
    seesAll: can(subject, "chats:all"),
    feesDesk: can(subject, "fees:collect"),
    viewingTest,
  };
}

/** One member of staff as a desk person (the one who replied, for the chat's own records). */
export async function readDeskPerson(staffId: string, db: Db = whatsappDb()): Promise<DeskPerson | null> {
  if (!isUuid(staffId)) return null;
  const { data, error } = await db.from("staff_profiles").select(STAFF_COLUMNS).eq("id", staffId).maybeSingle<StaffRow>();
  if (error) throw new ChatStoreError("read the staff member");
  return data ? personFrom(data) : null;
}

/** Staff names by id, for the teacher chips and "taken over by". */
export async function readStaffNames(ids: readonly string[], db: Db = whatsappDb()): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)].filter(isUuid);
  const names = new Map<string, string>();
  if (wanted.length === 0) return names;
  const { data, error } = await fetchInChunks<{ id: string; display_name: string | null; short_name: string | null }>(
    wanted,
    IN_FILTER_CHUNK_SIZE,
    (chunk) => db.from("staff_profiles").select("id, display_name, short_name").in("id", chunk),
  );
  if (error) throw new ChatStoreError("read the staff names");
  for (const row of data) names.set(row.id, (row.display_name ?? row.short_name ?? "").trim() || "—");
  return names;
}
