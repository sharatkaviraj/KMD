import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { staffRoles } from "@/platform/auth/permissions";
import {
  QA_ACCOUNTS,
  QA_EMAIL_DOMAIN,
  accountsByRole,
  pickTimetableTeachers,
  qaAccount,
  type TimetableTeacher,
} from "./fixtures/qa-accounts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The fixture *list*, not the database. Whether `qa:seed` wrote the rows is a
 * question for the run's own output; whether the list it works from is coherent
 * is a question that should fail before anybody runs it.
 */

describe("the QA account list", () => {
  it("covers every role", () => {
    const covered = new Set(QA_ACCOUNTS.map((account) => account.role));
    for (const role of staffRoles) expect([...covered]).toContain(role);
  });

  it("gives every role a signable account", () => {
    const map = accountsByRole();
    for (const role of staffRoles) expect(map[role]).toMatch(/@/);
  });

  it("keeps every address inside the QA domain", () => {
    // Rule 6, and the fixture's own safety rail: an address outside this domain
    // could be somebody's real inbox, and `qa:seed` creates accounts.
    for (const account of QA_ACCOUNTS) {
      expect(account.email.endsWith(QA_EMAIL_DOMAIN)).toBe(true);
    }
  });

  it("has no duplicate key, email or short name", () => {
    const keys = QA_ACCOUNTS.map((a) => a.key);
    const emails = QA_ACCOUNTS.map((a) => a.email);
    const shortNames = QA_ACCOUNTS.map((a) =>
      a.binding.kind === "timetable-teacher" ? `slot-${a.binding.slot}` : a.binding.shortName,
    );

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(emails).size).toBe(emails.length);
    expect(new Set(shortNames).size).toBe(shortNames.length);
  });

  it("says what each account is for", () => {
    // An account with no stated purpose is one somebody reuses for a different
    // case and breaks both.
    for (const account of QA_ACCOUNTS) {
      expect(account.purpose.length).toBeGreaterThan(20);
    }
  });

  it("names no real member of staff", () => {
    // Which existing profile a teaching account binds to is decided at seed
    // time by rule. A short name written here would be a person in the repo.
    const bound = QA_ACCOUNTS.filter((a) => a.binding.kind !== "timetable-teacher");
    for (const account of bound) {
      if (account.binding.kind === "timetable-teacher") continue;
      expect(account.binding.shortName).toMatch(/^QA[A-Z]{2}$/);
    }
  });

  /** B-17, as a test rather than as a note in a document. */
  it("has a teacher with a real day and a teacher with nothing, and they are different accounts", () => {
    const working = qaAccount("teacher");
    const empty = qaAccount("teacherWithoutClasses");

    expect(working.binding.kind).toBe("timetable-teacher");
    expect(empty.binding.kind).toBe("existing");
    expect(working.email).not.toBe(empty.email);

    // The one the role runners use has to be the one with a day. Before R0.2
    // it was the other way round and 36 combinations proved nothing.
    expect(accountsByRole().teacher).toBe(working.email);
  });

  it("has a second teacher, and a deactivated account that cannot sign in", () => {
    expect(qaAccount("teacher2").binding).toEqual({
      kind: "timetable-teacher",
      slot: 2,
    });

    const inactive = qaAccount("inactive");
    expect(inactive.canSignIn).toBe(false);
    expect(inactive.binding).toMatchObject({ kind: "create", isActive: false });
  });

  it("reads at least one screen in Hindi and one in English", () => {
    const languages = new Set(QA_ACCOUNTS.map((account) => account.language));
    expect(languages).toContain("hi");
    expect(languages).toContain("en");
    expect(languages).toContain("both");
  });

  it("refuses a key it does not have", () => {
    expect(() => qaAccount("headmaster")).toThrow(/no qa account/i);
  });
});

/* ------------------------------------------------ choosing the two teachers */

const teacher = (
  shortName: string,
  slots: number,
  classIds: string[],
): TimetableTeacher => ({
  staffProfileId: `id-${shortName}`,
  shortName,
  slots,
  classIds,
});

describe("picking two teachers who share no class", () => {
  it("takes the busiest, then the busiest disjoint one", () => {
    const pair = pickTimetableTeachers([
      teacher("B", 50, ["c6", "c7"]),
      teacher("A", 90, ["c1", "c2"]),
      teacher("C", 80, ["c2", "c9"]), // overlaps A on c2, so it is skipped
    ]);

    expect(pair.first.shortName).toBe("A");
    expect(pair.second.shortName).toBe("B");
  });

  it("breaks a tie on periods by short name, so two runs agree", () => {
    const pair = pickTimetableTeachers([
      teacher("Z", 40, ["c1"]),
      teacher("A", 40, ["c2"]),
    ]);

    expect(pair.first.shortName).toBe("A");
    expect(pair.second.shortName).toBe("Z");
  });

  it("ignores anybody the published sheet gives no periods", () => {
    const pair = pickTimetableTeachers([
      teacher("Empty", 0, []),
      teacher("A", 10, ["c1"]),
      teacher("B", 5, ["c2"]),
    ]);

    expect([pair.first.shortName, pair.second.shortName]).toEqual(["A", "B"]);
  });

  it("refuses rather than pairing two teachers who share a class", () => {
    // A fixture that quietly pairs an overlapping second teacher produces a run
    // where every cross-teacher leak test passes for the wrong reason.
    expect(() =>
      pickTimetableTeachers([
        teacher("A", 90, ["c1", "c2"]),
        teacher("B", 50, ["c2", "c3"]),
      ]),
    ).toThrow(/shares a class/i);
  });

  it("refuses when nothing is published at all", () => {
    expect(() => pickTimetableTeachers([])).toThrow(/seed:timetable/i);
  });
});

/* ------------------------------------------------- the runners use the list */

describe("the runners read the list rather than their own copy", () => {
  const smoke = readFileSync(path.join(repoRoot, "scripts/smoke-roles.mjs"), "utf8");

  it("smoke:roles imports the account list", () => {
    expect(smoke).toMatch(/from "\.\.\/tests\/fixtures\/qa-accounts\.ts"/);
    expect(smoke).toMatch(/accountsByRole\(\)/);
  });

  it("smoke:roles no longer carries hard-coded addresses", () => {
    // The literal that used to live there. Two lists of the same six addresses
    // is how one of them silently stopped describing a real teacher.
    expect(smoke).not.toMatch(/teacher:\s*"qa\.teacher@qa\.vpps\.local"/);
  });
});
