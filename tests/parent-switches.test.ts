import { describe, expect, it } from "vitest";

import {
  allowsParentKind,
  cleanParentSwitches,
  DEFAULT_PARENT_SWITCHES,
  PARENT_SWITCHES_CLOSED,
} from "@/vx/screens/settings/domain/parent-switches";
import { alertsDefault } from "@/vx/screens/teach/domain/teach";

/*
 * Settings → Parent messages (owner, 6 Nov 2026): the admin decides what
 * teachers may queue for parents, and where the register's switch starts.
 */

describe("the stored parent-message switches", () => {
  it("keeps today's behaviour until the admin has chosen", () => {
    expect(cleanParentSwitches(null)).toEqual(DEFAULT_PARENT_SWITCHES);
    expect(cleanParentSwitches({})).toEqual(DEFAULT_PARENT_SWITCHES);
  });

  it("reads what the admin saved", () => {
    expect(cleanParentSwitches({ absentAlert: "ask_off", note: false, supportPlan: true, birthday: false })).toEqual({ absentAlert: "ask_off", note: false, supportPlan: true, birthday: false });
  });

  it("closes a field it cannot read rather than guessing it on", () => {
    expect(cleanParentSwitches({ absentAlert: "always", note: "yes" })).toMatchObject({ absentAlert: "off", note: false, supportPlan: true });
  });

  it("allows each kind only when its switch is on", () => {
    const s = { absentAlert: "ask_off" as const, note: false, supportPlan: true, birthday: false };
    expect(allowsParentKind(s, "absent_alert")).toBe(true);
    expect(allowsParentKind(s, "note")).toBe(false);
    expect(allowsParentKind(s, "support_plan")).toBe(true);
    expect(allowsParentKind(s, "birthday")).toBe(false);
    expect(allowsParentKind({ ...s, absentAlert: "off" }, "absent_alert")).toBe(false);
    for (const kind of ["absent_alert", "note", "support_plan", "birthday"] as const) expect(allowsParentKind(PARENT_SWITCHES_CLOSED, kind)).toBe(false);
  });
});

describe("where the register's WhatsApp switch starts", () => {
  it("follows the admin's choice on today's first save", () => {
    expect(alertsDefault({ mode: "mark", isToday: true, queued: 0, admin: "ask_on" })).toBe(true);
    expect(alertsDefault({ mode: "mark", isToday: true, queued: 0, admin: "ask_off" })).toBe(false);
  });

  it("is never on when the admin has turned it off, whatever the phone remembers", () => {
    expect(alertsDefault({ mode: "mark", isToday: true, queued: 0, admin: "off" })).toBe(false);
    expect(alertsDefault({ mode: "mark", isToday: true, queued: 0, admin: "off", chosen: true })).toBe(false);
    expect(alertsDefault({ mode: "change", isToday: true, queued: 2, admin: "off" })).toBe(false);
  });

  it("still lets the teacher turn it on when it starts off", () => {
    expect(alertsDefault({ mode: "mark", isToday: true, queued: 0, admin: "ask_off", chosen: true })).toBe(true);
  });
});
