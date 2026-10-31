import { ExternalLink, MessageCircle, Phone } from "lucide-react";
import type { ReactNode } from "react";

/**
 * What the parent's phone will show, drawn like a WhatsApp chat.
 *
 * A SERVER component: the body is rendered on the server from the approved
 * template (the bodies never reach the browser bundle), and so is this frame.
 * It replaced a grey `<pre>` inside the client workspace — the same text, but a
 * parent's-eye view is what lets anyone, not just the person who wrote the
 * templates, check a message before pressing Send.
 *
 * WhatsApp's own `*bold*` is honoured, because every title line uses it and an
 * asterisk-wrapped title reads as a typo in a plain preview.
 */

export type PreviewButton = { label: string; kind: "url" | "phone" | "reply" };

function withBold(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of line.matchAll(/\*([^*\n]+)\*/g)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(line.slice(last, index));
    parts.push(
      <strong key={index} className="font-bold text-foreground">
        {match[1]}
      </strong>,
    );
    last = index + match[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

export function NoticePreview({
  recipient,
  body,
  buttons,
  footnote,
}: {
  /** "Ramesh Lal Gurjar" — whose phone this is. */
  recipient: string;
  body: string;
  buttons: readonly PreviewButton[];
  footnote?: string;
}) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <MessageCircle className="size-4" aria-hidden="true" />
        What {recipient} will see
      </figcaption>
      <div className="rounded-xl border border-border bg-surface-2 p-3">
        <div className="max-w-[22rem] rounded-lg rounded-tl-none border border-border bg-card px-3 py-2 shadow-sm">
          <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted-foreground">
            {body.split("\n").map((line, index) => (
              <span key={index} className="block min-h-[1em]">
                {withBold(line)}
              </span>
            ))}
          </div>
          <p className="mt-1 text-right text-[10.5px] text-muted-foreground">now</p>
        </div>
        {buttons.length > 0 ? (
          <div className="mt-1 flex max-w-[22rem] flex-col gap-1">
            {buttons.map((button) => (
              <span
                key={button.label}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card py-2 text-[13px] font-semibold text-accent"
              >
                {button.kind === "url" ? (
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                ) : button.kind === "phone" ? (
                  <Phone className="size-3.5" aria-hidden="true" />
                ) : null}
                {button.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {footnote ? <p className="text-xs text-muted-foreground">{footnote}</p> : null}
    </figure>
  );
}
