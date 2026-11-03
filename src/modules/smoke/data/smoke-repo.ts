import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { createAdminClient } from "@/platform/supabase/admin";

import { isSmokeEmail, type SmokeRole } from "../domain/pool";
import { findingKey, passState, runHours, type FindingInput, type FindingRow, type FindingStatus, type PassState, type RunStatus } from "../domain/smoke";

/*
 * The Smoke Lab's reads and writes. Service role only: none of these tables is
 * readable by a browser (RLS on, no policies). Every caller has already checked
 * `smokeLabEnabled()` and, for the admin functions, that the actor is an admin.
 */

export type PoolSeat = { email: string; role: SmokeRole; label: string; linkedExisting: boolean; staffProfileId: string; livePassRun: string | null };

export type RunSummary = {
  id: string;
  title: string;
  scenario: string;
  schoolDay: string | null;
  clockStart: string | null;
  status: RunStatus;
  expiresAt: string;
  createdAt: string;
  passes: { id: string; email: string; label: string; role: SmokeRole; persona: string | null; state: PassState; uses: number; lastUsedAt: string | null }[];
  findings: { total: number; open: number; p1: number };
};

export type ResolvedPass = {
  passId: string;
  runId: string;
  email: string;
  role: SmokeRole;
  label: string;
  persona: string | null;
  staffProfileId: string;
  run: { title: string; scenario: string; schoolDay: string | null; clockStart: string | null; expiresAt: string };
};

/** A pass as handed to an agent: 32 random bytes, URL-safe. Only its hash is stored. */
export function newPassToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPassToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const db = () => createAdminClient();

/**
 * Bring every pool account's ban in line with the passes now live
 * (`vppsone.smoke_enforce`): unbanned while it holds a live pass, banned and
 * its sessions deleted otherwise. pg_cron also runs it every two minutes, which
 * is what enforces expiry; calling it here makes open, close and revoke take
 * effect at once.
 */
async function enforce(): Promise<void> {
  const { error } = await db().rpc("smoke_enforce");
  if (error) throw new Error("Could not apply the run to the test accounts.");
}

export async function listPool(): Promise<PoolSeat[]> {
  const now = new Date().toISOString();
  const [{ data: pool, error }, { data: live, error: liveError }] = await Promise.all([
    db().from("smoke_pool").select("email, role, label, linked_existing, staff_profile_id").order("email").returns<{ email: string; role: SmokeRole; label: string; linked_existing: boolean; staff_profile_id: string }[]>(),
    db().from("smoke_passes").select("pool_email, run_id, smoke_runs!inner(status, expires_at)").is("revoked_at", null).gt("expires_at", now).eq("smoke_runs.status", "open").gt("smoke_runs.expires_at", now).returns<{ pool_email: string; run_id: string }[]>(),
  ]);
  if (error || liveError) throw new Error("Could not read the smoke pool.");
  const liveRun = new Map((live ?? []).map((p) => [p.pool_email, p.run_id]));
  return (pool ?? []).map((p) => ({ email: p.email, role: p.role, label: p.label, linkedExisting: p.linked_existing, staffProfileId: p.staff_profile_id, livePassRun: liveRun.get(p.email) ?? null }));
}

export async function listRuns(limit = 20): Promise<RunSummary[]> {
  const { data: runs, error } = await db()
    .from("smoke_runs")
    .select("id, title, scenario, school_day, clock_start, status, expires_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<{ id: string; title: string; scenario: string; school_day: string | null; clock_start: string | null; status: RunStatus; expires_at: string; created_at: string }[]>();
  if (error) throw new Error("Could not read smoke runs.");
  if (!runs?.length) return [];
  const ids = runs.map((r) => r.id);
  const [{ data: passes, error: pErr }, { data: pool, error: poolErr }, { data: findings, error: fErr }] = await Promise.all([
    db().from("smoke_passes").select("id, run_id, pool_email, persona, expires_at, revoked_at, uses, last_used_at").in("run_id", ids).returns<{ id: string; run_id: string; pool_email: string; persona: string | null; expires_at: string; revoked_at: string | null; uses: number; last_used_at: string | null }[]>(),
    db().from("smoke_pool").select("email, label, role").returns<{ email: string; label: string; role: SmokeRole }[]>(),
    db().rpc("smoke_run_counts", { p_runs: ids }),
  ]);
  if (pErr || poolErr || fErr) throw new Error("Could not read smoke runs.");
  const seat = new Map((pool ?? []).map((p) => [p.email, p]));
  return runs.map((r) => {
    const run = { status: r.status, expiresAt: r.expires_at };
    const counts = ((findings ?? []) as { run_id: string; total: number; open: number; p1: number }[]).find((f) => f.run_id === r.id);
    return {
      id: r.id,
      title: r.title,
      scenario: r.scenario,
      schoolDay: r.school_day,
      clockStart: r.clock_start,
      status: r.status,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      passes: (passes ?? [])
        .filter((p) => p.run_id === r.id)
        .map((p) => ({ id: p.id, email: p.pool_email, label: seat.get(p.pool_email)?.label ?? p.pool_email, role: seat.get(p.pool_email)?.role ?? "view_only", persona: p.persona, state: passState({ revokedAt: p.revoked_at, expiresAt: p.expires_at }, run), uses: p.uses, lastUsedAt: p.last_used_at })),
      findings: { total: counts?.total ?? 0, open: counts?.open ?? 0, p1: counts?.p1 ?? 0 },
    };
  });
}

export type CreatedRun = { runId: string; passes: { email: string; label: string; role: SmokeRole; persona: string | null; token: string }[] };

/**
 * Open a run and issue one pass per chosen seat. A seat already holding a live
 * pass in another open run is refused: one account, one agent, one run.
 * The tokens are returned here once and never again.
 */
export async function createRun(input: { title: string; scenario: "school_day" | "free_explore"; schoolDay: string | null; clockStart: string | null; hours: number; seats: { email: string; persona: string | null }[]; createdBy: string }): Promise<CreatedRun> {
  const emails = [...new Set(input.seats.map((s) => s.email))];
  if (emails.length === 0) throw new Error("Choose at least one account.");
  if (emails.some((e) => !isSmokeEmail(e))) throw new Error("Only smoke accounts can be given a pass.");
  const pool = await listPool();
  const bySeat = new Map(pool.map((p) => [p.email, p]));
  for (const email of emails) {
    const seat = bySeat.get(email);
    if (!seat) throw new Error(`${email} is not in the pool. Run npm run smoke:pool first.`);
    if (seat.livePassRun) throw new Error(`${seat.label} already has a live pass in another run. Close that run first.`);
  }
  const hours = runHours(input.hours);
  // created_at is set here, not by the database, so the 24-hour check
  // (expires_at <= created_at + 24h) compares two times from one clock.
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + hours * 3_600_000 - 60_000).toISOString();
  const { data: run, error } = await db()
    .from("smoke_runs")
    .insert({ title: input.title.trim(), scenario: input.scenario, school_day: input.schoolDay, clock_start: input.clockStart, expires_at: expiresAt, created_by: input.createdBy, created_at: createdAt.toISOString() })
    .select("id")
    .single<{ id: string }>();
  if (error || !run) throw new Error("Could not open the run.");
  const issued = emails.map((email) => ({ email, persona: input.seats.find((s) => s.email === email)?.persona?.trim() || null, token: newPassToken() }));
  const { error: passError } = await db()
    .from("smoke_passes")
    .insert(issued.map((p) => ({ run_id: run.id, pool_email: p.email, persona: p.persona, token_hash: hashPassToken(p.token), expires_at: expiresAt })));
  if (passError) {
    await db().from("smoke_runs").delete().eq("id", run.id);
    throw new Error("Could not issue the passes.");
  }
  // The accounts are banned until now; a pass is no use until this lifts it.
  try {
    await enforce();
  } catch (failure) {
    await db().from("smoke_runs").update({ status: "revoked", closed_at: new Date().toISOString() }).eq("id", run.id);
    await db().from("smoke_passes").update({ revoked_at: new Date().toISOString() }).eq("run_id", run.id);
    throw failure;
  }
  return { runId: run.id, passes: issued.map((p) => ({ ...p, label: bySeat.get(p.email)!.label, role: bySeat.get(p.email)!.role })) };
}

/** End a run: closed (finished) or revoked (stop now). Every pass stops working at once. */
export async function endRun(runId: string, how: "closed" | "revoked", by: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await db().from("smoke_runs").update({ status: how, closed_at: now, closed_by: by }).eq("id", runId).eq("status", "open").select("id").maybeSingle();
  if (error) throw new Error("Could not end the run.");
  if (how === "revoked") {
    const { error: passError } = await db().from("smoke_passes").update({ revoked_at: now }).eq("run_id", runId).is("revoked_at", null);
    if (passError) throw new Error("Could not revoke the run's passes.");
  }
  await enforce();
  return Boolean(data);
}

export async function revokePass(passId: string): Promise<boolean> {
  const { data, error } = await db().from("smoke_passes").update({ revoked_at: new Date().toISOString() }).eq("id", passId).is("revoked_at", null).select("id").maybeSingle();
  if (error) throw new Error("Could not revoke the pass.");
  await enforce();
  return Boolean(data);
}

/**
 * The live pass a token belongs to, or why not. Looked up by the SHA-256 of
 * the token, so the database never sees a pass and an equality match on the
 * hash says nothing useful about any other pass.
 */
export async function resolvePass(token: unknown): Promise<{ ok: true; pass: ResolvedPass } | { ok: false; reason: "invalid" | PassState }> {
  const value = typeof token === "string" ? token.trim() : "";
  if (!TOKEN_SHAPE.test(value)) return { ok: false, reason: "invalid" };
  const hash = hashPassToken(value);
  const { data, error } = await db()
    .from("smoke_passes")
    .select("id, run_id, pool_email, persona, token_hash, expires_at, revoked_at, smoke_runs!inner(title, scenario, school_day, clock_start, status, expires_at), smoke_pool!inner(role, label, staff_profile_id)")
    .eq("token_hash", hash)
    .maybeSingle<{
      id: string; run_id: string; pool_email: string; persona: string | null; token_hash: string; expires_at: string; revoked_at: string | null;
      smoke_runs: { title: string; scenario: string; school_day: string | null; clock_start: string | null; status: RunStatus; expires_at: string };
      smoke_pool: { role: SmokeRole; label: string; staff_profile_id: string };
    }>();
  if (error || !data) return { ok: false, reason: "invalid" };
  const state = passState({ revokedAt: data.revoked_at, expiresAt: data.expires_at }, { status: data.smoke_runs.status, expiresAt: data.smoke_runs.expires_at });
  if (state !== "live") return { ok: false, reason: state };
  return {
    ok: true,
    pass: {
      passId: data.id,
      runId: data.run_id,
      email: data.pool_email,
      role: data.smoke_pool.role,
      label: data.smoke_pool.label,
      persona: data.persona,
      staffProfileId: data.smoke_pool.staff_profile_id,
      run: { title: data.smoke_runs.title, scenario: data.smoke_runs.scenario, schoolDay: data.smoke_runs.school_day, clockStart: data.smoke_runs.clock_start, expiresAt: data.smoke_runs.expires_at },
    },
  };
}

/** Count a use of a pass (sign-in, brief, finding). Best effort. */
export async function touchPass(passId: string): Promise<void> {
  await db().rpc("smoke_touch_pass", { p_pass: passId });
}

/** File a finding from an agent. A repeat of the same problem in the same run raises its count. */
export async function fileFinding(pass: ResolvedPass, input: FindingInput): Promise<{ id: string; repeat: boolean }> {
  const fingerprint = createHash("md5").update(findingKey(pass.role, input)).digest("hex");
  // One statement: a new finding, or the same one again in this run (its
  // repeat count goes up). Two agents filing at once cannot both insert.
  const { data, error } = await db()
    .rpc("smoke_record_finding", {
      p_run: pass.runId,
      p_pass: pass.passId,
      p_role: pass.role,
      p_reporter: input.reporter ?? pass.persona ?? pass.label,
      p_kind: input.kind,
      p_severity: input.severity,
      p_title: input.title,
      p_screen: input.screen ?? null,
      p_steps: input.steps ?? null,
      p_expected: input.expected ?? null,
      p_actual: input.actual ?? null,
      p_evidence: input.evidence ?? null,
      p_fingerprint: fingerprint,
    });
  const row = (data as { id: string; repeat: boolean }[] | null)?.[0];
  if (error || !row) throw new Error("Could not file the finding.");
  return { id: row.id, repeat: row.repeat };
}

type FindingDb = { id: string; kind: string; severity: string; status: string; title: string; role: string | null; reporter: string | null; screen: string | null; steps: string | null; expected: string | null; actual: string | null; evidence: string | null; repeats: number; created_at: string };

const toFinding = (r: FindingDb): FindingRow => ({ id: r.id, kind: r.kind, severity: r.severity, status: r.status, title: r.title, role: r.role, reporter: r.reporter, screen: r.screen, steps: r.steps, expected: r.expected, actual: r.actual, evidence: r.evidence, repeats: r.repeats, createdAt: r.created_at });

export async function listFindings(runId: string): Promise<FindingRow[]> {
  const { data, error } = await db()
    .from("smoke_findings")
    .select("id, kind, severity, status, title, role, reporter, screen, steps, expected, actual, evidence, repeats, created_at")
    .eq("run_id", runId)
    .order("created_at")
    .limit(1000)
    .returns<FindingDb[]>();
  if (error) throw new Error("Could not read findings.");
  return (data ?? []).map(toFinding);
}

export async function runHeader(runId: string): Promise<{ id: string; title: string; schoolDay: string | null } | null> {
  const { data } = await db().from("smoke_runs").select("id, title, school_day").eq("id", runId).maybeSingle<{ id: string; title: string; school_day: string | null }>();
  return data ? { id: data.id, title: data.title, schoolDay: data.school_day } : null;
}

export async function setFindingStatus(findingId: string, status: FindingStatus, note: string | null, by: string): Promise<boolean> {
  const { data, error } = await db().from("smoke_findings").update({ status, triage_note: note, triaged_by: by, triaged_at: new Date().toISOString() }).eq("id", findingId).select("id").maybeSingle();
  if (error) throw new Error("Could not update the finding.");
  return Boolean(data);
}
