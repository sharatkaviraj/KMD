"use client";

/**
 * Exams & marks keeps its own boundary, so a failure in the tracker, a report
 * card or the preview is caught here — beside the shell, in the reader's
 * language, with Retry (and a one-time reload for a chunk that did not
 * arrive) — rather than taking the whole signed-in area with it. The
 * behaviour is the app-wide boundary's, reused as it is.
 */
export { default } from "../error";
