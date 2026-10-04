import type { Localized } from "@/platform/i18n/language";

/**
 * What approving or confirming a parent message tells the screen (P9). A
 * plain module: the `"use server"` file may export only async functions.
 *
 *  - approved — the person may open WhatsApp now; `link` has the text filled
 *    in and sends nothing until they press send.
 *  - sent — recorded as sent. `warnings` says what had changed by then: the
 *    send happened and is kept, and the screen asks for a correction.
 *  - stale — what the message rests on has changed since it was queued. It
 *    is not approved; withdraw it and queue a fresh one.
 *  - error — nothing changed.
 */
export type ParentSendState =
  | { status: "idle" }
  | { status: "approved"; link: string }
  | { status: "sent"; warnings: Localized[] }
  | { status: "stale"; reasons: Localized[] }
  | { status: "error"; message: Localized };

export const idleParentSendState: ParentSendState = { status: "idle" };
