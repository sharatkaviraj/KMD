import { addDays } from "./datesheet";

/*
 * The exam coordinator's setup checklist for the next exam. Each step's state
 * is read from what is actually in the database — a date sheet with papers,
 * a seating plan, duties, question papers in — and only the steps nothing
 * else can tell ("tell parents", "admit slips") are ticked by hand.
 */

export const SETUP_KEYS = ["created", "datesheet", "parents", "seating", "duties", "papers", "admit"] as const;
export type SetupKey = (typeof SETUP_KEYS)[number];

export type SetupFacts = {
  startsOn: string | null;
  slots: number;
  datesheetChecked: boolean;
  datesheetPublished: boolean;
  seats: number;
  duties: number;
  papersTotal: number;
  papersReceived: number;
  /** Steps the coordinator ticked by hand. */
  ticked: ReadonlySet<string>;
};

export type SetupStep = {
  key: SetupKey;
  state: "done" | "doing" | "todo";
  /** How far a step under way has got, 0–1. */
  part: number;
  /** "Draft", "4 of 38" for a step under way. */
  progress: string | null;
  dueOn: string | null;
  owner: "you" | "teachers" | "office";
  /** Whether "mark done" makes sense: the step is the coordinator's and not done. */
  canTick: boolean;
};

/** Days before the exam each step is due. */
const DUE_BEFORE: Record<SetupKey, number | null> = {
  created: null,
  datesheet: 38,
  parents: 35,
  seating: 17,
  duties: 17,
  papers: 14,
  admit: 4,
};

const OWNER: Record<SetupKey, SetupStep["owner"]> = {
  created: "you",
  datesheet: "you",
  parents: "you",
  seating: "you",
  duties: "you",
  papers: "teachers",
  admit: "office",
};

export function setupSteps(f: SetupFacts): SetupStep[] {
  return SETUP_KEYS.map((key) => {
    const ticked = f.ticked.has(key);
    let state: SetupStep["state"] = "todo";
    let part = 0;
    let progress: string | null = null;
    switch (key) {
      case "created":
        state = "done";
        break;
      case "datesheet":
        if (f.datesheetChecked || f.datesheetPublished) state = "done";
        else if (f.slots > 0) {
          state = "doing";
          part = 0.5;
          progress = "draft";
        }
        break;
      case "parents":
        if (f.datesheetPublished) state = "done";
        break;
      case "seating":
        if (f.seats > 0) state = "done";
        break;
      case "duties":
        if (f.duties > 0) state = "done";
        break;
      case "papers":
        if (f.papersTotal > 0 && f.papersReceived >= f.papersTotal) state = "done";
        else if (f.papersReceived > 0) {
          state = "doing";
          part = f.papersReceived / Math.max(1, f.papersTotal);
          progress = `${f.papersReceived}/${f.papersTotal}`;
        }
        break;
      case "admit":
        break;
    }
    if (ticked) state = "done";
    if (state === "done") part = 1;
    const before = DUE_BEFORE[key];
    return {
      key,
      state,
      part,
      progress: state === "done" ? null : progress,
      dueOn: before !== null && f.startsOn ? addDays(f.startsOn, -before) : null,
      owner: OWNER[key],
      canTick: state !== "done" && key !== "created",
    };
  });
}

/** How ready the exam is: whole steps plus the share of those under way. */
export function readiness(steps: SetupStep[]): { percent: number; done: number; underWay: number } {
  if (steps.length === 0) return { percent: 0, done: 0, underWay: 0 };
  const score = steps.reduce((a, s) => a + (s.state === "done" ? 1 : s.part), 0);
  return {
    percent: Math.round((score / steps.length) * 100),
    done: steps.filter((s) => s.state === "done").length,
    underWay: steps.filter((s) => s.state === "doing").length,
  };
}

/** "98290 ••512": a phone number with the middle hidden, for lists on a shared screen. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length < 8) return "";
  return `${digits.slice(0, 5)} ••${digits.slice(-3)}`;
}
