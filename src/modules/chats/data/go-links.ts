import "server-only";

import { randomBytes } from "node:crypto";

import { GO_LINK_DAYS, goCodeFrom, goLinkUrl, isGoCode, safeGoPath, type GoPurpose } from "@/modules/chats/domain/go-links";
import { isUuid } from "@/modules/chats/data/store";
import { whatsappDb } from "@/platform/whatsapp/store";

/**
 * One-tap links into One (D-616), kept in `vppsone.go_links`: a WhatsApp
 * message carries `https://one.vpps.co.in/go/<code>`, and the code says
 * which page to open, in which year. Any part of One can make one; the
 * chats' nudge is the first. The rules are in `domain/go-links.ts`: a link
 * is a shortcut after the normal sign-in, never a key.
 */

type Db = ReturnType<typeof whatsappDb>;

export type GoLink = { code: string; url: string };

/**
 * A new link to `path` (an internal path only), for `staffId` when it is
 * meant for one person, opening in `sessionLabel` when given. Null when the
 * path is not one a link may open, or the link could not be written.
 */
export async function createGoLink(
  input: { path: string; purpose: GoPurpose; staffId: string | null; sessionLabel: string | null; days?: number },
  db: Db = whatsappDb(),
): Promise<GoLink | null> {
  const path = safeGoPath(input.path);
  if (!path) return null;
  const days = Math.min(Math.max(input.days ?? GO_LINK_DAYS, 1), 30);
  const label = input.sessionLabel && /^[A-Za-z0-9-]{4,40}$/.test(input.sessionLabel) ? input.sessionLabel : null;
  // Two tries: a clash between two random ten-letter codes is all but impossible, but costs nothing to survive.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const code = goCodeFrom(randomBytes(10));
    const now = Date.now();
    const { error } = await db.from("go_links").insert({
      code,
      path,
      session_label: label,
      staff_id: input.staffId && isUuid(input.staffId) ? input.staffId : null,
      purpose: input.purpose,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + days * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (!error) return { code, url: goLinkUrl(code) };
    if (error.code !== "23505") return null;
  }
  return null;
}

export type OpenedGoLink = { path: string; sessionLabel: string | null; staffId: string | null; purpose: string };

/** Where a link goes, counted as used; null when the code is unknown or past its week. */
export async function openGoLink(code: string, db: Db = whatsappDb()): Promise<OpenedGoLink | null> {
  if (!isGoCode(code)) return null;
  const { data, error } = await db.rpc("go_link_open", { p_code: code });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { path?: unknown; session_label?: unknown; staff_id?: unknown; purpose?: unknown };
  const path = typeof row.path === "string" ? safeGoPath(row.path) : null;
  if (!path) return null;
  return {
    path,
    sessionLabel: typeof row.session_label === "string" ? row.session_label : null,
    staffId: typeof row.staff_id === "string" ? row.staff_id : null,
    purpose: typeof row.purpose === "string" ? row.purpose : "screen",
  };
}
