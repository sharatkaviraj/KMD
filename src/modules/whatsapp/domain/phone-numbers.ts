/**
 * Reading a family's numbers: the key a number is stored under, why one cannot
 * be messaged, and which of the two a reminder goes to.
 *
 * A file of its own, not more of `./phone`: the send screen's test panel is a
 * client component that imports `toWhatsappDestination` from there, on a route
 * whose gzip ceiling only ratchets down. Nothing it does not use may sit beside
 * it. Pure and browser-safe, like `./phone` — the fix sheet checks a number as
 * it is typed.
 */

import { toWhatsappDestination } from "@/modules/whatsapp/domain/phone";

/**
 * The last ten digits of a number, or null — the key `whatsapp_number_health`
 * is stored under, and the same as the database's `private.whatsapp_phone_key`.
 * One number however it was typed: `+91 90000 00001`, `919000000001`, `9000000001`.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/[^0-9]/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/**
 * Which of a family's two numbers a reminder goes to.
 *
 * The father's, unless it is not a mobile or WhatsApp has said it cannot use it
 * (`deadCauseFor` — `whatsapp_number_health`), then the mother's on the same
 * terms. ONE rule for the audience that sends and the failure desk that
 * predicts where a resend will go, so "Resend to mother's number" on the desk is
 * what the send then does.
 */
export function pickFamilyNumber(
  fatherPhone: string | null | undefined,
  motherPhone: string | null | undefined,
  deadCauseFor: (key: string) => string | undefined,
): {
  fatherUsable: string | null;
  motherUsable: string | null;
  fatherDead: string | undefined;
  motherDead: string | undefined;
  /** Where the next message goes, or null when nothing on record works. */
  destination: string | null;
  /** Which parent that is. */
  parent: "father" | "mother" | null;
  /** The working number NOT chosen, for the second-number escalation. */
  other: string | null;
} {
  const fatherUsable = toWhatsappDestination(fatherPhone);
  const motherUsable = toWhatsappDestination(motherPhone);
  const fatherDead = fatherUsable ? deadCauseFor(phoneKey(fatherUsable) ?? "") : undefined;
  const motherDead = motherUsable ? deadCauseFor(phoneKey(motherUsable) ?? "") : undefined;
  const father = fatherUsable && !fatherDead ? fatherUsable : null;
  const mother = motherUsable && !motherDead ? motherUsable : null;
  const destination = father ?? mother;
  return {
    fatherUsable,
    motherUsable,
    fatherDead,
    motherDead,
    destination,
    parent: father ? "father" : mother ? "mother" : null,
    other: [father, mother].find((number) => number && number !== destination) ?? null,
  };
}

/** Why a typed number cannot be messaged, in a sentence the office can act on. */
export function explainUnusablePhone(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (toWhatsappDestination(raw)) return null;
  if (digits.length < 10) return `${digits.length} digits. A mobile number has 10.`;
  const ten = digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits.slice(-10);
  if (ten.length === 10 && !/^[6-9]/.test(ten)) {
    return `Starts with ${ten[0]}. An Indian mobile starts with 6, 7, 8 or 9.`;
  }
  return "Not a mobile number WhatsApp can reach.";
}
