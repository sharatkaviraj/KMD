import "server-only";
import { z } from "zod";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertSessionVisible } from "@/platform/auth/test-session-access";
import { createClient } from "@/platform/supabase/server";
import { createAdminClient } from "@/platform/supabase/admin";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import type { ReturnStudent } from "@/modules/government-records/domain/exchange";
import { cycleSchema, verifiedDeadline, type BoardCycle, type Candidate, type Readiness, type OfficialResult } from "../domain/board";

export type BoardWorkspaceData = {
 cycles: BoardCycle[]; cycle: BoardCycle | null; roster: ReturnStudent[] | null; sourceRevision: string | null;
 candidates: Candidate[]; readiness: Readiness[]; results: OfficialResult[];
 history: { id: string; kind: string; actor_id: string; created_at: string; receipt: Record<string, unknown> }[];
};

export async function boardCycles(sessionLabel: string): Promise<BoardCycle[]> {
 const staff = await assertPermission("outcomes:view"); await assertSessionVisible(staff, sessionLabel);
 const { data, error } = await (await createClient()).from("school_board_cycles").select("*").eq("session_label", sessionLabel).order("updated_at", { ascending: false }).limit(101);
 if (error || (data?.length ?? 0) > 100) throw new Error("Board cycles unavailable");
 return (data ?? []).map(row => ({ ...row, config: cycleSchema.parse(row.config) })) as BoardCycle[];
}
export async function boardCycle(id: string): Promise<BoardCycle | null> {
 const staff = await assertPermission("outcomes:view");
 if (!z.uuid().safeParse(id).success) return null;
 const { data, error } = await (await createClient()).from("school_board_cycles").select("*").eq("id", id).maybeSingle();
 if (error) throw new Error("Board cycle unavailable");
 if (!data) return null;
 await assertSessionVisible(staff, data.session_label);
 return { ...data, config: cycleSchema.parse(data.config) } as BoardCycle;
}
export async function boardRecords(cycle: BoardCycle) {
 await assertPermission("outcomes:view");
 // Verify the caller's cycle scope again; an in-memory object is not authority.
 const held = await boardCycle(cycle.id);
 if (!held || held.session_label !== cycle.session_label) throw new Error("Board scope unavailable");
 const db = await createClient();
 async function rows(table: "school_board_candidates" | "school_board_readiness" | "school_official_results") {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; offset < 20000; offset += 500) {
   const query = db.from(table).select("*").eq("cycle_id", held!.id);
   const { data, error } = await (table === "school_official_results" ? query.order("id") : table === "school_board_readiness" ? query.order("student_id").order("key") : query.order("student_id")).range(offset, offset + 499);
   if (error) throw new Error("Board records unavailable");
   out.push(...(data ?? [])); if ((data?.length ?? 0) < 500) return out;
  }
  throw new Error("Board record limit reached");
 }
 const [candidates, readiness, results, history] = await Promise.all([rows("school_board_candidates"), rows("school_board_readiness"), rows("school_official_results"), db.from("school_board_commands").select("id,kind,actor_id,created_at,receipt").eq("cycle_id", held.id).order("created_at", { ascending: false }).limit(30)]);
 if (history.error) throw new Error("Board history unavailable");
 return { candidates: candidates as Candidate[], readiness: readiness as Readiness[], results: results as OfficialResult[], history: history.data ?? [] };
}
export async function boardWorkspace(sessionLabel: string, selected?: string): Promise<BoardWorkspaceData> {
 const [cycles, source] = await Promise.all([boardCycles(sessionLabel), boardSource(sessionLabel).catch(() => null)]);
 const cycle: BoardCycle | null = cycles.find(row => row.id === selected) ?? (cycles.length ? cycles[0] : null);
 const records = cycle ? await boardRecords(cycle) : { candidates: [], readiness: [], results: [], history: [] };
 return { cycles, cycle, roster: source?.roster ?? null, sourceRevision: source?.sourceRevision ?? null, ...records };
}
/** Returns the current fence even if every former candidate has left the active roster. */
export async function boardSource(sessionLabel: string, permission: "outcomes:view" | "outcomes:manage" = "outcomes:view"): Promise<{ roster: ReturnStudent[]; sourceRevision: string }> {
 const staff = await assertPermission(permission); await assertSessionVisible(staff, sessionLabel);
 const { data, error } = await createAdminClient().rpc("school_board_source", { p_actor: staff.id, p_session: sessionLabel, p_permission: permission, p_confined: isConfinedDeployment() });
 if (error || !data || !Array.isArray(data.roster) || typeof data.sourceRevision !== "string" || !data.sourceRevision) throw new Error("Current board source unavailable");
 return data as { roster: ReturnStudent[]; sourceRevision: string };
}
export async function boardCandidate(cycleId: string, studentId: string): Promise<Candidate | undefined> {
 const cycle = await boardCycle(cycleId); if (!cycle) throw new Error("Board scope unavailable");
 const { data, error } = await (await createClient()).from("school_board_candidates").select("*").eq("cycle_id", cycle.id).eq("student_id", studentId).maybeSingle();
 if (error) throw new Error("Board registration unavailable");
 return (data ?? undefined) as Candidate | undefined;
}
export async function boardCommandReceipt(commandId: string): Promise<{ cycle_id: string; actor_id: string; kind: string; request_hash: string; receipt: Record<string, unknown> } | null> {
 await assertPermission("outcomes:manage");
 const { data, error } = await (await createClient()).from("school_board_commands").select("cycle_id,actor_id,kind,request_hash,receipt").eq("id", commandId).maybeSingle();
 if (error) throw new Error("Board command receipt unavailable");
 return data as { cycle_id: string; actor_id: string; kind: string; request_hash: string; receipt: Record<string, unknown> } | null;
}
/** Calendar consumes the same verified cycle configuration; it has no second editor. */
export async function loadBoardDeadlines(sessionLabel: string) {
 return (await boardCycles(sessionLabel)).flatMap(cycle => {
  const deadline = verifiedDeadline(cycle.config);
  return deadline ? [{ id: cycle.id, date: deadline.date, label: cycle.config.label, authority: cycle.config.authority, attempt: cycle.config.attemptLabel, verifiedOn: deadline.verifiedOn, sourceReference: deadline.sourceReference, href: `/exam-office/board?cycle=${cycle.id}` }] : [];
 });
}
