import "server-only";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { connectionCardState, type CardState, type ConnectionListRow } from "@/modules/mcp/domain/card";
import { aiConnectionEligibility } from "@/modules/mcp/domain/eligibility";
import { consentSubject, pageEndpoints } from "@/modules/mcp/data/authorize";
import { listAiConnections, readAiConnectionSwitch } from "@/modules/mcp/data/connections";

/**
 * The signed-in person's card: null for someone who may not connect and never
 * has (the card is not advertised to them), otherwise the state from One's
 * records and the address to paste.
 */
export async function loadAiConnectionCard(staff: CurrentStaff): Promise<{ state: CardState; address: string | null; now: number } | null> {
  const eligible = aiConnectionEligibility(consentSubject(staff)).ok;
  const rows = await listAiConnections(staff.id);
  if (!eligible && rows.length === 0) return null;
  const [switchState, endpoints] = await Promise.all([readAiConnectionSwitch().catch(() => null), pageEndpoints()]);
  const now = Date.now();
  return {
    state: connectionCardState({ eligible, switchOn: switchState ? switchState.enabled : null, rows, now }),
    address: endpoints?.resource ?? null,
    now,
  };
}

/** The admin page: the switch (null = unreadable, treated as off), every connection, the address. The page has checked `settings:manage`. */
export async function loadAiConnectionAdmin(): Promise<{
  switchState: { enabled: boolean; updatedAt: string | null } | null;
  rows: ConnectionListRow[] | null;
  address: string | null;
  now: number;
}> {
  const [switchState, rows, endpoints] = await Promise.all([
    readAiConnectionSwitch().catch(() => null),
    listAiConnections().catch(() => null),
    pageEndpoints(),
  ]);
  return { switchState, rows, address: endpoints?.resource ?? null, now: Date.now() };
}
