import { waDigits } from "@/platform/whatsapp/numbers";

/**
 * What Veer Patta AI sends (D-574): plain text, up to three reply buttons, or
 * a menu list, in Meta's WhatsApp Cloud API format, which the school's hub
 * passes through unchanged. Pure, so the exact bytes are pinned by tests.
 *
 * Meta refuses an interactive message that breaks any of its limits (error
 * 131009, "parameter value is not valid"), and a refused reply is a parent
 * left waiting. So every string is cut to its limit HERE, whatever the card
 * that built it asked for: a long class name or a Hindi exam title shortens a
 * line, it never loses the reply.
 */

/** Meta's limits for each part, in characters. */
export const WA_LIMITS = {
  text: 4096,
  body: 1024,
  header: 60,
  footer: 60,
  buttons: 3,
  buttonTitle: 20,
  listButton: 20,
  rows: 10,
  rowTitle: 24,
  rowDescription: 72,
  sectionTitle: 24,
  id: 200,
} as const;

export type HelperButton = { id: string; title: string };
export type HelperRow = { id: string; title: string; description?: string | null };

export type HelperMessage =
  | { kind: "text"; text: string }
  | { kind: "buttons"; body: string; buttons: HelperButton[]; footer?: string | null }
  | { kind: "list"; body: string; button: string; rows: HelperRow[]; section?: string | null; footer?: string | null };

/**
 * `text` cut to `max` characters, with "…" where it was cut. Characters are
 * UTF-16 units, which is never fewer than what Meta counts.
 */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+$/u, "");
  if (clean.length <= max) return clean;
  let cut = clean.slice(0, Math.max(0, max - 1));
  // Never leave half of a surrogate pair (an emoji) at the end.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.replace(/\s+$/u, "")}…`;
}

/** A one-line title: no line breaks, no runs of spaces. */
function line(text: string, max: number): string {
  return clip(text.replace(/\s+/g, " ").trim(), max);
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/** The message as it will go: every limit applied, duplicates dropped, an empty menu turned into text. */
export function fitMessage(message: HelperMessage): HelperMessage {
  if (message.kind === "text") return { kind: "text", text: clip(message.text, WA_LIMITS.text) || "🙏" };

  const footer = message.footer ? line(message.footer, WA_LIMITS.footer) : null;

  // A card longer than an interactive body (three children's fees) goes as
  // plain text, whole: the figures matter more than the buttons under them.
  const body = message.body.replace(/\s+$/u, "");
  if (body.length > WA_LIMITS.body) {
    return { kind: "text", text: clip(footer ? `${body}\n\n_${footer}_` : body, WA_LIMITS.text) };
  }

  if (message.kind === "buttons") {
    const buttons = uniqueBy(
      message.buttons.map((button) => ({ id: button.id.slice(0, WA_LIMITS.id), title: line(button.title, WA_LIMITS.buttonTitle) })),
      // Meta refuses two buttons with the same title as well as the same id.
      (button) => `${button.id}`,
    )
      .filter((button, index, all) => all.findIndex((other) => other.title === button.title) === index)
      .slice(0, WA_LIMITS.buttons);
    if (buttons.length === 0) return { kind: "text", text: body || "🙏" };
    return { kind: "buttons", body: body || "🙏", buttons, footer };
  }

  const rows = uniqueBy(
    message.rows.map((row) => ({
      id: row.id.slice(0, WA_LIMITS.id),
      title: line(row.title, WA_LIMITS.rowTitle),
      description: row.description ? line(row.description, WA_LIMITS.rowDescription) : null,
    })),
    (row) => row.id,
  ).slice(0, WA_LIMITS.rows);
  if (rows.length === 0) return { kind: "text", text: body || "🙏" };
  return {
    kind: "list",
    body: body || "🙏",
    button: line(message.button, WA_LIMITS.listButton) || "Menu",
    rows,
    section: message.section ? line(message.section, WA_LIMITS.sectionTitle) : null,
    footer,
  };
}

/** The request body for the hub's `POST /v1/messages` (Meta's own format). */
export function helperMessageBody(to: string, message: HelperMessage): Record<string, unknown> {
  const fitted = fitMessage(message);
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: waDigits(to) };
  if (fitted.kind === "text") {
    return { ...base, type: "text", text: { preview_url: false, body: fitted.text } };
  }
  const footer = fitted.footer ? { footer: { text: fitted.footer } } : {};
  if (fitted.kind === "buttons") {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: fitted.body },
        ...footer,
        action: { buttons: fitted.buttons.map((button) => ({ type: "reply", reply: { id: button.id, title: button.title } })) },
      },
    };
  }
  return {
    ...base,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: fitted.body },
      ...footer,
      action: {
        button: fitted.button,
        sections: [
          {
            ...(fitted.section ? { title: fitted.section } : {}),
            rows: fitted.rows.map((row) => ({ id: row.id, title: row.title, ...(row.description ? { description: row.description } : {}) })),
          },
        ],
      },
    },
  };
}

/** The words of a message, for a test or a log line: never sent anywhere. */
export function messageText(message: HelperMessage): string {
  if (message.kind === "text") return message.text;
  if (message.kind === "buttons") return [message.body, ...message.buttons.map((button) => `[${button.title}]`)].join("\n");
  return [message.body, `[${message.button}]`, ...message.rows.map((row) => `- ${row.title}`)].join("\n");
}

/**
 * The same message as plain words, for the one case where Meta refuses the
 * buttons or the list itself. The options become lines the parent can type:
 * a typed "fees" is answered just as a tap is.
 */
export function plainVersion(message: HelperMessage): HelperMessage {
  if (message.kind === "text") return message;
  const footer = message.footer ? `\n\n_${message.footer}_` : "";
  if (message.kind === "buttons") return { kind: "text", text: `${message.body}${footer}` };
  const options = message.rows.map((row) => `• ${row.title}`).join("\n");
  return { kind: "text", text: `${message.body}\n\n${options}${footer}` };
}
