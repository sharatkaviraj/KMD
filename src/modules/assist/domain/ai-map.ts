import { isFreeProvider, type AiProvider, type TaskRow } from "./overview";
import { assistChain, OPEN_TASKS, TASK_TIER, type AssistStage, type AvailableKeys } from "./routes";
import type { AssistTaskId } from "./tasks";

/**
 * The route each kind of AI job takes on this deployment (D-501), for the
 * "How it works" view of Settings → AI helper. Pure: it walks the same chains
 * the helper runs (`assistChain`) and the photo and voice order of
 * `lib/ai/providers.ts`, so the picture cannot drift from what happens.
 *
 * Four lanes, by what the job carries:
 *
 *   open    names nobody: the free models first, then the paid ones
 *   people  a child's, a family's or a parent's details: paid only (the free
 *           models are shown locked; a test account's practice jobs use them)
 *   photo   a photograph: paid only, never a free model for real records
 *   voice   a spoken request: OpenAI listens and Claude understands, then Gemini
 */

export type LaneId = "open" | "people" | "photo" | "voice";

export type Station = {
  provider: AiProvider;
  /** The models this provider uses in this lane, in order. */
  models: string[];
  free: boolean;
  /** A free model that real records never reach: only test material ("test"), or nothing at all ("never"). */
  locked: "test" | "never" | null;
  /** Voice: OpenAI hears, then this partner understands, as one step. */
  partner?: { provider: AiProvider; model: string };
};

export type Lane = { id: LaneId; tasks: string[]; stations: Station[]; off?: boolean };

/** What `lib/ai` has for the photo and voice jobs on this deployment. */
export type BuiltinRoute = {
  /** "off" when built-in photo and voice AI are not switched on here. */
  mode: "off" | "test" | "live";
  claudeImageModel: string | null;
  claudeVoiceModel: string | null;
  openAiListenModel: string | null;
  geminiPaidModel: string | null;
  geminiFreeModel: string | null;
};

export const BUILTIN_TASKS = ["marks-photo", "substitution-photo", "voice"] as const;
const PHOTO_TASKS = new Set<string>(["form.read", "marks-photo", "substitution-photo"]);

/** Which lane a job belongs to. */
export function laneOf(task: string): LaneId {
  if (task === "voice") return "voice";
  if (PHOTO_TASKS.has(task)) return "photo";
  if (OPEN_TASKS.has(task as AssistTaskId)) return "open";
  return "people";
}

/** Stages of several chains as one row of stations: each provider once, at its first place, with every model it uses. */
function merge(chains: AssistStage[][], locked: Station["locked"] = null): Station[] {
  const out: Station[] = [];
  for (const chain of chains) {
    for (const stage of chain) {
      const found = out.find((s) => s.provider === stage.provider);
      if (found) {
        if (!found.models.includes(stage.model)) found.models.push(stage.model);
      } else {
        const free = isFreeProvider(stage.provider);
        out.push({ provider: stage.provider, models: [stage.model], free, locked: free ? locked : null });
      }
    }
  }
  return out;
}

const TEXT_TASKS = (Object.keys(TASK_TIER) as AssistTaskId[]).filter((t) => t !== "form.read");

export function aiLanes(keys: AvailableKeys, env: Readonly<Record<string, string | undefined>>, builtin: BuiltinRoute): Lane[] {
  const openTasks = TEXT_TASKS.filter((t) => OPEN_TASKS.has(t));
  const peopleTasks = TEXT_TASKS.filter((t) => !OPEN_TASKS.has(t));

  const open = merge(openTasks.map((t) => assistChain(t, keys, env)));

  // Real records go paid only. The free stations are drawn, locked, because a test account's practice uses them.
  const lockedFree = merge([assistChain(peopleTasks[0], keys, env, { testMaterial: true }).filter((s) => isFreeProvider(s.provider))], "test");
  const people = [...lockedFree, ...merge(peopleTasks.map((t) => assistChain(t, keys, env)))];

  const on = builtin.mode !== "off";
  const imageChain: AssistStage[] = on
    ? [
        ...(builtin.claudeImageModel ? [{ provider: "anthropic" as const, model: builtin.claudeImageModel, timeoutMs: 0 }] : []),
        ...(builtin.geminiPaidModel ? [{ provider: "gemini-paid" as const, model: builtin.geminiPaidModel, timeoutMs: 0 }] : []),
      ]
    : [];
  const freeModel = builtin.geminiFreeModel ?? keys.geminiFreeModel ?? null;
  const photo: Station[] = [
    ...(freeModel ? [{ provider: "gemini-free" as const, models: [freeModel], free: true, locked: "never" as const }] : []),
    ...merge([assistChain("form.read", keys, env), imageChain]),
  ];

  const voice: Station[] = [];
  if (on && builtin.openAiListenModel && builtin.claudeVoiceModel) {
    voice.push({ provider: "openai", models: [builtin.openAiListenModel], free: false, locked: null, partner: { provider: "anthropic", model: builtin.claudeVoiceModel } });
  }
  // A TEST session's voice request may try the free key after Claude; real ones never do.
  if (on && builtin.geminiFreeModel) voice.push({ provider: "gemini-free", models: [builtin.geminiFreeModel], free: true, locked: "test" });
  if (on && builtin.geminiPaidModel) voice.push({ provider: "gemini-paid", models: [builtin.geminiPaidModel], free: false, locked: null });

  return [
    { id: "open", tasks: openTasks, stations: open },
    { id: "people", tasks: peopleTasks, stations: people },
    { id: "photo", tasks: ["form.read", ...(on ? ["marks-photo", "substitution-photo"] : [])], stations: photo },
    { id: "voice", tasks: ["voice"], stations: voice, off: !on },
  ];
}

/** This month's answered jobs per lane and provider, from the overview's task rows. */
export function laneCounts(tasks: readonly Pick<TaskRow, "task" | "providers">[]): Record<LaneId, Partial<Record<AiProvider, number>>> {
  const out: Record<LaneId, Partial<Record<AiProvider, number>>> = { open: {}, people: {}, photo: {}, voice: {} };
  for (const row of tasks) {
    const lane = out[laneOf(row.task)];
    for (const slice of row.providers) {
      if (!slice.provider) continue;
      lane[slice.provider] = (lane[slice.provider] ?? 0) + slice.jobs;
    }
  }
  return out;
}

/** Jobs a station answered: its own, and its partner's for the voice pair. */
export function stationCount(station: Station, counts: Partial<Record<AiProvider, number>>): number {
  return (counts[station.provider] ?? 0) + (station.partner ? counts[station.partner.provider] ?? 0 : 0);
}

/** The station that answered most of a lane's real jobs this month, or -1 when none did. A locked station never counts. */
export function busiestStation(stations: readonly Station[], counts: Partial<Record<AiProvider, number>>): number {
  let best = -1;
  let most = 0;
  stations.forEach((s, i) => {
    if (s.locked) return;
    const n = stationCount(s, counts);
    if (n > most) {
      most = n;
      best = i;
    }
  });
  return best;
}
