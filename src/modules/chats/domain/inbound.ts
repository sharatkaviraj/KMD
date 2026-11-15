import type { ChatKind, ChatMedia } from "./types";

/**
 * A parent's WhatsApp message as a line in a chat (D-616). Pure.
 *
 * Meta sends each kind of message in its own shape; a chat keeps what a
 * person at school needs to read it: the words (a photo's or a file's
 * caption too), the file's WhatsApp id for One to fetch it through the hub,
 * a place's map point, a shared contact's name and number. A reaction, a
 * system note or anything else that is not a message is no line at all.
 */

export type InboundContent = {
  kind: ChatKind;
  body: string | null;
  media: ChatMedia | null;
  meta: Record<string, unknown>;
};

/** A parent's message, ready to be added to a chat. */
export type ChatInboundMessage = InboundContent & { wamid: string; at: string; replyTo: string | null };

/** The hub's file ids are Meta's: digits only. */
const MEDIA_ID = /^\d{5,25}$/;
const MEDIA_KINDS: ReadonlySet<string> = new Set(["image", "video", "document", "audio", "sticker"]);

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function words(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\u0000/g, "").trim();
  return clean ? clean.slice(0, max) : null;
}

function coordinate(value: unknown, limit: number): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && Math.abs(number) <= limit ? Math.round(number * 1e6) / 1e6 : null;
}

function mediaOf(type: string, raw: Record<string, unknown>): ChatMedia {
  const media = record(raw[type]);
  const id = words(media.id, 25);
  return {
    mediaId: id && MEDIA_ID.test(id) ? id : null,
    mime: words(media.mime_type, 100)?.split(";")[0]?.trim().toLowerCase() ?? null,
    filename: type === "document" ? words(media.filename, 120) : null,
  };
}

/**
 * What a parent's message says, as a chat line, or null when it is not a
 * message (a reaction, a system note, an order, anything unknown).
 */
export function inboundContent(input: { type: string; text: string | null; raw: Record<string, unknown> | null | undefined }): InboundContent | null {
  const raw = input.raw ?? {};
  const text = words(input.text, 4096);
  if (input.type === "text") return text ? { kind: "text", body: text, media: null, meta: {} } : null;
  if (input.type === "interactive" || input.type === "button") return text ? { kind: "tap", body: text, media: null, meta: {} } : null;
  if (MEDIA_KINDS.has(input.type)) {
    const media = mediaOf(input.type, raw);
    const meta: Record<string, unknown> = input.type === "audio" ? { voice: record(raw.audio).voice === true } : {};
    // A sticker carries no words; a photo, a video or a file may.
    return { kind: input.type as ChatKind, body: input.type === "sticker" ? null : text, media, meta };
  }
  if (input.type === "location") {
    const place = record(raw.location);
    const lat = coordinate(place.latitude, 90);
    const lng = coordinate(place.longitude, 180);
    const name = words(place.name, 120);
    const address = words(place.address, 200);
    if (lat === null || lng === null) return null;
    return { kind: "location", body: [name, address].filter(Boolean).join(", ") || null, media: null, meta: { lat, lng } };
  }
  if (input.type === "contacts") {
    const people = list(raw.contacts)
      .slice(0, 5)
      .map((item) => {
        const contact = record(item);
        const name = words(record(contact.name).formatted_name, 80) ?? words(record(contact.name).first_name, 80);
        const phones = list(contact.phones)
          .slice(0, 3)
          .map((phone) => words(record(phone).phone, 30) ?? words(record(phone).wa_id, 30))
          .filter((phone): phone is string => phone !== null);
        return { name, phones };
      })
      .filter((person) => person.name || person.phones.length > 0);
    if (people.length === 0) return null;
    return { kind: "contacts", body: people.map((person) => person.name ?? person.phones[0]).join(", "), media: null, meta: { contacts: people } };
  }
  // A poll, a view-once photo, a new message type: the parent sent something WhatsApp will not pass on.
  if (input.type === "unsupported") return { kind: "other", body: null, media: null, meta: {} };
  return null;
}

/** A Google Maps link for a shared place, for staff to open. */
export function mapLink(meta: Record<string, unknown>): string | null {
  const lat = coordinate(meta.lat, 90);
  const lng = coordinate(meta.lng, 180);
  return lat === null || lng === null ? null : `https://www.google.com/maps?q=${lat},${lng}`;
}
