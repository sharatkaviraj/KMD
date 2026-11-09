import { toE164 } from "@/platform/messaging/parent-send-gate";

/**
 * The two numbers that matter, and the one rule about them (D-562).
 *
 * One sends from the school's own WhatsApp number. The fees app keeps its own
 * AiSensy number and nothing in One may ever send from it or to it: a message
 * that went out from the wrong number would look to a parent like the fees app
 * had sent it, and the fees app's AiSensy plan would pay for it.
 */

/** "Veer Patta School", the school's own WhatsApp Cloud API number. */
export const SCHOOL_WHATSAPP_NUMBER = "+918302207823";

/** The live fees app's AiSensy number. Never a sender or a recipient of One's. */
export const FEES_AISENSY_NUMBER = "+918047136289";

export { toE164 };

/** Meta's `to` and `wa_id`: the digits alone, country code first. */
export function waDigits(e164: string): string {
  return e164.replace(/\D/g, "");
}

/** A WhatsApp `wa_id` or `display_phone_number` ("918302207823", "+91 83022 07823") as E.164. */
export function fromWaId(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}

/** `+91 ••••• •7823`: enough for staff to recognise a number, not enough to copy it. */
export function maskNumber(e164: string | null | undefined): string {
  const phone = toE164(e164 ?? "") ?? fromWaId(e164);
  if (!phone) return "—";
  const last = phone.slice(-4);
  return phone.startsWith("+91") ? `+91 ••••• •${last}` : `+${"•".repeat(Math.max(0, phone.length - 5))}${last}`;
}

/** The same number, however it is written. */
export function sameNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = toE164(a ?? "") ?? fromWaId(a);
  const right = toE164(b ?? "") ?? fromWaId(b);
  return left !== null && left === right;
}
