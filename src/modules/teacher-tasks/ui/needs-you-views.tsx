import Link from "@/ui/link";
import type { Language } from "@/platform/i18n/language";
import { Ic } from "@/vx/icons";
import { lead, type Pair } from "@/vx/text";
import { Btn, Card, IconTile } from "@/vx/ui/primitives";
import type { CollectCounts } from "../domain/collect";
import { CW } from "./collect-words";

/*
 * Needs you in two halves (D-520): what waits for the office's decision, and
 * the work the office has handed to teachers. Two big tabs, each a link, so
 * Back and a shared link land on the same half.
 */

export const COLLECT_HREF = "/inbox?view=collect";

export function NeedsYouViews({ active, decide, collect, language }: { active: "decide" | "collect"; decide: number | null; collect: number; language: Language }) {
  const tab = (key: "decide" | "collect", href: string, label: Pair, count: number | null) => {
    const on = active === key;
    return (
      <Link
        href={href}
        scroll={false}
        aria-current={on ? "page" : undefined}
        className="tap"
        style={{ minHeight: 44, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0 10px", borderRadius: 11, fontSize: 14, fontWeight: 700, textDecoration: "none", background: on ? "var(--card)" : "transparent", color: on ? "var(--fg)" : "var(--mut)", boxShadow: on ? "var(--sh)" : "none", transition: "background-color .2s ease, color .2s ease" }}
      >
        <span className="clip">{lead(label, language)}</span>
        {count ? <span className="num" style={{ flex: "none", minWidth: 22, height: 22, padding: "0 6px", borderRadius: 11, display: "inline-grid", placeItems: "center", fontSize: 12, background: on ? "var(--acc)" : "var(--s2)", color: on ? "#fff" : "var(--fg)" }}>{count}</span> : null}
      </Link>
    );
  };
  return (
    <nav aria-label={lead(CW.views, language)} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 4, padding: 4, borderRadius: 14, background: "var(--s3)" }}>
      {tab("decide", "/inbox", CW.decide, decide)}
      {tab("collect", COLLECT_HREF, CW.collect, collect)}
    </nav>
  );
}

/** Teachers' work in one card under the decisions: what is waiting, and the way in. */
export function CollectSummary({ counts, language }: { counts: CollectCounts | null; language: Language }) {
  const say = (pair: Pair) => lead(pair, language);
  const parts = counts ? [
    counts.toSend.length ? `${counts.toSend.length} · ${say(CW.toSendTitle)}` : null,
    counts.toRemind.length ? `${counts.toRemind.length} · ${say(CW.toRemindTitle)}` : null,
    counts.answers ? `${counts.answers} · ${say(CW.answersTitle)}` : null,
  ].filter((x): x is string => !!x) : [];
  return (
    <Card as="section" aria-label={say(CW.needsYouCard)} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <IconTile icon="users" tone={parts.length ? "acc" : "mut"} size={40} />
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <strong style={{ fontSize: 16 }}>{say(CW.needsYouCard)}</strong>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{counts === null ? say(CW.couldNotRead) : parts.length ? null : counts.open ? say(CW.toSendNone) : say(CW.noWorkTitle)}</span>
        </div>
      </div>
      {parts.length ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {parts.map((line) => (
            <li key={line} className="num" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }}>
              <Ic n="arrowRight" size={14} style={{ color: "var(--acc)" }} />
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      <Btn variant={parts.length ? "pri" : "sec"} icon="users" full href={COLLECT_HREF}>{say(CW.needsYouOpen)}</Btn>
    </Card>
  );
}
