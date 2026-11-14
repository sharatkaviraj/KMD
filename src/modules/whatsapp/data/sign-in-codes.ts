import "server-only";

import { createHash, randomInt, randomUUID } from "node:crypto";

import {
  newSignInCode,
  requestAnswer,
  signInPhoneKey,
  SIGN_IN_TEMPLATE,
  isSignInMode,
  verifyAnswer,
  type RequestAnswer,
  type SignInLanguage,
  type SignInMode,
  type VerifyAnswer,
} from "@/modules/whatsapp/domain/sign-in-code";
import { logInfo, logWarn } from "@/platform/observability/log";
import { readWhatsAppConfig } from "@/platform/whatsapp/config";
import { templateMessageBody } from "@/platform/whatsapp/payload";
import { providerFor, type ProviderSendResult } from "@/platform/whatsapp/providers";
import { readTemplateRow, whatsappDb } from "@/platform/whatsapp/store";

/**
 * Sign in with a WhatsApp code (D-585): the database and the WhatsApp side.
 * The rules are in `domain/sign-in-code.ts` and the SQL.
 *
 * The code exists in exactly two places: this process, for the few hundred
 * milliseconds between making it and handing it to the hub, and the person's
 * WhatsApp. The database keeps a SHA-256 of the row's id and the code, and
 * nothing here logs it. The hub keeps "[Sign-in code sent. The code is
 * hidden.]" (hub PR 4). A send is never written to `whatsapp_messages`, the
 * message log every other send goes to, because that log keeps the blanks.
 */

type Db = ReturnType<typeof whatsappDb>;

/** The hash the database compares: the row's own id and the code, so one code's hash is no use on another row. */
export function signInCodeHash(challengeId: string, code: string): string {
  return createHash("sha256").update(`${challengeId}:${code}`).digest("hex");
}

/** The browser's address, hashed: enough to count asks from one place, nothing to read back. */
export function signInClientKey(address: string): string {
  return createHash("sha256").update(`vpps-sign-in:${address || "unknown"}`).digest("hex").slice(0, 32);
}

/**
 * Who can get a code now. Off when the setting cannot be read, or One has no
 * working WhatsApp connection: the page then shows email and password only,
 * rather than a way in that cannot send anything.
 */
export async function readSignInMode(db: Db = whatsappDb()): Promise<SignInMode> {
  if (!readWhatsAppConfig().ok) return "off";
  try {
    const { data, error } = await db.from("staff_sign_in_settings").select("mode").eq("id", true).maybeSingle<{ mode: string }>();
    if (error || !data) return "off";
    return isSignInMode(data.mode) ? data.mode : "off";
  } catch {
    return "off";
  }
}

let pageMode: { mode: SignInMode; at: number } | null = null;

/**
 * The sign-in page's copy of the setting, kept for 30 seconds in this server
 * instance so opening /login costs no query most of the time. Only what the
 * page *shows* waits; asking for a code reads the setting itself, and the SQL
 * decides again.
 */
export async function readSignInModeForPage(): Promise<SignInMode> {
  if (pageMode && Date.now() - pageMode.at < 30_000) return pageMode.mode;
  let mode: SignInMode = "off";
  try {
    mode = await readSignInMode();
  } catch {
    mode = "off";
  }
  pageMode = { mode, at: Date.now() };
  return mode;
}

/** Settings -> WhatsApp. The caller has checked the admin. */
export async function writeSignInMode(mode: SignInMode, actorId: string, db: Db = whatsappDb()): Promise<boolean> {
  const { data, error } = await db
    .from("staff_sign_in_settings")
    .update({ mode, updated_at: new Date().toISOString(), updated_by: actorId })
    .eq("id", true)
    .select("mode");
  const saved = !error && Array.isArray(data) && data.length === 1;
  if (saved) pageMode = null;
  return saved;
}

/** The setting as the admin card shows it: the mode, who changed it, and how many staff could sign in this way. */
export async function readSignInOverview(db: Db = whatsappDb()): Promise<{
  mode: SignInMode;
  updatedAt: string | null;
  staffWithNumber: number | null;
  staffTotal: number | null;
  templates: Array<{ key: string; status: string }>;
  signedInThisWeek: number | null;
  refusedThisWeek: number | null;
}> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [setting, staff, templates, used, refused] = await Promise.all([
    db.from("staff_sign_in_settings").select("mode, updated_at").eq("id", true).maybeSingle<{ mode: string; updated_at: string | null }>(),
    db.from("staff_profiles").select("phone, whatsapp_phone").eq("is_active", true).eq("is_test_account", false).not("user_id", "is", null),
    db.from("whatsapp_templates").select("key, status").in("key", Object.values(SIGN_IN_TEMPLATE)),
    db
      .from("staff_sign_in_codes")
      .select("id", { count: "exact", head: true })
      .not("used_at", "is", null)
      .gte("used_at", weekAgo),
    db.from("staff_sign_in_codes").select("id", { count: "exact", head: true }).eq("send_status", "refused").gte("created_at", weekAgo),
  ]);
  const rows = Array.isArray(staff.data) ? (staff.data as Array<{ phone: string | null; whatsapp_phone: string | null }>) : null;
  return {
    mode: isSignInMode(setting.data?.mode) ? setting.data.mode : "off",
    updatedAt: setting.data?.updated_at ?? null,
    staffWithNumber: rows ? rows.filter((row) => signInPhoneKey(row.whatsapp_phone ?? row.phone) !== null).length : null,
    staffTotal: rows ? rows.length : null,
    templates: Array.isArray(templates.data) ? (templates.data as Array<{ key: string; status: string }>) : [],
    signedInThisWeek: used.error ? null : (used.count ?? 0),
    refusedThisWeek: refused.error ? null : (refused.count ?? 0),
  };
}

export type RequestedCode = {
  answer: RequestAnswer;
  /** Set for every answer that wrote a row ("sent"), whether or not a code went: the page cannot tell them apart. */
  challengeId: string | null;
  retryAfterSeconds: number | null;
  /** The send itself, for `after()`: present only when a code is to go. */
  deliver: (() => Promise<void>) | null;
};

/** Somebody typed a number and pressed Send code. */
export async function requestSignInCode(
  input: { phone: string; language: SignInLanguage; clientKey: string; /** The mode the page read, for what it may say (`requestAnswer`). */ mode?: SignInMode },
  db: Db = whatsappDb(),
): Promise<RequestedCode> {
  const key = signInPhoneKey(input.phone);
  if (!key) return { answer: "bad_number", challengeId: null, retryAfterSeconds: null, deliver: null };
  const challengeId = randomUUID();
  const code = newSignInCode(randomInt);
  const { data, error } = await db.rpc("request_staff_sign_in_code", {
    p_id: challengeId,
    p_phone: key,
    p_client_key: input.clientKey,
    p_code_hash: signInCodeHash(challengeId, code),
    p_language: input.language,
  });
  if (error) {
    logWarn("sign_in_code.request_failed", { code: error.code ?? null });
    return { answer: "unavailable", challengeId: null, retryAfterSeconds: null, deliver: null };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { outcome: string; staff_profile_id: string | null; phone_key: string | null; retry_after_seconds: number | null }
    | undefined;
  const answer = requestAnswer(row?.outcome, input.mode);
  logInfo("sign_in_code.requested", { outcome: row?.outcome ?? null });
  return {
    answer,
    challengeId: answer === "sent" ? challengeId : null,
    retryAfterSeconds: row?.retry_after_seconds ?? null,
    deliver: row?.outcome === "send" && row.phone_key ? () => deliverSignInCode(challengeId, row.phone_key!, code, input.language, db) : null,
  };
}

/** Hand one code to the hub and note what it said. Never throws: the page has already answered. */
export async function deliverSignInCode(challengeId: string, phoneKey: string, code: string, language: SignInLanguage, db: Db = whatsappDb()): Promise<void> {
  const note = async (patch: { send_status: "accepted" | "refused" | "unknown"; send_error?: string | null; provider_message_id?: string | null }) => {
    const scrubbed = patch.send_error ? patch.send_error.split(code).join("••••••").slice(0, 300) : null;
    await db
      .from("staff_sign_in_codes")
      .update({ ...patch, send_error: scrubbed })
      .eq("id", challengeId)
      .then(
        () => undefined,
        () => undefined,
      );
  };
  try {
    const config = readWhatsAppConfig();
    if (!config.ok) {
      await note({ send_status: "refused", send_error: `not_configured: ${config.code}` });
      return;
    }
    // The person's own language first; the other one if only that one is approved yet.
    const order: SignInLanguage[] = language === "en" ? ["en", "hi"] : ["hi", "en"];
    let template: { provider_name: string; language_code: string } | null = null;
    for (const choice of order) {
      const row = await readTemplateRow(SIGN_IN_TEMPLATE[choice], db).catch(() => null);
      if (row && row.status === "approved") {
        template = row;
        break;
      }
    }
    if (!template) {
      await note({ send_status: "refused", send_error: "template_not_approved" });
      return;
    }
    const body = templateMessageBody({
      to: `+91${phoneKey}`,
      name: template.provider_name,
      languageCode: template.language_code,
      bodyParams: [code],
      // The Copy code button carries the code too (Meta's copy-code template).
      urlButtonSuffix: code,
    });
    const result: ProviderSendResult = await providerFor(config).send(body);
    if (config.provider === "mock" && process.env.NODE_ENV !== "production") {
      // Nothing left this computer (the mock refuses a live deployment), so the
      // only way to try the page locally is to see the code here.
      console.info(`[sign-in code, mock WhatsApp, not sent] ${code}`);
    }
    if (result.outcome === "accepted") {
      await note({ send_status: "accepted", provider_message_id: result.messageId });
    } else if (result.outcome === "rejected") {
      await note({ send_status: "refused", send_error: [result.errorCode, result.errorTitle].filter(Boolean).join(": ") || `http ${result.httpStatus}` });
      logWarn("sign_in_code.refused", { code: result.errorCode ?? null, status: result.httpStatus });
    } else {
      await note({ send_status: "unknown", send_error: result.errorTitle });
    }
  } catch (caught) {
    await note({ send_status: "unknown", send_error: caught instanceof Error ? caught.message : "send failed" });
  } finally {
    await clearOldSignInRows(db);
  }
}

/** Rows older than 30 days go, a few at a time, after a send. */
async function clearOldSignInRows(db: Db): Promise<void> {
  await db
    .from("staff_sign_in_codes")
    .delete()
    .lt("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
    .then(
      () => undefined,
      () => undefined,
    );
}

export type CheckedCode = { answer: VerifyAnswer; triesLeft: number | null; staffProfileId: string | null; userId: string | null };

/** The code the person typed, against the row their browser holds. */
export async function verifySignInCode(challengeId: string, code: string, db: Db = whatsappDb()): Promise<CheckedCode> {
  const { data, error } = await db.rpc("verify_staff_sign_in_code", { p_id: challengeId, p_code_hash: signInCodeHash(challengeId, code) });
  if (error) {
    logWarn("sign_in_code.verify_failed", { code: error.code ?? null });
    return { answer: "unavailable", triesLeft: null, staffProfileId: null, userId: null };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { outcome: string; staff_profile_id: string | null; user_id: string | null; tries_left: number | null }
    | undefined;
  const answer = verifyAnswer(row?.outcome);
  logInfo("sign_in_code.checked", { outcome: row?.outcome ?? null });
  return {
    answer,
    triesLeft: row?.tries_left ?? null,
    staffProfileId: answer === "ok" ? (row?.staff_profile_id ?? null) : null,
    userId: answer === "ok" ? (row?.user_id ?? null) : null,
  };
}
