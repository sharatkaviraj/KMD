import type { StaffRole } from "@/platform/auth/permissions";
import type { Language } from "@/platform/i18n/language";
import type { Pair } from "@/vx/text";

/*
 * The picker's shapes (D-544), apart from the loader so the Client Component
 * can name them without reaching into a server-only module.
 */

/** One member of staff the administrator may see One as. */
export type ViewAsPerson = {
  id: string;
  name: string;
  role: StaffRole;
  photo: string | null;
  /** Has signed in to One at least once. Most teachers have not yet. */
  hasSignIn: boolean;
  /** A practice (test) account: its screens only ever show TEST data. */
  practice: boolean;
  /** Class teacher of: "6 A", in the session their screens open in. */
  classes: string[];
  language: Language;
};

/** One earlier look, newest first. */
export type ViewAsRecent = {
  subjectId: string;
  name: string;
  role: StaffRole;
  startedAt: string;
  /** How long it lasted; null while it is still open. */
  minutes: number | null;
};

/** An earlier look as the picker draws it: when, in words, worked out on the server. */
export type ViewAsRecentShown = ViewAsRecent & { when: Pair };

export type ViewAsChoices = { people: ViewAsPerson[]; recent: ViewAsRecent[] };
