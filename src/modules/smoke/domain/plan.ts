import { SMOKE_SEATS } from "@/modules/smoke/domain/pool";

/*
 * A Smoke Lab plan file: the run to open, who takes part as whom, and the
 * order the agents go in. `scripts/smoke/open-run.mjs` opens the run from it
 * and `scripts/smoke/preflight.mjs` checks it first, because open-run fails
 * half-way through a browser session when a seat or a persona is wrong.
 *
 * A plan holds no pass and no secret, so it can live in the repository
 * (`docs/smoke/plans/`); the kit that `open-run` writes from it cannot.
 */

/** What the /smoke console keeps (`src/app/(app)/smoke/actions.ts`). */
export const PLAN_LIMITS = { title: 120, persona: 120, seats: 30 } as const;

/** Browsers this laptop runs at once (docs/smoke/README.md). Cloud agents may run more. */
export const LOCAL_BROWSERS = 3;

export type PlanSeat = { key: string; persona: string };
export type PlanWave = { name: string; clock: string; seats: string[]; note?: string };
export type SmokePlan = {
  title: string;
  schoolDay: string;
  clockStart: string;
  hours: number;
  seats: PlanSeat[];
  waves?: PlanWave[];
};

export type PlanReport = { errors: string[]; warnings: string[] };

const seatKeys = new Set(SMOKE_SEATS.map((s) => s.email.slice("smoke.".length, s.email.indexOf("@"))));

/**
 * Everything wrong with a plan, before a run is opened from it.
 *
 * Errors stop the run being opened; warnings are for the person reading the
 * plan (a wave wider than this laptop runs at once is fine on cloud agents).
 */
export function checkPlan(raw: unknown): PlanReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const plan = (raw ?? {}) as Partial<SmokePlan>;

  if (typeof plan.title !== "string" || !plan.title.trim()) errors.push("title is missing");
  else if (plan.title.length > PLAN_LIMITS.title) errors.push(`title is longer than ${PLAN_LIMITS.title} characters`);

  if (typeof plan.schoolDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(plan.schoolDay) || Number.isNaN(Date.parse(`${plan.schoolDay}T00:00:00Z`))) {
    errors.push("schoolDay must be YYYY-MM-DD");
  } else if (new Date(`${plan.schoolDay}T00:00:00Z`).getUTCDay() === 0) {
    errors.push(`schoolDay ${plan.schoolDay} is a Sunday: there is no timetable to follow`);
  }

  if (typeof plan.clockStart !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.clockStart)) errors.push("clockStart must be HH:MM");
  if (!Number.isInteger(plan.hours) || (plan.hours as number) < 1 || (plan.hours as number) > 24) errors.push("hours must be a whole number from 1 to 24");

  const seats = Array.isArray(plan.seats) ? plan.seats : [];
  if (!seats.length) errors.push("seats is empty");
  if (seats.length > PLAN_LIMITS.seats) errors.push(`${seats.length} seats; the console opens at most ${PLAN_LIMITS.seats}`);

  const inPlan = new Set<string>();
  for (const seat of seats) {
    const key = typeof seat?.key === "string" ? seat.key : "";
    if (!seatKeys.has(key)) errors.push(`seat "${key}" is not in the pool (src/modules/smoke/domain/pool.ts)`);
    if (inPlan.has(key)) errors.push(`seat "${key}" is listed twice`);
    inPlan.add(key);
    if (typeof seat?.persona !== "string" || !seat.persona.trim()) warnings.push(`seat "${key}" has no persona: its agent will act as a generic ${key}`);
    else if (seat.persona.length > PLAN_LIMITS.persona) errors.push(`seat "${key}" persona is ${seat.persona.length} characters; the console keeps ${PLAN_LIMITS.persona}`);
  }

  if (plan.waves !== undefined) {
    const waves = Array.isArray(plan.waves) ? plan.waves : [];
    const scheduled = new Set<string>();
    let previous = "";
    for (const wave of waves) {
      const name = typeof wave?.name === "string" ? wave.name : "(unnamed)";
      const waveSeats = Array.isArray(wave?.seats) ? wave.seats : [];
      if (typeof wave?.clock !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(wave.clock)) errors.push(`wave "${name}" clock must be HH:MM`);
      else if (wave.clock < previous) errors.push(`wave "${name}" starts at ${wave.clock}, before the wave ahead of it`);
      else previous = wave.clock;
      if (!waveSeats.length) errors.push(`wave "${name}" has no seats`);
      if (waveSeats.length > LOCAL_BROWSERS) warnings.push(`wave "${name}" has ${waveSeats.length} seats; this laptop runs ${LOCAL_BROWSERS} browsers at once`);
      for (const key of waveSeats) {
        if (!inPlan.has(key)) errors.push(`wave "${name}" names "${key}", which is not a seat in this plan`);
        scheduled.add(key);
      }
    }
    for (const key of inPlan) if (!scheduled.has(key)) warnings.push(`seat "${key}" is in no wave, so no agent will be started for it`);
  }

  return { errors, warnings };
}
