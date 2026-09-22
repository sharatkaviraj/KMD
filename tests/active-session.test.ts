import { describe, expect, it } from "vitest";

import { pickSessionLabel } from "@/platform/config/active-session";

/**
 * The session the school is in — and the sort that used to answer it.
 *
 * Six places derived this by sorting every `session_label` and taking the
 * last. Every one of them was correct on a database with one session and
 * wrong on the live fee database, which carries three.
 *
 * The case that matters is the first one below, and it is worth stating
 * plainly: **`TEST-2026-27` sorts above `2026-27`**, because `T` sorts above
 * `2`. The rehearsal session wins a string comparison against every real year
 * this school will ever have.
 */
const LIVE_SESSIONS = ["2026-27", "2027-28", "TEST-2026-27"] as const;

describe("pickSessionLabel", () => {
  it("prefers what the application stores over what sorts last", () => {
    expect(
      pickSessionLabel({ active: "2026-27", labels: LIVE_SESSIONS }),
    ).toBe("2026-27");
  });

  it("would otherwise choose the rehearsal session, which is the whole bug", () => {
    // No stored answer, so it falls back to the sort — and the sort is wrong.
    // Asserted rather than avoided: this is what every caller used to do, and
    // the test exists so that nobody reintroduces it believing it is harmless.
    expect(pickSessionLabel({ labels: LIVE_SESSIONS })).toBe("TEST-2026-27");
  });

  it("is unchanged on a database with a single session", () => {
    // Why it survived review six times: with one session the shortcut and the
    // correct answer agree, and `schoolfees-dev` had exactly one.
    expect(pickSessionLabel({ labels: ["TEST-2026-27"] })).toBe("TEST-2026-27");
    expect(
      pickSessionLabel({ active: "TEST-2026-27", labels: ["TEST-2026-27"] }),
    ).toBe("TEST-2026-27");
  });

  it("lets a request win, so the session switcher still works", () => {
    expect(
      pickSessionLabel({
        requested: "2027-28",
        active: "2026-27",
        labels: LIVE_SESSIONS,
      }),
    ).toBe("2027-28");
  });

  it("lets the deployment override the stored answer", () => {
    expect(
      pickSessionLabel({
        configured: "2027-28",
        active: "2026-27",
        labels: LIVE_SESSIONS,
      }),
    ).toBe("2027-28");
  });

  it("ignores a session the database has never heard of", () => {
    // A stale cookie, a typo in an environment variable, or a session that has
    // been deleted. Answering with it would send every query looking for rows
    // that cannot exist, and the screens would read empty rather than refuse.
    expect(
      pickSessionLabel({
        requested: "1999-2000",
        configured: "also-not-real",
        active: "2026-27",
        labels: LIVE_SESSIONS,
      }),
    ).toBe("2026-27");
  });

  it("trims, because an environment variable usually has a newline on it", () => {
    expect(
      pickSessionLabel({ configured: " 2027-28\n", labels: LIVE_SESSIONS }),
    ).toBe("2027-28");
  });

  it("answers null when there is no session at all", () => {
    // A database with no classes and no setting. `null` is the honest answer;
    // the callers turn it into "this has not been set up" rather than a crash.
    expect(pickSessionLabel({ labels: [] })).toBeNull();
    expect(pickSessionLabel({ active: "2026-27", labels: [] })).toBeNull();
  });

  it("does not mutate the list it was given", () => {
    // `.sort()` sorts in place, and the caller's list is `listSessionLabels()`,
    // which is ordered on purpose for the session switcher.
    const labels = ["2026-27", "TEST-2026-27", "2027-28"];
    const before = [...labels];

    pickSessionLabel({ labels });

    expect(labels).toEqual(before);
  });
});
