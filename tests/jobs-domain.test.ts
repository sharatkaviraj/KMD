import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  alreadyDone,
  isJobName,
  isStale,
  jobList,
  jobNames,
  JOBS,
  runDurationMs,
  STALE_AFTER_MS,
  summaryLine,
  type JobRun,
} from "@/modules/jobs/domain/jobs";
import {
  isPlatformCron,
  jobTokenFor,
  tokenMatches,
} from "@/modules/jobs/domain/token";

const run = (over: Partial<JobRun> = {}): JobRun => ({
  id: "r1",
  job: "open-registers",
  status: "ok",
  trigger: "schedule",
  triggeredByName: null,
  forDay: "2026-09-17",
  summary: {},
  error: null,
  startedAt: "2026-09-17T01:45:00.000Z",
  finishedAt: "2026-09-17T01:45:04.000Z",
  ...over,
});

/* ------------------------------------------------------------ the registry */

describe("the job registry", () => {
  it("has a definition for every name, keyed by its own name", () => {
    for (const name of jobNames) {
      expect(JOBS[name], name).toBeTruthy();
      // A registry keyed by one name whose value claims another is the kind of
      // thing that runs the wrong job at 7:15.
      expect(JOBS[name].name, name).toBe(name);
    }
    expect(jobList).toHaveLength(jobNames.length);
  });

  it("speaks both languages about every job", () => {
    for (const job of jobList) {
      for (const pair of [job.label, job.what, job.when]) {
        expect(pair.hi, job.name).toBeTruthy();
        expect(pair.en, job.name).toBeTruthy();
        expect(pair.hi, job.name).not.toBe(pair.en);
      }
    }
  });

  it("only accepts names it actually has", () => {
    expect(isJobName("open-registers")).toBe(true);
    expect(isJobName("openRegisters")).toBe(false);
    expect(isJobName("")).toBe(false);
    expect(isJobName("../../etc/passwd")).toBe(false);
  });

  /**
   * The schedule lives in two places — `vercel.json` is what actually fires,
   * and the registry is what the console tells a person. Two copies of a fact
   * drift, and this one drifts silently: the screen would keep claiming 7:15
   * long after somebody moved the cron.
   */
  it("agrees with vercel.json about when everything runs", () => {
    const config = JSON.parse(
      readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons: { path: string; schedule: string }[] };

    const scheduled = new Map(
      config.crons.map((entry) => [entry.path.replace("/api/jobs/", ""), entry.schedule]),
    );

    expect([...scheduled.keys()].sort()).toEqual([...jobNames].sort());

    for (const job of jobList) {
      expect(scheduled.get(job.name), job.name).toBe(job.schedule);
    }
  });

  it("schedules everything in UTC, offset from the school's own time", () => {
    // The school is at +05:30 and Vercel reads UTC. `45 1 * * *` is 07:15 in
    // Jaipur; a cron written as though it were local time would fire the
    // register job in the middle of the night.
    expect(JOBS["open-registers"].schedule).toBe("45 1 * * *");
    expect(JOBS["open-registers"].when.en).toContain("7:15");
  });
});

/* ------------------------------------------------------ already done today */

describe("alreadyDone()", () => {
  it("counts a success for the same job on the same day", () => {
    expect(alreadyDone([run()], "open-registers", "2026-09-17")).toBe(true);
  });

  it("does not count a failure, so a retry still runs", () => {
    expect(
      alreadyDone([run({ status: "failed" })], "open-registers", "2026-09-17"),
    ).toBe(false);
  });

  it("does not count a skip, which is the record of a retry doing nothing", () => {
    // Treating a skip as the success would make a job that failed once look
    // like a job that has worked every day since.
    expect(
      alreadyDone([run({ status: "skipped" })], "open-registers", "2026-09-17"),
    ).toBe(false);
  });

  it("does not count yesterday, or another job", () => {
    expect(
      alreadyDone([run({ forDay: "2026-09-16" })], "open-registers", "2026-09-17"),
    ).toBe(false);
    expect(
      alreadyDone([run({ job: "daily-summary" })], "open-registers", "2026-09-17"),
    ).toBe(false);
  });
});

/* -------------------------------------------------------------- stale runs */

describe("a run that stopped part-way", () => {
  it("measures a finished run between its own two stamps", () => {
    expect(runDurationMs(run())).toBe(4000);
  });

  it("measures an unfinished one against now", () => {
    const started = new Date("2026-09-17T01:45:00.000Z").getTime();
    const open = run({ status: "running", finishedAt: null });
    expect(runDurationMs(open, started + 90_000)).toBe(90_000);
  });

  it("calls a long-running row stale rather than busy", () => {
    // A job that has been "running" for an hour is not running: the process
    // died without writing its ending, and the console has to make that look
    // wrong rather than look like work in progress.
    const started = new Date("2026-09-17T01:45:00.000Z").getTime();
    const open = run({ status: "running", finishedAt: null });

    expect(isStale(open, started + STALE_AFTER_MS - 1000)).toBe(false);
    expect(isStale(open, started + STALE_AFTER_MS + 1000)).toBe(true);
  });

  it("never calls a finished run stale, however long it took", () => {
    expect(
      isStale(
        run({ finishedAt: "2026-09-17T09:00:00.000Z" }),
        new Date("2026-09-18T00:00:00.000Z").getTime(),
      ),
    ).toBe(false);
  });
});

describe("summaryLine()", () => {
  it("is empty when there is nothing to say", () => {
    expect(summaryLine({}, "en")).toBe("");
  });

  it("reads the same whatever order the keys arrived in", () => {
    const one = summaryLine({ opened: 3, classes: 19, already_open: 16 }, "en");
    const two = summaryLine({ classes: 19, already_open: 16, opened: 3 }, "en");
    expect(one).toBe(two);
    expect(one).toBe("already open: 16 · classes: 19 · opened: 3");
  });

  it("says the same numbers in Hindi (rule 9)", () => {
    // A scheduler is not exempt: an admin who reads Hindi should not be handed
    // a line of English keys just because a job produced them.
    const line = summaryLine({ opened: 3, classes: 19 }, "hi");
    expect(line).toBe("कक्षाएँ: 19 · खोली गईं: 3");
    expect(line).not.toContain("classes");
  });

  it("orders by key, so the two languages list the same things in the same order", () => {
    const keys = { opened: 1, classes: 2, children: 3 };
    const en = summaryLine(keys, "en").split(" · ").map((part) => part.split(":")[1]);
    const hi = summaryLine(keys, "hi").split(" · ").map((part) => part.split(":")[1]);
    expect(en).toEqual(hi);
  });

  it("falls back to the raw key for a job nobody has translated yet", () => {
    expect(summaryLine({ some_new_count: 4 }, "hi")).toBe("some new count: 4");
  });
});

/* ------------------------------------------------------------- the secrets */

describe("the per-job secret", () => {
  const secret = "a-test-secret-nobody-uses";

  it("gives every job a different token", () => {
    const tokens = jobNames.map((name) => jobTokenFor(secret, name));
    expect(new Set(tokens).size).toBe(jobNames.length);
  });

  it("never hands back the secret itself", () => {
    for (const name of jobNames) {
      const token = jobTokenFor(secret, name);
      expect(token).not.toContain(secret);
      expect(token).toHaveLength(32);
    }
  });

  it("changes completely when the secret changes", () => {
    expect(jobTokenFor(secret, "daily-summary")).not.toBe(
      jobTokenFor(`${secret}!`, "daily-summary"),
    );
  });

  it("accepts the right token and refuses every other one", () => {
    const right = jobTokenFor(secret, "open-registers");

    expect(tokenMatches(secret, "open-registers", right)).toBe(true);
    // One job's token must not open another.
    expect(tokenMatches(secret, "daily-summary", right)).toBe(false);
    expect(tokenMatches(secret, "open-registers", `${right}x`)).toBe(false);
    expect(tokenMatches(secret, "open-registers", right.slice(0, -1))).toBe(false);
    expect(tokenMatches(secret, "open-registers", right.toUpperCase())).toBe(false);
  });

  /**
   * The failure that matters most: an unconfigured deploy must have jobs that
   * *cannot* run, not jobs anybody can run. A comparison that treats "no
   * secret" as "no check" is an open door on every preview deploy.
   */
  it("refuses everything when no secret is configured", () => {
    expect(tokenMatches(undefined, "open-registers", "anything")).toBe(false);
    expect(tokenMatches("", "open-registers", "")).toBe(false);
    expect(tokenMatches(undefined, "open-registers", undefined)).toBe(false);
  });

  it("refuses a missing token even when a secret is set", () => {
    expect(tokenMatches(secret, "open-registers", null)).toBe(false);
    expect(tokenMatches(secret, "open-registers", "")).toBe(false);
  });
});

describe("the platform's own cron header", () => {
  it("accepts exactly the bearer it was given", () => {
    expect(isPlatformCron("abc123", "Bearer abc123")).toBe(true);
  });

  it("refuses a near miss", () => {
    expect(isPlatformCron("abc123", "Bearer abc124")).toBe(false);
    expect(isPlatformCron("abc123", "bearer abc123")).toBe(false);
    expect(isPlatformCron("abc123", "abc123")).toBe(false);
  });

  it("refuses everything when nothing is configured", () => {
    expect(isPlatformCron(undefined, "Bearer abc123")).toBe(false);
    expect(isPlatformCron("", "Bearer ")).toBe(false);
    expect(isPlatformCron("abc123", null)).toBe(false);
  });
});
