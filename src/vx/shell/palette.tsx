"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { dayMonth, initials, rupees } from "@/vx/format";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { Pair } from "@/vx/text";

import { searchEverythingAction, type ActionHit, type ReceiptHit, type SearchResult, type StudentHit } from "./search-actions";
import type { StaffHit } from "./staff-search";
import "./palette.css";

export type PaletteItem = { href: string; label: Pair; icon: IconName; group: string };

const EMPTY: SearchResult = { students: [], receipts: [], actions: [] };

/** The design's avatar tones, taken in turn. */
const TONES: [string, string][] = [
  ["var(--accs)", "var(--accfg)"],
  ["var(--infos)", "var(--info)"],
  ["var(--oks)", "var(--ok)"],
  ["var(--warns)", "var(--warnfg)"],
  ["var(--s3)", "var(--fg)"],
];

const noSubscribe = () => () => {};
const PHONE = "(max-width: 899px)";
function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

const W = {
  search: { en: "Search students, receipts, pages or type an action…", hi: "विद्यार्थी, रसीदें, पेज खोजें…" },
  searchPhone: { en: "Name, SR no., phone, receipt…", hi: "नाम, SR नं., फ़ोन, रसीद…" },
  label: { en: "Search students, receipts and pages", hi: "विद्यार्थी, रसीदें और पेज खोजें" },
  dialog: { en: "Search or jump to", hi: "खोजें या पेज खोलें" },
  close: { en: "Close search", hi: "खोज बंद करें" },
  students: { en: "Students", hi: "विद्यार्थी" },
  staff: { en: "Staff", hi: "स्टाफ़" },
  actions: { en: "Actions", hi: "काम" },
  doItNow: { en: "Do it now", hi: "अभी करें" },
  receipts: { en: "Receipts", hi: "रसीदें" },
  pages: { en: "Pages", hi: "पेज" },
  jumpTo: { en: "Jump to", hi: "सीधे जाएँ" },
  page: { en: "Page", hi: "पेज" },
  openFirst: { en: "open first result", hi: "पहला नतीजा खोलें" },
  closeKey: { en: "close", hi: "बंद" },
  finds: { en: "Finds names, SR numbers, parents, receipts and pages", hi: "नाम, SR नंबर, अभिभावक, रसीदें और पेज खोजता है" },
  oneBox: { en: "One box finds students, parents, receipt numbers and any page.", hi: "एक ही बॉक्स से विद्यार्थी, अभिभावक, रसीद नंबर और कोई भी पेज।" },
  searching: { en: "Searching…", hi: "खोज रहे हैं…" },
  paidUp: { en: "Paid up", hi: "पूरा जमा" },
  onTrack: { en: "On track", hi: "समय पर" },
};

const nothing = (q: string): Pair => ({ en: `Nothing matches “${q}”. Try an SR no., a phone number or a receipt number.`, hi: `“${q}” से कुछ नहीं मिला। SR नं., फ़ोन या रसीद नंबर लिखें।` });
const collectFor = (name: string): Pair => ({ en: `Collect fee for ${name}`, hi: `${name} की फ़ीस जमा करें` });
const collectSub = (pending: number | null): Pair =>
  pending ? { en: `${rupees(pending)} · opens the Payment Desk`, hi: `${rupees(pending)} · पेमेंट डेस्क खुलेगा` } : { en: "Opens the Payment Desk", hi: "पेमेंट डेस्क खुलेगा" };
const callLine = (a: Extract<ActionHit, { kind: "call" }>, phone: boolean): Pair => {
  const rel = a.relation === "father" ? { en: "father", hi: "पिता" } : { en: "mother", hi: "माता" };
  if (!a.who) return { en: `Call ${a.child}'s ${rel.en}`, hi: `${a.child} के ${rel.hi} को फ़ोन` };
  return phone ? { en: `Call ${a.who} (${rel.en})`, hi: `${a.who} (${rel.hi}) को फ़ोन` } : { en: `Call ${a.who}`, hi: `${a.who} को फ़ोन` };
};
const callSub = (a: Extract<ActionHit, { kind: "call" }>): Pair =>
  a.relation === "father" ? { en: `Father of ${a.child}`, hi: `${a.child} के पिता` } : { en: `Mother of ${a.child}`, hi: `${a.child} की माता` };
const modeWord = (mode: string): string => ({ cash: "Cash", upi: "UPI", cheque: "Cheque", bank_transfer: "Bank" } as Record<string, string>)[mode] ?? mode;
/** "Aarav Sharma · 2 Oct · UPI", and "REVERSED" first for a reversed receipt (RULES A). */
const receiptSub = (r: ReceiptHit): string => `${r.reversed ? "REVERSED · " : ""}${r.student} · ${dayMonth(r.date)} · ${modeWord(r.mode)}`;

/** The name with the typed part in bold accent, as the design highlights it. */
function Hl({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <strong style={{ color: "var(--acc)", fontWeight: 800 }}>{text.slice(i, i + q.length)}</strong>
      {text.slice(i + q.length)}
    </>
  );
}

type Row = {
  key: string;
  group: string;
  href: string;
  external?: boolean;
  title: ReactNode;
  sub: string;
  icon: IconName;
  ibg: string;
  ifg: string;
  right?: { text: string; tone: string };
};

/**
 * Search everything (Ctrl K): D07 on a desk — a dialog over the blurred page,
 * students, "Do it now", receipts and pages, arrow keys and Enter — and F04 on
 * a phone — a full screen with a back arrow, a student card, big action
 * buttons and receipt cards. Pages come from this person's own menu; students
 * and receipts from `searchEverythingAction`, which keeps its permission checks.
 */
export function SearchPalette({
  items,
  initialOpen = false,
  initialQuery = "",
  search = searchEverythingAction,
}: {
  items: PaletteItem[];
  /** The design fixture opens it drawn (D07/F04). */
  initialOpen?: boolean;
  initialQuery?: string;
  search?: (q: string) => Promise<SearchResult>;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [q, setQ] = useState(initialQuery);
  const [result, setResult] = useState<{ q: string; r: SearchResult }>({ q: "", r: EMPTY });
  const [pending, start] = useTransition();
  const [cursor, setCursor] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const restore = useRef<Element | null>(null);
  const layer = useSyncExternalStore(noSubscribe, () => document.getElementById("vx-layer"), () => null);
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
  const term = q.trim();
  // Results for a one-letter query, or for an older query, are never shown.
  const shown = term.length >= 2 && result.q === term ? result.r : EMPTY;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("vx:search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("vx:search", onOpen);
    };
  }, []);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (term.length < 2) return;
    timer.current = window.setTimeout(() => {
      start(async () => {
        const r = await search(term).catch(() => EMPTY);
        setResult({ q: term, r: r ?? EMPTY });
        setCursor(0);
      });
    }, 220);
  }, [term, search]);

  // While open: focus the box, Escape closes, the page behind does not scroll.
  useEffect(() => {
    if (!open) return undefined;
    restore.current = document.activeElement;
    const t = window.setTimeout(() => input.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (restore.current instanceof HTMLElement) restore.current.focus();
    };
  }, [open]);

  const pages = useMemo(() => {
    const t = term.toLowerCase();
    return t ? items.filter((i) => `${i.label.en} ${i.label.hi ?? ""}`.toLowerCase().includes(t)).slice(0, 4) : items.slice(0, 6);
  }, [items, term]);

  const statusRight = (s: StudentHit): Row["right"] =>
    !s.money ? undefined : s.money.kind === "pending" ? { text: rupees(s.money.amount), tone: "var(--bad)" } : s.money.kind === "track" ? { text: tx(W.onTrack), tone: "var(--fg)" } : { text: tx(W.paidUp), tone: "var(--ok)" };

  const rows: Row[] = [
    ...shown.students.map((s, i): Row => ({
      key: `s${s.id}`,
      group: tx(W.students),
      href: s.href,
      title: <Hl text={s.name} q={term} />,
      sub: [s.classLabel, `SR ${s.sr}`, s.parent].filter(Boolean).join(" · "),
      icon: "users",
      ibg: TONES[i % TONES.length][0],
      ifg: TONES[i % TONES.length][1],
      right: statusRight(s),
    })),
    ...(shown.staff ?? []).map((s: StaffHit): Row => ({
      key: `t${s.id}`,
      group: tx(W.staff),
      href: s.href,
      title: <Hl text={s.name} q={term} />,
      sub: s.short ?? tx(W.staff),
      icon: "user",
      ibg: "var(--s2)",
      ifg: "var(--pri)",
    })),
    ...shown.actions.map((a): Row =>
      a.kind === "collect"
        ? { key: "a-collect", group: tx(W.actions), href: a.href, title: tx(collectFor(a.student)), sub: tx(collectSub(a.pending)), icon: "rupee", ibg: "var(--pri)", ifg: "var(--prifg)" }
        : { key: "a-call", group: tx(W.actions), href: `tel:${a.tel}`, external: true, title: tx(callLine(a, false)), sub: tx(callSub(a)), icon: "phone", ibg: "var(--infos)", ifg: "var(--info)" },
    ),
    // On a desk the design finds receipts by number only (D07); the phone also lists the child's (F04).
    ...shown.receipts.filter((r) => !r.byChild).map((r): Row => ({
      key: `r${r.id}`,
      group: tx(W.receipts),
      href: r.href,
      title: <Hl text={r.number} q={term} />,
      sub: receiptSub(r),
      icon: "receipt",
      ibg: "var(--s2)",
      ifg: "var(--pri)",
      right: { text: rupees(r.amount), tone: r.reversed ? "var(--mut)" : "var(--fg)" },
    })),
    ...pages.map((p): Row => ({
      key: `p${p.href}`,
      group: term ? tx(W.pages) : tx(W.jumpTo),
      href: p.href,
      title: <Hl text={tx(p.label)} q={term} />,
      sub: tx(W.page),
      icon: p.icon,
      ibg: "var(--s2)",
      ifg: "var(--pri)",
    })),
  ];

  const close = () => setOpen(false);
  const go = (row: { href: string; external?: boolean }) => {
    setOpen(false);
    setQ("");
    if (row.external) window.location.href = row.href;
    else router.push(row.href);
  };

  if (!open || !layer) return null;

  const noResults = term.length >= 2 && !pending && result.q === term && shown.students.length + shown.receipts.length + (shown.staff?.length ?? 0) + pages.length === 0;

  const box = (
    <input
      ref={input}
      type="search"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      onKeyDown={(e) => {
        if (phone) return;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setCursor((c) => Math.min(rows.length - 1, c + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setCursor((c) => Math.max(0, c - 1));
        } else if (e.key === "Enter" && rows[cursor]) {
          e.preventDefault();
          go(rows[cursor]);
        }
      }}
      placeholder={tx(phone ? W.searchPhone : W.search)}
      aria-label={tx(W.label)}
      aria-controls="vxp-results"
      aria-activedescendant={!phone && rows[cursor] ? `vxp-${rows[cursor].key}` : undefined}
      enterKeyHint="search"
    />
  );

  if (phone) {
    const students = shown.students.slice(0, 4);
    return createPortal(
      <section role="dialog" aria-modal="true" aria-label={tx(W.dialog)} className="vxp-phone">
        <div className="glass vxp-phead">
          <button type="button" className="tap vxp-back" aria-label={tx(W.close)} onClick={close}>
            <Ic n="chevLeft" size={24} />
          </button>
          <label className="vxp-pbox">
            <Ic n={pending ? "refresh" : "search"} className={pending ? "spin" : undefined} />
            {box}
          </label>
        </div>
        <div id="vxp-results" className="scroll vxp-pbody">
          {term.length < 2 ? (
            <div className="vxp-sec">
              <h2 className="sech" style={{ padding: "0 4px" }}>{tx(W.jumpTo)}</h2>
              <div className="vxp-grid">
                {pages.map((p) => (
                  <button key={p.href} type="button" className="tap vxp-tile" onClick={() => go(p)}>
                    <Ic n={p.icon} style={{ color: "var(--pri)" }} />
                    {tx(p.label)}
                  </button>
                ))}
              </div>
              <p style={{ margin: "8px 4px 0", fontSize: 13, color: "var(--mut)", lineHeight: 1.5 }}>{tx(W.oneBox)}</p>
            </div>
          ) : null}
          {students.length ? (
            <div className="vxp-sec">
              <h2 className="sech" style={{ padding: "0 4px" }}>{tx(W.students)}</h2>
              <div className="card" style={{ overflow: "hidden" }}>
                {students.map((s, i) => {
                  const right = statusRight(s);
                  return (
                    <button key={s.id} type="button" className="tap vxp-stu" style={{ borderTop: i ? "1px solid var(--bd)" : 0 }} onClick={() => go(s)}>
                      <span className="vxp-ava" style={{ background: TONES[i % TONES.length][0], color: TONES[i % TONES.length][1] }} aria-hidden="true">{initials(s.name)}</span>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                        <span className="clip" style={{ fontSize: 15 }}><Hl text={s.name} q={term} /></span>
                        <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{`${s.classLabel} · SR ${s.sr}`}</span>
                      </span>
                      {right ? <span className="num" style={{ fontSize: 13, fontWeight: 700, color: right.tone }}>{right.text}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {shown.staff?.length ? (
            <div className="vxp-sec">
              <h2 className="sech" style={{ padding: "0 4px" }}>{tx(W.staff)}</h2>
              <div className="card" style={{ overflow: "hidden" }}>
                {shown.staff.slice(0, 4).map((s, i) => (
                  <button key={s.id} type="button" className="tap vxp-stu" style={{ borderTop: i ? "1px solid var(--bd)" : 0 }} onClick={() => go(s)}>
                    <span className="vxp-ava" style={{ background: "var(--s2)", color: "var(--pri)" }} aria-hidden="true">{initials(s.name)}</span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span className="clip" style={{ fontSize: 15 }}><Hl text={s.name} q={term} /></span>
                      {s.short ? <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{s.short}</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {shown.actions.length ? (
            <div className="vxp-sec">
              <h2 className="sech" style={{ padding: "0 4px" }}>{tx(W.doItNow)}</h2>
              {shown.actions.map((a) =>
                a.kind === "collect" ? (
                  <button key="collect" type="button" className="tap vxp-act" style={{ background: "var(--pri)", color: "var(--prifg)", border: 0 }} onClick={() => go(a)}>
                    <Ic n="rupee" />
                    <span style={{ flex: 1 }}>{tx(collectFor(a.student))}</span>
                    <Ic n="chevRight" />
                  </button>
                ) : (
                  <a key="call" href={`tel:${a.tel}`} className="tap vxp-act" style={{ background: "var(--card)", color: "var(--fg)", border: "1px solid var(--bd)" }} onClick={close}>
                    <Ic n="phone" />
                    <span style={{ flex: 1 }}>{tx(callLine(a, true))}</span>
                    <Ic n="chevRight" />
                  </a>
                ),
              )}
            </div>
          ) : null}
          {shown.receipts.length ? (
            <div className="vxp-sec">
              <h2 className="sech" style={{ padding: "0 4px" }}>{tx(W.receipts)}</h2>
              {shown.receipts.slice(0, 2).map((r: ReceiptHit) => (
                <button key={r.id} type="button" className="tap card vxp-rc" onClick={() => go(r)}>
                  <span className="vxp-rci" aria-hidden="true"><Ic n="receipt" /></span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>{`${r.number} · ${rupees(r.amount)}`}</span>
                    <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{receiptSub(r)}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {term.length >= 2 && pages.length ? (
            <div className="vxp-sec">
              <h2 className="sech" style={{ padding: "0 4px" }}>{tx(W.pages)}</h2>
              <div className="vxp-grid">
                {pages.map((p) => (
                  <button key={p.href} type="button" className="tap vxp-tile" onClick={() => go(p)}>
                    <Ic n={p.icon} style={{ color: "var(--pri)" }} />
                    {tx(p.label)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {noResults ? <div className="vxp-none">{tx(nothing(term))}</div> : null}
        </div>
      </section>,
      layer,
    );
  }

  return createPortal(
    <>
      <button type="button" aria-label={tx(W.close)} tabIndex={-1} className="vxp-scrim" onClick={close} />
      <div className="vxp-wrap">
        <section role="dialog" aria-modal="true" aria-label={tx(W.dialog)} className="vxp-dialog">
          <label className="vxp-dbox">
            <Ic n={pending ? "refresh" : "search"} size={22} className={pending ? "spin" : undefined} />
            {box}
            <span className="k">Esc</span>
          </label>
          <div className="scroll vxp-dbody">
            <ul id="vxp-results" role="listbox" aria-label={tx(W.label)} style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {rows.map((r, i) => (
                <li key={r.key} id={`vxp-${r.key}`} role="option" aria-selected={i === cursor}>
                  {i === 0 || rows[i - 1].group !== r.group ? <div className="sech" style={{ padding: "10px 12px 4px" }}>{r.group}</div> : null}
                  <button
                    type="button"
                    tabIndex={-1}
                    className="tap vxp-item"
                    data-on={i === cursor ? "" : undefined}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(r)}
                    style={{ animationDelay: `${i * 20}ms` }}
                  >
                    <span className="vxp-ic" style={{ background: r.ibg, color: r.ifg }} aria-hidden="true"><Ic n={r.icon} /></span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{r.title}</span>
                      <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{r.sub}</span>
                    </span>
                    {r.right ? <span className="num" style={{ fontSize: 13, fontWeight: 700, color: r.right.tone }}>{r.right.text}</span> : null}
                    <span className="k" style={{ opacity: i === cursor ? 1 : 0 }}>↵</span>
                  </button>
                </li>
              ))}
            </ul>
            {pending && rows.length === 0 ? <div className="vxp-none">{tx(W.searching)}</div> : null}
            {noResults ? <div className="vxp-none">{tx(nothing(term))}</div> : null}
          </div>
          <div className="vxp-foot">
            <span><span className="k">↵</span> {tx(W.openFirst)}</span>
            <span><span className="k">Esc</span> {tx(W.closeKey)}</span>
            <span style={{ marginLeft: "auto" }}>{tx(W.finds)}</span>
          </div>
        </section>
      </div>
    </>,
    layer,
  );
}
