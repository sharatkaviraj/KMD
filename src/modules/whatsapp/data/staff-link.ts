import "server-only";

import { randomInt } from "node:crypto";

import QRCode from "qrcode";

import { hasConsent } from "@/modules/staff-notices/domain/gates";
import { staffLanguage, type StaffLanguage } from "@/modules/whatsapp/domain/helper-handoff";
import type { ChatPatch } from "@/modules/whatsapp/domain/helper-plan";
import {
  LINK_CODE_MINUTES,
  isLinkCode,
  linkCodeIn,
  linkMessage,
  linkOutcome,
  linkReplyText,
  linkUrl,
  newLinkCode,
  showLinkCode,
  SCHOOL_NUMBER_SHOWN,
  type LinkOutcome,
} from "@/modules/whatsapp/domain/staff-link";
import { logInfo } from "@/platform/observability/log";
import { readWhatsAppConfig, type WhatsAppConfig } from "@/platform/whatsapp/config";
import { maskNumber, toE164 } from "@/platform/whatsapp/numbers";
import { textMessageBody } from "@/platform/whatsapp/payload";
import { checkWhatsAppSend, type WhatsAppSwitches } from "@/platform/whatsapp/policy";
import { providerFor, type ClaimResult, type ProviderSendResult } from "@/platform/whatsapp/providers";
import { readSwitches, whatsappDb } from "@/platform/whatsapp/store";
import type { WebhookInbound } from "@/platform/whatsapp/webhook";

import { finishTurn, readHelperSettings, saveChat, startTurn, type TurnFinish } from "./helper-store";

/**
 * Link my WhatsApp (D-582), the database and the WhatsApp side. The rules and
 * the words are in `domain/staff-link.ts`.
 *
 *  - `startStaffLink`: a member of staff tapped Link my WhatsApp. A new code
 *    for them, their older open ones gone, and what the screen shows: the
 *    message, the wa.me link, and a QR code for a computer.
 *  - `staffLinkStatus`: the screen asking whether the code has arrived.
 *  - `handleStaffLink`: a message to the school's number that carries a code
 *    (the helper's turn hands it every one). The number it came from is
 *    linked whatever the switches say: that writes One's own record and sends
 *    nothing. It is answered on WhatsApp only when the helper may answer
 *    (its switch, practice mode, real recipients), as every message is.
 */

type Db = ReturnType<typeof whatsappDb>;

export type StartedLink = {
  code: string;
  /** `ABCD-2345`. */
  shown: string;
  message: string;
  url: string;
  /** The wa.me link as a QR code, an SVG data URL, for scanning from a computer screen. */
  qr: string | null;
  expiresAt: string;
  /** The school's number as people write it, for sending the message by hand. */
  to: string;
};

async function qrFor(url: string): Promise<string | null> {
  try {
    const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  } catch {
    return null;
  }
}

/** A fresh code for this person; null when it could not be saved. */
export async function startStaffLink(
  staffId: string,
  language: StaffLanguage,
  db: Db = whatsappDb(),
  pick: (below: number) => number = randomInt,
): Promise<StartedLink | null> {
  try {
    // Their earlier open codes go: only the newest one on the screen works.
    await db.from("staff_whatsapp_links").delete().eq("staff_profile_id", staffId).is("used_at", null);
    // And anybody's that ran out over a day ago, so the table stays small.
    await db
      .from("staff_whatsapp_links")
      .delete()
      .is("used_at", null)
      .lt("expires_at", new Date(Date.now() - 24 * 3_600_000).toISOString());
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = newLinkCode(pick);
      const expiresAt = new Date(Date.now() + LINK_CODE_MINUTES * 60_000).toISOString();
      const { error } = await db.from("staff_whatsapp_links").insert({ code, staff_profile_id: staffId, expires_at: expiresAt });
      if (error) {
        if (error.code === "23505") continue;
        return null;
      }
      return await shownLink(code, expiresAt, language);
    }
    return null;
  } catch {
    return null;
  }
}

/** What the screen shows for a code: the same words and link whenever it is drawn. */
async function shownLink(code: string, expiresAt: string, language: StaffLanguage): Promise<StartedLink> {
  const url = linkUrl(code, language);
  return { code, shown: showLinkCode(code), message: linkMessage(code, language), url, qr: await qrFor(url), expiresAt, to: SCHOOL_NUMBER_SHOWN };
}

/**
 * Their newest code that is still open (not used, not run out), so a screen
 * opened again, or a phone that dropped the page while WhatsApp was open,
 * goes back to waiting for it instead of starting over.
 */
export async function readOpenLink(staffId: string, language: StaffLanguage, db: Db = whatsappDb()): Promise<StartedLink | null> {
  try {
    const { data, error } = await db
      .from("staff_whatsapp_links")
      .select("code, expires_at")
      .eq("staff_profile_id", staffId)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ code: string; expires_at: string }>();
    if (error || !data || !isLinkCode(data.code)) return null;
    return await shownLink(data.code, data.expires_at, language);
  } catch {
    return null;
  }
}

/** Cancel: their open codes go, so a message already typed in WhatsApp links nothing. */
export async function cancelStaffLink(staffId: string, db: Db = whatsappDb()): Promise<boolean> {
  try {
    const { error } = await db.from("staff_whatsapp_links").delete().eq("staff_profile_id", staffId).is("used_at", null);
    return !error;
  } catch {
    return false;
  }
}

export type LinkStatus =
  | { state: "waiting"; expiresAt: string }
  | { state: "linked"; number: string }
  | { state: "expired" }
  /** Replaced by a newer code, or never theirs. */
  | { state: "gone" };

/** Whether this person's code has come in from WhatsApp yet. */
export async function staffLinkStatus(staffId: string, code: string, db: Db = whatsappDb()): Promise<LinkStatus | null> {
  const wanted = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!isLinkCode(wanted)) return { state: "gone" };
  try {
    const { data, error } = await db
      .from("staff_whatsapp_links")
      .select("expires_at, used_at, used_from")
      .eq("code", wanted)
      .eq("staff_profile_id", staffId)
      .maybeSingle<{ expires_at: string; used_at: string | null; used_from: string | null }>();
    if (error) return null;
    if (!data) return { state: "gone" };
    if (data.used_at) return { state: "linked", number: maskNumber(data.used_from) };
    if (Date.parse(data.expires_at) <= Date.now()) return { state: "expired" };
    return { state: "waiting", expiresAt: data.expires_at };
  } catch {
    return null;
  }
}

export type WhatsappLinkCard = {
  /**
   * linked: a number and a yes (from their phone, or recorded another way:
   * `source`). stopped: a number, then they turned it off. none: no number,
   * or a number nobody has said yes for.
   */
  state: "linked" | "stopped" | "none";
  /** `+91 ••••• •1234`, never the whole number. */
  number: string | null;
  /** When the yes (or the stop) was recorded: an instant, shown as a day on the school's clock. */
  since: string | null;
  /**
   * How the yes was given: 'whatsapp' when the number on file is the one their
   * own phone sent its code from (the database records that yes as 'self',
   * D-582), else the consent source as recorded.
   */
  source: string | null;
};

/** What the Link my WhatsApp card shows for this person. Null when it could not be read. */
export async function readWhatsappLinkCard(staffId: string, db: Db = whatsappDb()): Promise<WhatsappLinkCard | null> {
  try {
    const [profile, sent] = await Promise.all([
      db
        .from("staff_profiles")
        .select("whatsapp_phone, phone, whatsapp_opt_in_at, whatsapp_opt_in_source, whatsapp_opt_out_at")
        .eq("id", staffId)
        .maybeSingle<{
          whatsapp_phone: string | null;
          phone: string | null;
          whatsapp_opt_in_at: string | null;
          whatsapp_opt_in_source: string | null;
          whatsapp_opt_out_at: string | null;
        }>(),
      // The newest code they sent from their phone, and the number it came from.
      db
        .from("staff_whatsapp_links")
        .select("used_from")
        .eq("staff_profile_id", staffId)
        .not("used_at", "is", null)
        .order("used_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ used_from: string | null }>(),
    ]);
    const { data, error } = profile;
    if (error || !data) return null;
    // The number every staff message goes to: the WhatsApp one, else the phone on file.
    const number = toE164(data.whatsapp_phone ?? "") ?? toE164(data.phone ?? "");
    if (!number) return { state: "none", number: null, since: null, source: null };
    const fromPhone = !sent.error && Boolean(sent.data?.used_from) && sent.data?.used_from === number;
    const source = fromPhone ? "whatsapp" : data.whatsapp_opt_in_source;
    const consent = hasConsent({ optInAt: data.whatsapp_opt_in_at, optOutAt: data.whatsapp_opt_out_at });
    if (consent === "yes") {
      return { state: "linked", number: maskNumber(number), since: data.whatsapp_opt_in_at, source };
    }
    return {
      state: consent === "opted_out" ? "stopped" : "none",
      number: maskNumber(number),
      since: consent === "opted_out" ? data.whatsapp_opt_out_at : null,
      source,
    };
  } catch {
    return null;
  }
}

/**
 * Whether Veer Patta AI's alerts reach real staff yet: its switch on, practice
 * off, real recipients on. Until then the card says the number is ready and
 * nothing comes, rather than promising messages that are not sent.
 */
export async function staffAlertsLive(): Promise<boolean> {
  const switches = await readSwitches().catch(() => null);
  return Boolean(switches?.features.parent_helper && !switches.dryRun && switches.realRecipients);
}

/** Everything the Link my WhatsApp card needs, read side by side. */
export type WhatsappLinkView = {
  card: WhatsappLinkCard | null;
  /** A code made earlier and still waiting, if any. */
  pending: StartedLink | null;
  /** Veer Patta AI's alerts reach real staff now. */
  live: boolean;
};

/**
 * `lookOnly`: an administrator seeing One as this person (D-544). Their open
 * code is never read for that view: it would let the viewer's own phone link
 * itself to them.
 */
export async function loadWhatsappLink(staffId: string, language: StaffLanguage, lookOnly = false): Promise<WhatsappLinkView> {
  const [card, pending, live] = await Promise.all([
    readWhatsappLinkCard(staffId),
    lookOnly ? Promise.resolve(null) : readOpenLink(staffId, language),
    staffAlertsLive(),
  ]);
  return { card, pending, live };
}

export type LinkResult = {
  outcome: LinkOutcome;
  staffId: string | null;
  name: string | null;
  language: string | null;
  isTest: boolean | null;
};

/** `vppsone.link_staff_whatsapp`: the code and the number it came from, in one transaction. */
export async function linkStaffWhatsapp(code: string, from: string, db: Db = whatsappDb()): Promise<LinkResult> {
  try {
    const { data, error } = await db
      .rpc("link_staff_whatsapp", { p_code: code, p_from: from })
      .maybeSingle<{ outcome: string; staff_profile_id: string | null; display_name: string | null; preferred_language: string | null; is_test_account: boolean | null }>();
    if (error || !data) return { outcome: "error", staffId: null, name: null, language: null, isTest: null };
    return {
      outcome: linkOutcome(data.outcome),
      staffId: data.staff_profile_id,
      name: data.display_name,
      language: data.preferred_language,
      isTest: data.is_test_account,
    };
  } catch {
    return { outcome: "error", staffId: null, name: null, language: null, isTest: null };
  }
}

/* ------------------------------------------------------------ from WhatsApp */

/** Everything a link message reads and writes, so a test can stand in for each. */
export type StaffLinkDeps = {
  now: () => Date;
  link: (code: string, from: string) => Promise<LinkResult>;
  readSwitches: () => Promise<WhatsAppSwitches | null>;
  readConfig: () => WhatsAppConfig;
  readHelperName: () => Promise<string>;
  /** Null when the provider cannot claim a message (only the hub can). */
  claim: ((wamid: string) => Promise<ClaimResult>) | null;
  send: (body: Record<string, unknown>) => Promise<ProviderSendResult>;
  startTurn: typeof startTurn;
  finishTurn: (providerMessageId: string, finish: TurnFinish) => Promise<void>;
  saveChat: (from: string, patch: ChatPatch, at: Date) => Promise<void>;
};

export function liveStaffLinkDeps(config: WhatsAppConfig = readWhatsAppConfig()): StaffLinkDeps {
  const provider = config.ok ? providerFor(config) : null;
  const claimMessage = provider?.claimMessage;
  return {
    now: () => new Date(),
    link: async (code, from) => {
      const result = await linkStaffWhatsapp(code, from);
      // Any other code they still had open goes too, so no screen goes back to waiting on it.
      if (result.outcome === "linked" && result.staffId) await cancelStaffLink(result.staffId);
      return result;
    },
    readSwitches: () => readSwitches(),
    readConfig: () => config,
    readHelperName: async () => (await readHelperSettings())?.helperName ?? "Veer Patta AI",
    claim: claimMessage ? (wamid) => claimMessage(wamid) : null,
    send: (body) =>
      provider
        ? provider.send(body)
        : Promise.resolve({ outcome: "unknown", httpStatus: null, errorCode: "network", errorTitle: "WhatsApp is not set up here." }),
    startTurn: (row) => startTurn(row),
    finishTurn: (id, finish) => finishTurn(id, finish),
    saveChat: (from, patch, at) => saveChat(from, patch, at),
  };
}

export type StaffLinkOutcome =
  | { outcome: "skipped"; reason: string }
  | { outcome: "not_claimed"; reason: string }
  | { outcome: "answered"; route: "rule"; intent: string; handoff: null }
  | { outcome: "failed"; reason: string };

const DEVANAGARI = /[ऀ-ॿ]/;

function claimNote(claim: ClaimResult | null): string {
  if (!claim) return "claim_failed:network";
  if (!claim.ok) return `claim_failed:${claim.httpStatus ?? "network"}`;
  if (claim.staff) return "staff_handling";
  if (claim.stale) return "stale";
  return `taken_by:${claim.takenBy ?? "other"}`;
}

/**
 * A message that carries a link code. Null when it carries none, or only
 * looks like one (a bare code nobody made): then it is an ordinary message.
 */
export async function handleStaffLink(message: WebhookInbound, deps: StaffLinkDeps): Promise<StaffLinkOutcome | null> {
  if (message.type !== "text") return null;
  const found = linkCodeIn(message.text);
  if (!found) return null;
  const from = toE164(message.from);
  if (!from) return null;

  const result = await deps.link(found.code, from);
  if (!found.labelled && (result.outcome === "no_code" || result.outcome === "error")) return null;

  const sentAt = Date.parse(message.at);
  const wroteAt = Number.isFinite(sentAt) ? new Date(sentAt) : deps.now();
  // Their chat with the school is open now, so the next alert to them can be typed.
  if (result.outcome === "linked" || result.outcome === "already_linked") {
    await deps.saveChat(from, {}, wroteAt).catch(() => undefined);
  }

  const language: StaffLanguage = result.language ? staffLanguage(result.language) : DEVANAGARI.test(message.text ?? "") ? "hi" : "en";
  const switches = await deps.readSwitches().catch(() => null);
  const verdict = checkWhatsAppSend({ feature: "parent_helper", to: from, switches, config: deps.readConfig(), kind: "text", wroteInLast24h: true });
  logInfo("whatsapp.staff_link", { outcome: result.outcome, from: maskNumber(from), reply: verdict.decision, test: result.isTest });
  // Linked either way; the hub's bot answers when One may not.
  if (verdict.decision !== "send" || !deps.claim) return { outcome: "skipped", reason: `staff_link_${result.outcome}` };

  const ledger = await deps.startTurn({ providerMessageId: message.providerMessageId, from, receivedAt: wroteAt.toISOString(), kind: "text" });
  if (ledger === "duplicate") return { outcome: "skipped", reason: "duplicate" };
  if (ledger === "failed") return { outcome: "skipped", reason: "ledger_failed" };

  const claim = await deps.claim(message.providerMessageId).catch(() => null);
  if (!claim || !claim.ok || !claim.claimed) {
    const reason = claimNote(claim);
    await deps.finishTurn(message.providerMessageId, { status: "not_claimed", reason, intent: "staff_link" });
    return { outcome: "not_claimed", reason };
  }

  const helperName = await deps.readHelperName().catch(() => "Veer Patta AI");
  const name = result.outcome === "linked" ? result.name : null;
  const sent = await deps.send(textMessageBody(from, linkReplyText(result.outcome, language, name, helperName)));
  const finished = deps.now();
  const latencyMs = finished.getTime() - wroteAt.getTime();
  if (sent.outcome !== "accepted") {
    const reason = sent.outcome === "unknown" ? `send_unknown:${sent.errorCode}` : `send_rejected:${sent.errorCode ?? sent.httpStatus}`;
    await deps.finishTurn(message.providerMessageId, { status: "failed", reason, intent: "staff_link", route: "rule", latencyMs });
    return { outcome: "failed", reason };
  }
  await deps.finishTurn(message.providerMessageId, {
    status: "answered",
    reason: result.outcome === "linked" ? null : result.outcome,
    intent: "staff_link",
    route: "rule",
    replyMessageId: sent.messageId,
    latencyMs,
  });
  return { outcome: "answered", route: "rule", intent: "staff_link", handoff: null };
}
