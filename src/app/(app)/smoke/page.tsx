import { notFound } from "next/navigation";

import { requireStaff } from "@/platform/auth/current-staff";
import { smokeLabEnabled } from "@/platform/auth/smoke-lab";
import { listFindings, listPool, listRuns } from "@/modules/smoke/data/smoke-repo";
import { AGENT_RULES, sortFindings } from "@/modules/smoke/domain/smoke";
import { schoolToday } from "@/platform/dates";
import { isSmokeEmail } from "@/modules/smoke/domain/pool";
import { SmokeLab } from "@/vx/screens/smoke/smoke-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "Smoke Lab", robots: { index: false, follow: false } };

/**
 * `/smoke` — the Smoke Lab console (admin, test database only): the account
 * pool, opening a run and handing out its passes, ending runs, and triaging
 * what the agents found. A 404 for anyone else and on the live database.
 */
export default async function SmokeLabPage(props: { searchParams: Promise<{ run?: string }> }) {
  const staff = await requireStaff("/smoke");
  if (staff.role !== "admin" || staff.smokeLab || isSmokeEmail(staff.email) || !smokeLabEnabled()) notFound();
  const { run: runParam } = await props.searchParams;
  const [pool, runs] = await Promise.all([listPool(), listRuns()]);
  const selected = runs.find((r) => r.id === runParam) ?? runs[0] ?? null;
  const findings = selected ? sortFindings(await listFindings(selected.id)) : [];
  return <SmokeLab pool={pool} runs={runs} selectedRunId={selected?.id ?? null} findings={findings} today={schoolToday()} rules={[...AGENT_RULES]} />;
}
