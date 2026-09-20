import "server-only";

import { fetchAllPages } from "@/platform/helpers/chunk";
import { createClient } from "@/modules/fees/platform/supabase/server";

type AuditLogRow = {
  id: string;
  table_name: string;
  record_id: string;
  action: "insert" | "update" | "delete";
  before_data: unknown;
  after_data: unknown;
  changed_by: string | null;
  created_at: string;
};

export type FeePolicySnapshot = {
  recordId: string;
  capturedAt: string;
  data: Record<string, unknown>;
};

export type FeeSettingSnapshot = {
  recordId: string;
  capturedAt: string;
  classId: string | null;
  data: Record<string, unknown>;
};

export type StudentOverrideSnapshot = {
  recordId: string;
  capturedAt: string;
  studentId: string | null;
  data: Record<string, unknown>;
};

export type FeeSetupTimeTravelSnapshot = {
  asOf: string;
  policy: FeePolicySnapshot | null;
  feeSettings: FeeSettingSnapshot[];
  studentOverrides: StudentOverrideSnapshot[];
  policyHistoryCount: number;
  feeSettingHistoryCount: number;
  overrideHistoryCount: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Every audit row for one table at or before `asOfIso`, newest first.
 *
 * **Paged, and it has to be.** This asked for `.limit(4000)` in one request,
 * which PostgREST silently answered with 1000 — its `db-max-rows` — and the
 * snapshot was built from whatever those 1000 rows happened to cover.
 *
 * `latestStateByRecord` keeps the first row it sees per `record_id`, so a
 * record whose most recent change falls outside the newest 1000 rows is not
 * merely stale in the snapshot, it is ABSENT: no policy, no fee setting, no
 * override. On the live project `student_fee_overrides` carries 2,028 audit
 * rows over 520 records, and the truncated read reached only 483 of them — 37
 * students' overrides simply did not exist in any snapshot the screen drew.
 *
 * A "what did the fee policy look like on this date" answer that quietly omits
 * 37 students is worse than no answer, because nothing about it looks wrong.
 *
 * Ordered by `created_at` AND `id`: `created_at` alone ties whenever a single
 * write touches several rows — which is exactly what a Fee Setup publish does —
 * and a tie is where `.range()` pages repeat or skip rows.
 */
async function loadAuditTrailUpTo(
  tableName: string,
  asOfIso: string,
): Promise<AuditLogRow[]> {
  const supabase = await createClient();
  const { data, error } = await fetchAllPages<AuditLogRow>((from, to) =>
    supabase
      .from("audit_logs")
      .select("id, table_name, record_id, action, before_data, after_data, changed_by, created_at")
      .eq("table_name", tableName)
      .lte("created_at", asOfIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );

  if (error) {
    throw new Error(
      `Unable to load audit history for ${tableName}: ${
        (error as { message?: string })?.message ?? String(error)
      }`,
    );
  }

  return data;
}

function latestStateByRecord(
  rows: readonly AuditLogRow[],
): Map<string, AuditLogRow> {
  const seen = new Map<string, AuditLogRow>();

  for (const row of rows) {
    if (seen.has(row.record_id)) continue;
    seen.set(row.record_id, row);
  }

  return seen;
}

export async function getFeeSetupSnapshotAt(
  asOf: string,
): Promise<FeeSetupTimeTravelSnapshot> {
  const isoMatch = /^\d{4}-\d{2}-\d{2}$/.test(asOf)
    ? `${asOf}T23:59:59Z`
    : asOf;

  const [policyRows, feeSettingRows, overrideRows] = await Promise.all([
    loadAuditTrailUpTo("fee_policy_configs", isoMatch),
    loadAuditTrailUpTo("fee_settings", isoMatch),
    loadAuditTrailUpTo("student_fee_overrides", isoMatch),
  ]);

  const latestPolicies = latestStateByRecord(policyRows);
  const policyEntries = [...latestPolicies.values()].filter(
    (entry) => entry.action !== "delete",
  );

  const activePolicy = policyEntries
    .map((entry) => ({
      entry,
      data: asRecord(entry.after_data),
    }))
    .filter((item): item is { entry: AuditLogRow; data: Record<string, unknown> } => Boolean(item.data))
    .find((item) => item.data.is_active === true || item.data.is_active === undefined);

  const policySnapshot: FeePolicySnapshot | null = activePolicy
    ? {
        recordId: activePolicy.entry.record_id,
        capturedAt: activePolicy.entry.created_at,
        data: activePolicy.data,
      }
    : null;

  const latestFeeSettings = latestStateByRecord(feeSettingRows);
  const feeSettings: FeeSettingSnapshot[] = [...latestFeeSettings.values()]
    .filter((entry) => entry.action !== "delete")
    .map((entry) => {
      const data = asRecord(entry.after_data);
      if (!data) return null;
      const isActive = data.is_active === undefined ? true : data.is_active === true;
      if (!isActive) return null;
      return {
        recordId: entry.record_id,
        capturedAt: entry.created_at,
        classId: asString(data.class_id),
        data,
      };
    })
    .filter((row): row is FeeSettingSnapshot => row !== null);

  const latestOverrides = latestStateByRecord(overrideRows);
  const studentOverrides: StudentOverrideSnapshot[] = [...latestOverrides.values()]
    .filter((entry) => entry.action !== "delete")
    .map((entry) => {
      const data = asRecord(entry.after_data);
      if (!data) return null;
      const isActive = data.is_active === undefined ? true : data.is_active === true;
      if (!isActive) return null;
      return {
        recordId: entry.record_id,
        capturedAt: entry.created_at,
        studentId: asString(data.student_id),
        data,
      };
    })
    .filter((row): row is StudentOverrideSnapshot => row !== null);

  return {
    asOf: isoMatch,
    policy: policySnapshot,
    feeSettings,
    studentOverrides,
    policyHistoryCount: policyRows.length,
    feeSettingHistoryCount: feeSettingRows.length,
    overrideHistoryCount: overrideRows.length,
  };
}

export async function getClassLabelMap(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("classes")
    .select("id, class_name, section, stream_name, session_label");

  if (error) {
    throw new Error(`Unable to load classes for time-travel view: ${error.message}`);
  }

  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{
    id: string;
    class_name: string;
    section: string | null;
    stream_name: string | null;
    session_label: string;
  }>) {
    const labelParts = [row.class_name];
    if (row.section?.trim()) labelParts.push(row.section.trim());
    if (row.stream_name?.trim()) labelParts.push(`(${row.stream_name.trim()})`);
    labelParts.push(`· ${row.session_label}`);
    map.set(row.id, labelParts.join(" "));
  }
  return map;
}
