/*
 * What One may queue for parents, decided by the admin on Settings → Parent
 * messages (owner, 6 Nov 2026: "let admin make the switch on off of all the
 * decisions that needs to send to parent"). Stored as `school_settings` key
 * `parent_messages`.
 *
 * These switches decide what a teacher's screen offers and what the server
 * will queue. They sit in front of the provider gate
 * (`platform/messaging/parent-send-gate.ts`), which still decides whether a
 * queued message may reach WhatsApp at all; neither replaces the other.
 */

/** The register's absent-child WhatsApp: off, or offered with the switch starting off or on. */
export type AbsentAlertMode = "off" | "ask_off" | "ask_on";
export const ABSENT_ALERT_MODES: readonly AbsentAlertMode[] = ["off", "ask_off", "ask_on"];

export type ParentSwitches = {
  absentAlert: AbsentAlertMode;
  /** "Tell parents" on a note. */
  note: boolean;
  /** Sharing a support plan with the parents. */
  supportPlan: boolean;
  /** The class teacher's birthday wish. */
  birthday: boolean;
};

/** No choice saved yet: what One did before the switches existed (D-320). */
export const DEFAULT_PARENT_SWITCHES: ParentSwitches = { absentAlert: "ask_on", note: true, supportPlan: true, birthday: true };

/** A failed read: nothing reaches a parent until the setting can be read. */
export const PARENT_SWITCHES_CLOSED: ParentSwitches = { absentAlert: "off", note: false, supportPlan: false, birthday: false };

export const PARENT_SWITCHES_KEY = "parent_messages";

/** Missing fields take the default; a field of the wrong shape is closed. */
export function cleanParentSwitches(value: unknown): ParentSwitches {
  if (!value || typeof value !== "object") return DEFAULT_PARENT_SWITCHES;
  const v = value as Record<string, unknown>;
  const flag = (key: keyof Omit<ParentSwitches, "absentAlert">) => (v[key] === undefined ? DEFAULT_PARENT_SWITCHES[key] : v[key] === true);
  const mode = v.absentAlert === undefined ? DEFAULT_PARENT_SWITCHES.absentAlert : ABSENT_ALERT_MODES.includes(v.absentAlert as AbsentAlertMode) ? (v.absentAlert as AbsentAlertMode) : "off";
  return { absentAlert: mode, note: flag("note"), supportPlan: flag("supportPlan"), birthday: flag("birthday") };
}

/** Which queued kinds (`parent_message_queue.kind`) the admin allows. */
export function allowsParentKind(s: ParentSwitches, kind: "absent_alert" | "note" | "support_plan" | "birthday"): boolean {
  if (kind === "absent_alert") return s.absentAlert !== "off";
  if (kind === "note") return s.note;
  if (kind === "support_plan") return s.supportPlan;
  return s.birthday;
}
