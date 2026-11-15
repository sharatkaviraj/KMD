import { waDigits } from "@/platform/whatsapp/numbers";

/**
 * A message from school as WhatsApp's request (D-616): words, a photo or a
 * file, in Meta's own format, which the school's hub passes on unchanged
 * (`POST /v1/messages` takes text, image and document). Pure, so the exact
 * bytes are pinned by tests rather than found in a refusal from Meta.
 *
 * A photo or a file is fetched by Meta once, at send time, from a link that
 * works for an hour (`chatFileLink`), never a public one.
 */

export type Outgoing =
  | { kind: "text"; text: string }
  | { kind: "image"; link: string; caption: string }
  | { kind: "document"; link: string; filename: string; caption: string };

/** Meta's own limits: a text message, and the words under a photo or a file. */
export const WA_TEXT_LIMIT = 4096;
export const WA_CAPTION_LIMIT = 1024;
const FILENAME_LIMIT = 120;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+$/u, "");
  if (clean.length <= max) return clean;
  let cut = clean.slice(0, Math.max(0, max - 1));
  // Never leave half of an emoji at the end.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.replace(/\s+$/u, "")}…`;
}

/** A link in the words gets WhatsApp's preview card, as it would from a phone. */
function hasLink(text: string): boolean {
  return /https?:\/\/\S/i.test(text);
}

export function outgoingBody(to: string, message: Outgoing): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: waDigits(to) };
  if (message.kind === "text") {
    const body = clip(message.text, WA_TEXT_LIMIT) || "🙏";
    return { ...base, type: "text", text: { preview_url: hasLink(body), body } };
  }
  const caption = clip(message.caption, WA_CAPTION_LIMIT);
  if (message.kind === "image") {
    return { ...base, type: "image", image: { link: message.link, ...(caption ? { caption } : {}) } };
  }
  const filename = message.filename.replace(/\s+/g, " ").trim().slice(0, FILENAME_LIMIT) || "document.pdf";
  return { ...base, type: "document", document: { link: message.link, filename, ...(caption ? { caption } : {}) } };
}
