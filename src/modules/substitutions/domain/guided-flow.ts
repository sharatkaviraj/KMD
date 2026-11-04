/*
 * The guided cover flow's Confirm, as a state machine (review C01).
 *
 * The rules it exists to keep:
 *
 *  - **Saved only when the server says so.** The one way into `saved` is an
 *    answer from the server: the commit's receipt, or a check that found it.
 *    Pressing Confirm is `saving`, never `saved`.
 *  - **A retry is the same command.** An answer that never came is `checking`,
 *    then `not_saved` (the server has no record) or `unknown` (the check could
 *    not be made either). Both offer Try again, and both send the command id
 *    they already sent — the database answers a repeated id with the first
 *    receipt, so a retry can never make a second set of covers.
 *  - **A moved day is said plainly.** Somebody else saved this day (`stale`)
 *    or the plan came out differently (`plan_changed`): nothing was written,
 *    the proposal is read again, and the coordinator confirms the new one. The
 *    old command id is dropped with it.
 *  - **Failures stay on screen** until the next attempt or an edit.
 */

export type SaveRefusal = "refused_override" | "disabled" | "no_timetable" | "no_timetable_day" | "not_permitted" | "id_reused" | "bad_request" | "invalid";

export type SaveState<Receipt> =
  | { status: "editing"; notice: "stale" | "plan_changed" | null }
  | { status: "saving"; commandId: string }
  | { status: "checking"; commandId: string }
  | { status: "not_saved"; commandId: string }
  | { status: "unknown"; commandId: string }
  | { status: "reloading"; why: "stale" | "plan_changed" }
  | { status: "refused"; reason: SaveRefusal }
  | { status: "saved"; receipt: Receipt };

export type SaveEvent<Receipt> =
  | { type: "confirm"; commandId: string }
  | { type: "server_saved"; receipt: Receipt }
  | { type: "server_moved"; why: "stale" | "plan_changed" }
  | { type: "server_refused"; reason: SaveRefusal }
  | { type: "server_unknown" }
  | { type: "check_start" }
  | { type: "check_saved"; receipt: Receipt }
  | { type: "check_missing" }
  | { type: "check_failed" }
  | { type: "proposal_loaded" }
  | { type: "edited" }
  /** Start again after a save: the next absence is a new flow. */
  | { type: "reset" };

export function initialSave<Receipt>(): SaveState<Receipt> {
  return { status: "editing", notice: null };
}

/** Whether Confirm may be pressed now. Never twice at once. */
export function canConfirm<Receipt>(state: SaveState<Receipt>): boolean {
  return state.status === "editing" || state.status === "refused" || state.status === "not_saved" || state.status === "unknown";
}

/**
 * The id the next Confirm sends: the one already sent when its outcome is
 * still open (a retry), a fresh one otherwise.
 */
export function commandIdFor<Receipt>(state: SaveState<Receipt>, mint: () => string): string {
  return state.status === "not_saved" || state.status === "unknown" ? state.commandId : mint();
}

export function guidedSave<Receipt>(state: SaveState<Receipt>, event: SaveEvent<Receipt>): SaveState<Receipt> {
  switch (event.type) {
    case "confirm":
      if (!canConfirm(state)) return state;
      // A retry must not swap the id under an open outcome.
      if ((state.status === "not_saved" || state.status === "unknown") && event.commandId !== state.commandId) return state;
      return { status: "saving", commandId: event.commandId };
    case "server_saved":
      return state.status === "saving" ? { status: "saved", receipt: event.receipt } : state;
    case "server_moved":
      return state.status === "saving" ? { status: "reloading", why: event.why } : state;
    case "server_refused":
      return state.status === "saving" ? { status: "refused", reason: event.reason } : state;
    case "server_unknown":
      return state.status === "saving" ? { status: "checking", commandId: state.commandId } : state;
    case "check_start":
      return state.status === "not_saved" || state.status === "unknown" ? { status: "checking", commandId: state.commandId } : state;
    case "check_saved":
      return state.status === "checking" || state.status === "not_saved" || state.status === "unknown"
        ? { status: "saved", receipt: event.receipt }
        : state;
    case "check_missing":
      return state.status === "checking" ? { status: "not_saved", commandId: state.commandId } : state;
    case "check_failed":
      return state.status === "checking" ? { status: "unknown", commandId: state.commandId } : state;
    case "proposal_loaded":
      return state.status === "reloading" ? { status: "editing", notice: state.why } : state;
    case "edited":
      // Nothing is edited under a request still on its way, nor after a save.
      // After "not saved" or "unknown" an edit is a new command: if the first
      // one did land after all, the day's revision moved and the new one is
      // refused as stale — two commands can never both commit on one view.
      if (state.status === "saving" || state.status === "checking" || state.status === "saved") return state;
      return { status: "editing", notice: null };
    case "reset":
      return state.status === "saved" ? { status: "editing", notice: null } : state;
    default:
      return state;
  }
}

/** True while a request is on its way or being checked: nothing else may be sent. */
export function isBusy<Receipt>(state: SaveState<Receipt>): boolean {
  return state.status === "saving" || state.status === "checking" || state.status === "reloading";
}
