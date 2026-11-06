/**
 * The home hint's cookie, on its own so the browser side (`vx/shell/home-hint.tsx`)
 * can name it without pulling the server's environment checks into the bundle.
 * The rule itself is `home-hint.ts`.
 */
export const HOME_HINT_COOKIE = "vx_home";

/** A month: the hint is rewritten on every signed-in screen anyway. */
export const HOME_HINT_MAX_AGE = 60 * 60 * 24 * 30;
