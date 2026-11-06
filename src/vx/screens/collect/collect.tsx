"use client";

import "./collect.css";

import Link from "@/vx/ui/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { mc } from "@/messages/collect";
import type { MoneyPort, MoneyPortInfo } from "@/modules/collect/data/money-port";
import {
  acknowledge,
  allSaved,
  attemptKey,
  nothingPosted,
  parseAttempt,
  recovered,
  savedReceipts,
  settle,
  type CollectAttempt,
} from "@/modules/collect/domain/attempt";
import { paidToday } from "@/modules/collect/domain/bridge-map";
import {
  bumpNote,
  checkSplit,
  chequeReady,
  ledgerTender,
  notesTotal,
  tendersByChild,
  type CollectMode,
  type LedgerMode,
  type NoteCount,
} from "@/modules/collect/domain/cash";
import { datePickable, daysBetween, stepDate } from "@/modules/collect/domain/dates";
import {
  amountSuggestions,
  childTotals,
  familyAmountOk,
  familyMax,
  familySuggestions,
  splitFamily,
  typeDigit,
  type ChildMoney,
  type SplitRule,
} from "@/modules/collect/domain/family";
import { canJumpTo, checkReasons, nextCard, previousCard, visibleCards, type Card } from "@/modules/collect/domain/flow";
import { collectReference, collectRemarks, nextReason, type WaiverReason } from "@/modules/collect/domain/remarks";
import type { CollectDues, CollectPost, CollectStudentRow, LikelyRow, Prepared, SavedReceipt } from "@/modules/collect/domain/types";
import { orderForSettlement } from "@/modules/payments/vx/domain/desk";
import { flat, type Localized } from "@/platform/i18n/language";
import { schoolToday } from "@/vx/format";

import { AmountCard } from "./cards/amount";
import { CheckCard, type TicketLine } from "./cards/check";
import { DuesCard, REASON_TEXT, type SiblingView } from "./cards/dues";
import { PayCard, type PayEffect, type PaySub } from "./cards/pay";
import { SealedCard, type SealedView } from "./cards/sealed";
import { WhoCard, type Found } from "./cards/who";
import { flyChip, shake, slideIn, slideOut, stamp } from "./motion";
import { allocText, CardShell, firstName, Icon, useOverflowCheck, YearBar } from "./parts";
import { Seal } from "./seal";
import { Bi, dayMonth, fill, money, useCx } from "./text";

export type CollectProps = {
  info: MoneyPortInfo;
  /**
   * Builds the adapter, in the browser. `collect-bridge.tsx` and
   * `collect-local.tsx` pass theirs, so each imports only its own ledger's
   * actions. `recall` lists the children this browser collected from lately.
   */
  makePort: (recall: () => readonly LikelyRow[]) => MoneyPort;
  initialStudentId: string | null;
  testSession: boolean;
};

const noop = () => () => {};

/**
 * Collect (plan §3): the card-by-card payment entry. Rendered only in the
 * browser — it restores an unfinished payment from this browser's storage
 * before it draws anything, so the server never paints a different screen.
 */
export function Collect(props: CollectProps) {
  const client = useSyncExternalStore(noop, () => true, () => false);
  if (!client) return <div className="vx cx" aria-busy="true" />;
  return <CollectApp {...props} />;
}

type DuesState = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; dues: CollectDues };
type Prep = { key: string; result: Prepared };
type SaveState =
  | { phase: "idle" }
  | { phase: "saving"; child: string | null }
  | { phase: "uncertain"; message: string }
  | { phase: "notfound"; commandId: string }
  | { phase: "refused"; message: string; quoteChanged: boolean }
  | { phase: "duplicate"; near: boolean; receipt: string | null; commandId: string }
  | { phase: "sealing" };

const RECENT_CAP = 8;
const SIBLINGS_READ = 3;
const LEDGER_MODES: readonly LedgerMode[] = ["cash", "upi", "bank_transfer", "cheque"];
const isLedgerMode = (m: string): m is LedgerMode => (LEDGER_MODES as readonly string[]).includes(m);

function readJson<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* a convenience only */
  }
}
function readMode(key: string): CollectMode {
  try {
    const m = window.localStorage.getItem(key);
    return m && isLedgerMode(m) ? m : "cash";
  } catch {
    return "cash";
  }
}

const both = (pair: Localized) => flat(pair, "both");
const okDues = (s: DuesState | undefined) => (s && s.status === "ok" ? s.dues : null);

function CollectApp(props: CollectProps) {
  const { p, f, language } = useCx();
  const info = props.info;
  const today = info.today;
  const storeKey = attemptKey(info.kind, info.userId, info.sessionLabel);
  const recentKey = `vppsone:collect-recent:${info.kind}:${info.userId}:${info.sessionLabel}`;
  const modeKey = `vppsone:collect-mode:${info.userId}`;

  const [boot] = useState(() => {
    try {
      const found = parseAttempt(window.sessionStorage.getItem(storeKey), { adapter: info.kind, sessionLabel: info.sessionLabel });
      return { attempt: found ? recovered(found) : null, unreadable: false };
    } catch {
      return { attempt: null, unreadable: true };
    }
  });
  const [recents, setRecents] = useState<LikelyRow[]>(() => readJson<LikelyRow[]>(recentKey) ?? []);
  const recentsRef = useRef(recents);
  useEffect(() => {
    recentsRef.current = recents;
  }, [recents]);
  const { makePort } = props;
  const port = useMemo(() => makePort(() => recentsRef.current), [makePort]);

  const [card, setCard] = useState<Card>(props.initialStudentId && !boot.attempt ? "dues" : "who");
  const [done, setDone] = useState<ReadonlySet<Card>>(() => new Set<Card>(props.initialStudentId ? ["who"] : []));
  const [jumping, setJumping] = useState(false);
  const [q, setQ] = useState("");
  const [hl, setHl] = useState(0);
  const [found, setFound] = useState<Found>({ q: "", rows: [], loading: false, error: null });
  const [likely, setLikely] = useState<LikelyRow[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(props.initialStudentId);
  const [fam, setFam] = useState<string[]>(props.initialStudentId ? [props.initialStudentId] : []);
  const [wantAll, setWantAll] = useState<string[] | null>(null);
  const [dues, setDues] = useState<Record<string, DuesState>>(() => (props.initialStudentId ? { [props.initialStudentId]: { status: "loading" } } : {}));
  const [late, setLate] = useState<{ choice: "waive" | "collect" | null; reason: WaiverReason }>({ choice: null, reason: "desk" });
  const [rule, setRule] = useState<SplitRule>("oldest");
  const [manual, setManual] = useState<Record<string, number>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [rollFrom, setRollFrom] = useState<number | null>(null);
  const [mode, setMode] = useState<CollectMode>(() => readMode(modeKey));
  const [received, setReceived] = useState<number | null>(null);
  const [notes, setNotes] = useState<NoteCount | null>(null);
  const [splitCash, setSplitCash] = useState<number | null>(null);
  const [cheque, setCheque] = useState({ number: "", bank: "", date: "" });
  const [date, setDate] = useState(today);
  const [calMonth, setCalMonth] = useState(today.slice(0, 7));
  const [sub, setSub] = useState<PaySub>(null);
  const [prepared, setPrepared] = useState<Record<string, Prep>>({});
  const [ack, setAck] = useState({ daily: false, near: false });
  const [save, setSave] = useState<SaveState>(boot.attempt ? { phase: "uncertain", message: f(mc.resumeFound) } : { phase: "idle" });
  const [attempt, setAttempt] = useState<CollectAttempt | null>(boot.attempt);
  const [sealed, setSealed] = useState<{ view: SealedView; animate: boolean } | null>(null);
  const [desk, setDesk] = useState<Array<SavedReceipt & { name: string }>>([]);
  const [ticketOpen, setTicketOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLDivElement>(null);
  const holdRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const sealRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const enter = useRef<{ dir: 1 | -1; hadOld: boolean; fly: { text: string; from: Card; src: DOMRect } | null } | null>(null);
  const cardNow = useRef<Card>(card);
  const linesRef = useRef<SealedView["lines"]>({});
  useEffect(() => {
    cardNow.current = card;
  }, [card]);

  // ── The frame: exactly the space between the shell's top and its phone tab bar ──
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const size = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const vv = window.visualViewport?.height ?? window.innerHeight;
      const bar = document.querySelector<HTMLElement>(".vx-bottom");
      const barH = bar && getComputedStyle(bar).display !== "none" ? bar.getBoundingClientRect().height : 0;
      el.style.setProperty("--cx-h", `${Math.max(320, Math.floor(vv - top - barH))}px`);
    };
    size();
    window.addEventListener("resize", size);
    window.visualViewport?.addEventListener("resize", size);
    return () => {
      window.removeEventListener("resize", size);
      window.visualViewport?.removeEventListener("resize", size);
    };
  }, []);

  // ── Reads ──
  const loadDues = (id: string) => {
    setDues((prev) => ({ ...prev, [id]: { status: "loading" } }));
    void port.dues(id).then((answer) => setDues((prev) => ({ ...prev, [id]: answer.ok ? { status: "ok", dues: answer.dues } : { status: "error", message: answer.message } })));
  };
  useEffect(() => {
    if (!props.initialStudentId) return;
    const id = props.initialStudentId;
    void port.dues(id).then((answer) => setDues((prev) => ({ ...prev, [id]: answer.ok ? { status: "ok", dues: answer.dues } : { status: "error", message: answer.message } })));
  }, [port, props.initialStudentId]);

  const recentIds = useMemo(() => recents.filter((r) => r.reason === "paid_recently").map((r) => r.id), [recents]);
  useEffect(() => {
    let live = true;
    void port.likely(recentIds).then((rows) => {
      if (live) setLikely(rows);
    });
    return () => {
      live = false;
    };
  }, [port, recentIds]);

  useEffect(() => {
    const text = q.trim();
    if (!text) return;
    let live = true;
    const timer = window.setTimeout(
      () => {
        void port.search(text).then((answer) => {
          if (!live) return;
          setFound(answer.ok ? { q: text, rows: answer.rows, loading: false, error: null } : { q: text, rows: [], loading: false, error: answer.message });
        });
      },
      info.kind === "bridge" ? 220 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [q, port, info.kind]);
  const foundNow: Found = found.q === q.trim() ? found : { q: q.trim(), rows: found.rows, loading: true, error: null };

  const primary = primaryId ? okDues(dues[primaryId]) : null;

  // The primary child's siblings: read their dues (a few) so the ticks show fees and late fees apart.
  const siblingIds = useMemo(() => (primary ? primary.siblings.slice(0, SIBLINGS_READ).map((s) => s.id) : []), [primary]);
  useEffect(() => {
    const missing = siblingIds.filter((id) => !dues[id]);
    if (!missing.length) return;
    let live = true;
    void Promise.all(missing.map((id) => port.dues(id).then((answer) => [id, answer] as const))).then((pairs) => {
      if (!live) return;
      setDues((prev) => {
        const next = { ...prev };
        for (const [id, answer] of pairs) if (!next[id] || next[id].status !== "ok") next[id] = answer.ok ? { status: "ok", dues: answer.dues } : { status: "error", message: answer.message };
        return next;
      });
    });
    return () => {
      live = false;
    };
  }, [siblingIds, dues, port]);

  // "Collect for all": once the household is known, tick the siblings the phone search found who owe.
  const famShown = useMemo(() => {
    if (!wantAll || !primary) return fam;
    const household = new Set(primary.siblings.map((s) => s.id));
    const extra = wantAll.filter((id) => household.has(id) && !fam.includes(id));
    return extra.length ? [...fam, ...extra] : fam;
  }, [wantAll, primary, fam]);

  // ── Money, derived ──
  const members = famShown.map((id) => okDues(dues[id])).filter((d): d is CollectDues => d !== null);
  const family = members.length > 1;
  const choice: "waive" | "collect" = late.choice ?? (info.canWaive ? "waive" : "collect");
  const takesLate = (d: CollectDues) => d.onPlan || !info.canWaive || choice === "collect";
  const children: Array<ChildMoney & { name: string; classLabel: string }> = members.map((d) => ({ id: d.student.id, rows: d.rows, takeLate: takesLate(d), name: d.student.name, classLabel: d.student.classLabel }));
  const isManual = family && rule === "manual";
  const total = isManual ? Object.entries(manual).filter(([id]) => famShown.includes(id)).reduce((s, [, v]) => s + v, 0) : Number(amount || 0);
  const shares = family ? splitFamily(children, total, rule, manual) : [total];
  const maxAll = familyMax(children, today);
  const amountOk = members.length > 0 && (family ? familyAmountOk(children, total, rule, shares, today) : total > 0 && total <= maxAll);
  const familyLate = members.reduce((s, d) => s + (d.onPlan ? 0 : childTotals({ id: d.student.id, rows: d.rows, takeLate: true }, today).late), 0);
  const paidTodayOf = (d: CollectDues) => paidToday(d.receipts, today, (iso) => schoolToday(new Date(iso)));
  const paidTodayAny = members.map(paidTodayOf).find(Boolean) ?? null;

  const waives = (d: CollectDues) => info.canWaive && choice === "waive" && !d.onPlan;
  const prepKeyOf = (id: string, share: number) => `${share}|${date}|${waives(members.find((m) => m.student.id === id) as CollectDues) ? "w" : "c"}`;
  const jobs = members.map((d, i) => ({ id: d.student.id, share: shares[i] ?? 0 })).filter((j) => j.share > 0).map((j) => ({ ...j, key: prepKeyOf(j.id, j.share) }));
  const jobsKey = jobs.map((j) => `${j.id}:${j.key}`).join(",");
  const moneyCardShown = card === "pay" || card === "check";
  useEffect(() => {
    if (!moneyCardShown) return;
    const missing = jobs.filter((j) => prepared[j.id]?.key !== j.key);
    if (!missing.length) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void Promise.all(
        missing.map((j) => {
          const d = members.find((m) => m.student.id === j.id) as CollectDues;
          return port.prepare({ studentId: j.id, amount: j.share, paymentDate: date, waive: waives(d) }).then((result) => [j.id, { key: j.key, result }] as const);
        }),
      ).then((pairs) => {
        if (live) setPrepared((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
      });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moneyCardShown, jobsKey, port]);

  const preps = jobs.map((j) => (prepared[j.id]?.key === j.key ? prepared[j.id].result : null));
  const prepLoading = preps.some((x) => x === null);
  const prepFailed = preps.some((x) => x !== null && !x.ok);
  const prepOk = preps.every((x) => x !== null && x.ok);
  const lateOnDate = preps.reduce((s, x) => s + (x && x.ok ? x.lateFee : 0), 0);
  const overDate = jobs.some((j, i) => {
    const x = preps[i];
    return x !== null && x.ok && j.share > x.maxPayable;
  });
  const maxOnDate = preps.reduce((s, x) => s + (x && x.ok ? x.maxPayable : 0), 0);
  const accepted: LedgerMode[] = (() => {
    const lists = preps.flatMap((x) => (x && x.ok && x.acceptedModes ? [x.acceptedModes] : [])).concat(members.flatMap((d) => (d.acceptedModes ? [d.acceptedModes] : [])));
    return lists.length ? LEDGER_MODES.filter((m) => lists.every((l) => l.includes(m)) && info.modes.includes(m)) : info.modes;
  })();

  const split = checkSplit(total, splitCash);
  const tenderOk =
    mode === "cash" ? (received ?? total) >= total
    : mode === "split" ? info.canSplit && split.ok && accepted.includes("cash") && accepted.includes("upi")
    : mode === "cheque" ? chequeReady(cheque) && accepted.includes("cheque")
    : accepted.includes(mode);
  const quoteOk = info.kind === "local" || preps.every((x) => x !== null && x.ok && Boolean(x.quoteHash));
  const payReady = amountOk && tenderOk && prepOk && !overDate && quoteOk && datePickable(date, { today, sessionStart: info.sessionStart });

  const reasons = checkReasons({
    children: members.length,
    mode,
    paymentDate: date,
    today,
    paidToday: paidTodayAny !== null,
    total,
    lateFee: familyLate,
    waiving: info.canWaive && choice === "waive",
    defaultReason: late.reason === "desk",
  });
  const needsCheck = reasons.length > 0 || save.phase === "duplicate";
  const busy = save.phase !== "idle" && save.phase !== "duplicate" && !(save.phase === "refused" && attempt === null);

  let effect: PayEffect = { kind: "none" };
  if (jobs.length && prepLoading && date !== today) effect = { kind: "checking" };
  else if (prepFailed) effect = { kind: "failed" };
  else if (overDate) effect = { kind: "over", max: maxOnDate };
  else if (date !== today && prepOk) effect = lateOnDate !== familyLate ? { kind: "late", onDate: lateOnDate, today: familyLate } : { kind: "same", days: daysBetween(date, today) };

  // ── Ticket text ──
  const tenderPair = (): Localized => {
    if (mode === "cash") {
      const rec = received ?? total;
      const base = fill(mc.tenderCash, { a: money(total) });
      return rec > total ? { hi: `${base.hi} · ${fill(mc.tenderReturned, { a: money(rec), name: money(rec - total) }).hi}`, en: `${base.en} · ${fill(mc.tenderReturned, { a: money(rec), name: money(rec - total) }).en}` } : base;
    }
    if (mode === "upi") return fill(mc.tenderUpi, { a: money(total) });
    if (mode === "split") {
      const c = fill(mc.tenderCash, { a: money(split.cash ?? 0) });
      const u = fill(mc.tenderUpi, { a: money(split.upi ?? 0) });
      return { hi: `${c.hi} + ${u.hi}`, en: `${c.en} + ${u.en}` };
    }
    if (mode === "cheque") {
      const c = fill(mc.tenderCheque, { name: cheque.number || "—" });
      return { hi: `${c.hi} · ${cheque.bank || "—"}`, en: `${c.en} · ${cheque.bank || "—"}` };
    }
    return fill(mc.tenderBank, { a: money(total) });
  };
  const chipText = (c: Card): string => {
    if (!primary) return "";
    switch (c) {
      case "who":
        return family ? `${firstName(primary.student.name)} +${members.length - 1}` : primary.student.name;
      case "dues":
        if (!done.has("dues")) return "";
        if (familyLate) return `${p(mc.lateShort)} ${money(familyLate)} · ${p(choice === "waive" && info.canWaive ? mc.waive : mc.collect)}`;
        return family ? p(fill(mc.collectForN, { n: members.length })) : `${primary.student.classLabel} · SR ${primary.student.sr}`;
      case "amount":
        return done.has("amount") && total ? `${money(total)}${family ? ` · ${members.filter((_, i) => shares[i] > 0).map((d) => firstName(d.student.name)).join(" + ")}` : ""}` : "";
      case "pay":
        return done.has("pay") ? `${p(tenderPair())}${date !== today ? ` · ${p(dayMonth(date))}` : ""}` : "";
      case "check":
        return sealed ? sealed.view.receipts.map((r) => r.receiptNumber.slice(-4)).join(", ") : "";
      default:
        return "";
    }
  };

  // ── Moving between cards ──
  function go(to: Card, fly: { text: string; from: Card } | null = null) {
    const from = cardNow.current;
    const old = cardRef.current;
    const dir: 1 | -1 = (["who", "dues", "amount", "pay", "check", "sealed"] as Card[]).indexOf(to) >= (["who", "dues", "amount", "pay", "check", "sealed"] as Card[]).indexOf(from) ? 1 : -1;
    if (old && ghostRef.current && to !== from) {
      const ghost = old.cloneNode(true) as HTMLElement;
      ghost.classList.add("leaving");
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      ghostRef.current.appendChild(ghost);
      slideOut(ghost, dir).onfinish = () => ghost.remove();
    }
    const src = old?.querySelector("[data-title]")?.getBoundingClientRect() ?? null;
    enter.current = { dir, hadOld: Boolean(old) && to !== from, fly: fly && src ? { ...fly, src } : null };
    setSub(null);
    setTicketOpen(false);
    setCard(to);
  }
  useLayoutEffect(() => {
    const e = enter.current;
    enter.current = null;
    if (!e || !cardRef.current) return;
    slideIn(cardRef.current, e.dir, e.hadOld);
    if (e.fly) {
      const phone = window.matchMedia("(max-width: 899px)").matches;
      const target = phone ? rootRef.current?.querySelector(".cx-sum") : rootRef.current?.querySelector(`[data-chip="${e.fly.from}"] .val`);
      flyChip(e.fly.text, e.fly.src, target ?? null);
    }
  }, [card]);

  useEffect(() => {
    if (card === "who" && !window.matchMedia("(max-width: 899px)").matches) searchRef.current?.focus({ preventScroll: true });
  }, [card]);

  function next() {
    if (card === "amount" && !amountOk) {
      shake(amountRef.current);
      return;
    }
    if (card === "pay" && !payReady) return;
    if (card === "dues" && !members.some((d) => childTotals({ id: d.student.id, rows: d.rows, takeLate: true }, today).fees > 0)) return;
    const nextDone = new Set(done);
    nextDone.add(card);
    if (card === "dues" && famShown !== fam) setFam(famShown);
    if (card === "dues" && late.choice === null) setLate((l) => ({ ...l, choice }));
    const to = nextCard({ current: card, done: nextDone, jumping, needsCheck });
    if (to === "check" || to === "pay") setJumping(false);
    setDone(nextDone);
    go(to, { text: chipText(card) || (card === "dues" && primary ? primary.student.name : ""), from: card });
  }
  function back() {
    if (sub) {
      setSub(null);
      return;
    }
    const prev = previousCard({ current: card, needsCheck });
    if (prev) go(prev);
  }
  function jumpTo(c: Card) {
    if (!canJumpTo(c, { current: card, done }, Boolean(sealed)) || busy) return;
    if (c === "who") {
      resetAll();
      return;
    }
    setJumping(done.has("pay") || card === "check" || jumping);
    go(c);
  }

  function resetMoney() {
    setLate({ choice: null, reason: "desk" });
    setRule("oldest");
    setManual({});
    setAmount("");
    setRollFrom(null);
    setReceived(null);
    setNotes(null);
    setSplitCash(null);
    setCheque({ number: "", bank: "", date: "" });
    setDate(today);
    setCalMonth(today.slice(0, 7));
    setPrepared({});
    setAck({ daily: false, near: false });
    setSave({ phase: "idle" });
    setAttempt(null);
    setSealed(null);
    setJumping(false);
  }
  function resetAll() {
    resetMoney();
    setPrimaryId(null);
    setFam([]);
    setWantAll(null);
    setDone(new Set());
    setQ("");
    setHl(0);
    if (mode === "split") setMode(readMode(modeKey));
    go("who");
  }
  function pick(row: CollectStudentRow, all: boolean) {
    resetMoney();
    setPrimaryId(row.id);
    setFam([row.id]);
    setFocus(row.id);
    setWantAll(all ? foundNow.rows.filter((r) => r.id !== row.id && r.fees > 0).map((r) => r.id) : null);
    setDone(new Set<Card>(["who"]));
    loadDues(row.id);
    go("dues", { text: row.name, from: "who" });
  }
  function toggleSibling(id: string) {
    setFam(famShown.includes(id) ? famShown.filter((x) => x !== id) : [...famShown, id]);
    setWantAll(null);
    if (!dues[id] || dues[id].status === "error") loadDues(id);
    if (rule === "manual") setRule("oldest");
  }

  // ── Amount ──
  function typeKey(key: string) {
    setRollFrom(null);
    if (isManual && focus) {
      setManual((m) => ({ ...m, [focus]: Number(typeDigit(String(m[focus] || ""), key) || 0) }));
      return;
    }
    const nextText = typeDigit(amount, key);
    setAmount(nextText);
    const n = Number(nextText || 0);
    if (n > maxAll && !family) shake(amountRef.current);
  }
  function suggest(value: number) {
    setRollFrom(total);
    setAmount(String(value));
  }
  function changeRule(r: SplitRule) {
    if (r === "manual" && rule !== "manual") {
      setManual(Object.fromEntries(children.map((c, i) => [c.id, shares[i] ?? 0])));
      setFocus(children[0]?.id ?? null);
    }
    if (r !== "manual" && rule === "manual") setAmount(String(total || ""));
    setRollFrom(null);
    setRule(r);
  }

  // ── Saving ──
  function persist(a: CollectAttempt | null) {
    try {
      if (a) window.sessionStorage.setItem(storeKey, JSON.stringify(a));
      else window.sessionStorage.removeItem(storeKey);
      return true;
    } catch {
      return false;
    }
  }
  function buildPosts(): CollectPost[] | null {
    const lines = mode === "split" ? (split.ok ? tendersByChild(shares, { cash: split.cash, upi: split.upi }) : null) : null;
    const posts: CollectPost[] = [];
    for (let i = 0; i < members.length; i += 1) {
      const d = members[i];
      const share = shares[i] ?? 0;
      if (share <= 0) continue;
      const prep = prepared[d.student.id]?.result;
      if (!prep || !prep.ok) return null;
      const tender = lines ? lines[i] : ledgerTender(mode, share, null);
      if (!tender) return null;
      const waiving = waives(d) && prep.lateFee > 0;
      posts.push({
        studentId: d.student.id,
        commandId: crypto.randomUUID(),
        amount: share,
        paymentDate: date,
        paymentMode: tender.paymentMode,
        tenders: tender.tenders,
        lateFeeWaiver: waiving ? prep.lateFee : 0,
        reference: tender.tenders ? null : collectReference(mode, cheque),
        remarks: collectRemarks({ mode, cheque, waiving, lateFee: prep.lateFee, reason: late.reason }),
        acknowledgeDailyDuplicate: Boolean(paidTodayOf(d)) && ack.daily,
        acknowledgeNearDuplicate: false,
        quoteHash: prep.quoteHash,
      });
    }
    return posts.length ? posts : null;
  }
  function startSave() {
    if (busy || !info.canPost) return;
    if (save.phase === "duplicate" && attempt) {
      // The cashier ticked "this is a new payment": the refused post goes again, acknowledged, with a fresh id.
      const target = attempt.posts.find((x) => x.post.commandId === save.commandId);
      if (!target) return;
      const acked = acknowledge(target.post, save.near ? { near: ack.near, daily: true } : { daily: ack.daily }, crypto.randomUUID());
      const next: CollectAttempt = { ...attempt, posts: attempt.posts.map((x) => (x.post.commandId === save.commandId ? { post: acked, state: "pending", receipt: null, message: null } : x)) };
      if (!persist(next)) {
        setSave({ phase: "refused", message: f(mc.storageBlocked), quoteChanged: false });
        return;
      }
      void run(next);
      return;
    }
    if (!payReady) return;
    const posts = buildPosts();
    if (!posts) return;
    linesRef.current = Object.fromEntries(
      members.map((d, i) => [d.student.id, linesOf(d, shares[i] ?? 0)]),
    );
    const a: CollectAttempt = {
      version: 1,
      adapter: info.kind,
      sessionLabel: info.sessionLabel,
      createdAt: new Date().toISOString(),
      posts: posts.map((post) => ({ post, state: "pending", receipt: null, message: null })),
      summary: {
        total,
        paymentDate: date,
        tenderText: tenderPair(),
        children: Object.fromEntries(members.map((d) => [d.student.id, { name: d.student.name, classLabel: d.student.classLabel, sr: d.student.sr }])),
      },
    };
    // Stored before anything is sent: a reload after a lost answer checks these ids, never new ones.
    if (!persist(a)) {
      setSave({ phase: "refused", message: f(mc.storageBlocked), quoteChanged: false });
      return;
    }
    if (mode !== "split") {
      try {
        window.localStorage.setItem(modeKey, mode);
      } catch {
        /* a convenience only */
      }
    }
    setAttempt(a);
    void run(a);
  }
  /** The slip's lines for one child: the ledger's own order, each installment's fees then its late fee. */
  function linesOf(d: CollectDues, share: number): Array<{ label: Localized; amount: number }> {
    const out: Array<{ label: Localized; amount: number }> = [];
    let left = share;
    for (const row of orderForSettlement(d.rows)) {
      if (left <= 0) break;
      const fee = Math.min(left, row.feesPending);
      left -= fee;
      if (fee > 0) out.push({ label: row.isCarryForward ? mc.oldBalance : fill(mc.slipInstallment, { n: row.installmentNo }), amount: fee });
      if (takesLate(d) && fee === row.feesPending && row.lateFeePending > 0 && left > 0) {
        const lf = Math.min(left, row.lateFeePending);
        left -= lf;
        out.push({ label: mc.slipLate, amount: lf });
      }
    }
    return out;
  }

  async function run(start: CollectAttempt) {
    let a = start;
    const names = a.summary.children;
    for (const item of a.posts) {
      if (item.state === "saved") continue;
      const id = item.post.commandId;
      setSave({ phase: "saving", child: a.posts.length > 1 ? names[item.post.studentId]?.name ?? null : null });
      if (item.state === "uncertain") {
        const status = await port.status({ studentId: item.post.studentId, commandId: id });
        if (status.kind === "saved") {
          a = settle(a, id, { state: "saved", receipt: { ...status.receipt, amount: item.post.amount, paymentDate: item.post.paymentDate } });
          persist(a);
          continue;
        }
        setAttempt(a);
        setSave(status.kind === "not_saved" ? { phase: "notfound", commandId: id } : { phase: "uncertain", message: status.message });
        return;
      }
      const out = await port.post(item.post);
      if (out.kind === "saved") {
        a = settle(a, id, { state: "saved", receipt: out.receipt });
        persist(a);
        continue;
      }
      if (out.kind === "uncertain") {
        a = settle(a, id, { state: "uncertain", message: out.message });
        persist(a);
        setAttempt(a);
        setSave({ phase: "uncertain", message: out.message });
        return;
      }
      a = settle(a, id, { state: "refused", message: out.message });
      if (out.kind === "duplicate") {
        persist(a);
        setAttempt(a);
        setAck({ daily: false, near: false });
        setSave({ phase: "duplicate", near: out.near, receipt: out.receiptNumber, commandId: id });
        if (cardNow.current !== "check") go("check");
        return;
      }
      // A definite refusal stored nothing. With nothing else saved, the payment can simply be edited.
      if (nothingPosted(a)) {
        persist(null);
        setAttempt(null);
      } else {
        persist(a);
        setAttempt(a);
      }
      setSave({ phase: "refused", message: out.message, quoteChanged: out.quoteChanged });
      return;
    }
    if (!allSaved(a)) return;
    persist(null);
    setAttempt(a);
    finish(a, true);
  }
  function finish(a: CollectAttempt, animate: boolean) {
    const receipts = savedReceipts(a);
    const view: SealedView = {
      receipts,
      children: a.summary.children,
      lines: linesRef.current,
      total: a.summary.total,
      paymentDate: a.summary.paymentDate,
      tenderText: a.summary.tenderText,
      by: receipts[0]?.receivedBy ?? info.staffName,
      sessionLabel: info.sessionLabel,
    };
    setSealed({ view, animate });
    setDesk((prev) => [...receipts.map((r) => ({ ...r, name: a.summary.children[r.studentId]?.name ?? "" })), ...prev]);
    const paid: LikelyRow[] = receipts.flatMap((r) => {
      const d = okDues(dues[r.studentId]);
      const c = a.summary.children[r.studentId];
      return c ? [{ id: r.studentId, name: c.name, sr: c.sr, classLabel: c.classLabel, father: d?.student.father ?? null, phone: d?.student.phone ?? null, fees: r.remaining ?? 0, late: 0, siblings: d?.siblings.length ?? 0, reason: "paid_recently" as const }] : [];
    });
    const sibs: LikelyRow[] = receipts.flatMap((r) =>
      (okDues(dues[r.studentId])?.siblings ?? [])
        .filter((s) => !receipts.some((x) => x.studentId === s.id))
        .flatMap((s) => {
          const sd = okDues(dues[s.id]);
          const t = sd ? childTotals({ id: s.id, rows: sd.rows, takeLate: true }, today) : null;
          return t && t.fees > 0 && sd ? [{ id: s.id, name: s.name, sr: sd.student.sr, classLabel: s.classLabel, father: sd.student.father, phone: sd.student.phone, fees: t.fees, late: t.late, siblings: 0, reason: "sibling_of_last" as const }] : [];
        }),
    );
    const merged = [...sibs, ...paid, ...recents.filter((r) => !paid.some((x) => x.id === r.id) && !sibs.some((x) => x.id === r.id))].slice(0, RECENT_CAP);
    setRecents(merged);
    writeJson(recentKey, merged);
    if (animate && cardNow.current !== "who" && cardNow.current !== "sealed") setSave({ phase: "sealing" });
    else {
      setSave({ phase: "idle" });
      go("sealed");
    }
  }
  useEffect(() => {
    if (save.phase !== "sealing" || !sealRef.current) return;
    let live = true;
    void stamp(sealRef.current, ringRef.current, cardRef.current).then(() => {
      if (!live) return;
      setSave({ phase: "idle" });
      go("sealed");
    });
    return () => {
      live = false;
    };
  }, [save.phase]);

  function checkAgain() {
    if (attempt) void run(attempt);
  }
  function sendAgain(commandId: string) {
    if (!attempt) return;
    // The ledger has no payment with this id: the same body goes again with the same id.
    const a: CollectAttempt = { ...attempt, posts: attempt.posts.map((x) => (x.post.commandId === commandId ? { ...x, state: "pending" } : x)) };
    persist(a);
    void run(a);
  }
  /**
   * "Retry the rest": the children not saved go again. When the dues moved
   * (quote_changed) each is quoted afresh first — a new quote is a new body,
   * so it goes with a new id; a refused post stored nothing under the old one.
   */
  async function retryRest() {
    if (!attempt) return;
    const requote = save.phase === "refused" && save.quoteChanged;
    setSave({ phase: "saving", child: null });
    const posts = await Promise.all(
      attempt.posts.map(async (x) => {
        if (x.state !== "refused") return x;
        if (!requote) return { ...x, state: "pending" as const };
        const fresh = await port.prepare({ studentId: x.post.studentId, amount: x.post.amount, paymentDate: x.post.paymentDate, waive: x.post.lateFeeWaiver > 0 });
        if (!fresh.ok) return x;
        return { ...x, state: "pending" as const, post: { ...x.post, commandId: crypto.randomUUID(), quoteHash: fresh.quoteHash, lateFeeWaiver: x.post.lateFeeWaiver > 0 ? fresh.lateFee : 0 } };
      }),
    );
    const a: CollectAttempt = { ...attempt, posts };
    if (!persist(a)) {
      setSave({ phase: "refused", message: f(mc.storageBlocked), quoteChanged: false });
      return;
    }
    void run(a);
  }
  /** Stop with the receipts that were saved; the others were never posted. */
  function finishSaved() {
    if (!attempt) return;
    const saved = savedReceipts(attempt);
    const a: CollectAttempt = { ...attempt, posts: attempt.posts.filter((x) => x.state === "saved"), summary: { ...attempt.summary, total: saved.reduce((sum, r) => sum + r.amount, 0) } };
    persist(null);
    setAttempt(a);
    finish(a, false);
  }
  function dismissRefusal(toAmount: boolean) {
    setSave({ phase: "idle" });
    if (toAmount) {
      setPrepared({});
      go("amount");
    }
  }

  // ── Keyboard (the prototype's shortcuts) ──
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = Boolean(target?.matches?.("input:not([type=checkbox]),textarea"));
      const k = e.key;
      if (ticketOpen && k === "Escape") {
        setTicketOpen(false);
        return;
      }
      if (save.phase === "saving" || save.phase === "sealing") {
        e.preventDefault();
        return;
      }
      if (k === "Escape" && card !== "who" && card !== "sealed") {
        e.preventDefault();
        back();
        return;
      }
      if (card === "who") {
        const rows = q.trim() ? foundNow.rows : likely;
        if (k === "ArrowDown" || k === "ArrowUp") {
          e.preventDefault();
          if (rows.length) setHl((h) => (Math.min(h, rows.length - 1) + (k === "ArrowDown" ? 1 : -1) + rows.length) % rows.length);
          return;
        }
        if (k === "Enter") {
          e.preventDefault();
          // Never open a child from the previous search while this one is still coming back.
          if (q.trim() && foundNow.loading) return;
          const row = rows[Math.min(hl, rows.length - 1)];
          if (row) pick(row, false);
          return;
        }
        if (!inField && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) searchRef.current?.focus();
        return;
      }
      if (card === "dues") {
        if (k === "Enter") {
          e.preventDefault();
          next();
        } else if ((k === "w" || k === "W") && info.canWaive && familyLate) setLate((l) => ({ ...l, choice: "waive" }));
        else if ((k === "c" || k === "C") && info.canWaive && familyLate) setLate((l) => ({ ...l, choice: "collect" }));
        return;
      }
      if (card === "amount") {
        if (inField) return;
        if (/^\d$/.test(k)) {
          e.preventDefault();
          typeKey(k);
          return;
        }
        if (k === "Backspace") {
          e.preventDefault();
          typeKey("⌫");
          return;
        }
        if (k === "Tab" && isManual) {
          e.preventDefault();
          const ids = children.map((c) => c.id);
          setFocus((cur) => ids[(Math.max(0, ids.indexOf(cur ?? "")) + 1) % ids.length]);
          return;
        }
        const lk = k.toLowerCase();
        if (["o", "n", "y", "l"].includes(lk) && !isManual) {
          const s = (family ? familySuggestions(children, today) : amountSuggestions(children[0], today, lastAmount)).find((x) => x.key.toLowerCase() === lk);
          if (s) {
            e.preventDefault();
            suggest(s.amount);
          }
          return;
        }
        if (k === "Enter") {
          e.preventDefault();
          next();
        }
        return;
      }
      if (card === "pay") {
        if (sub) {
          if (k === "Enter" && !inField) {
            e.preventDefault();
            setSub(null);
          }
          return;
        }
        const fk: Record<string, CollectMode> = { F1: "cash", F2: "upi", F3: "bank_transfer", F4: "cheque", F5: "split" };
        if (fk[k]) {
          e.preventDefault();
          chooseMode(fk[k]);
          return;
        }
        if (!inField && (k === "ArrowLeft" || k === "ArrowRight")) {
          e.preventDefault();
          setDate((d0) => stepDate(d0, k === "ArrowLeft" ? -1 : 1, { today, sessionStart: info.sessionStart }));
          return;
        }
        if (!inField && (k === "t" || k === "T")) {
          setDate(today);
          return;
        }
        if ((k === "Enter" || k === " ") && !e.repeat && (!inField || k === "Enter")) {
          e.preventDefault();
          if (needsCheck) {
            if (k === "Enter") next();
          } else holdRef.current?.start();
        }
        return;
      }
      if (card === "check") {
        if ((k === "Enter" || k === " ") && !e.repeat && !inField) {
          e.preventDefault();
          holdRef.current?.start();
        }
        return;
      }
      if (card === "sealed" && (k === "n" || k === "N" || k === "Enter")) {
        const btn = rootRef.current?.querySelector<HTMLButtonElement>("[data-next-student]");
        if (btn && !btn.disabled) {
          e.preventDefault();
          btn.click();
        }
      }
    };
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current(e);
    const up = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") holdRef.current?.stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  function chooseMode(m: CollectMode) {
    setMode(m);
    setReceived(null);
    setNotes(null);
  }

  useOverflowCheck(rootRef, [card, sub, language, total, mode, save.phase, members.length]);

  const lastAmount = primary?.receipts.find((r) => !r.reversed)?.amount ?? null;
  const vis = visibleCards(needsCheck, card).filter((c) => c !== "sealed");

  // ── The overlay on the saving card ──
  const overlay: ReactNode = (() => {
    if (save.phase === "saving")
      return (
        <div className="cx-sv" role="status">
          <div className="stampy"><Seal date={attempt?.summary.paymentDate ?? date} /></div>
          <b>{p(save.child ? fill(mc.savingChild, { name: save.child }) : info.kind === "bridge" ? mc.savingBridge : mc.savingLocal)}</b>
        </div>
      );
    if (save.phase === "uncertain")
      return (
        <div className="cx-sv amber" role="alert">
          <div className="cx-spin" />
          <b>{p(mc.checkingSaved)}</b>
          <p>{save.message === f(mc.resumeFound) ? p(mc.resumeFound) : p(mc.checkingExplain)}</p>
          <div className="acts2"><button type="button" className="cx-btn sec sm" onClick={checkAgain}>{p(mc.checkAgain)}</button></div>
        </div>
      );
    if (save.phase === "notfound")
      return (
        <div className="cx-sv amber" role="alert">
          <Icon name="info" size={28} />
          <p>{p(mc.notSavedSendAgain)}</p>
          <div className="acts2"><button type="button" className="cx-btn pri sm" disabled={!info.canPost} onClick={() => sendAgain(save.commandId)}>{p(mc.sendAgain)}</button></div>
        </div>
      );
    if (save.phase === "refused") {
      const saved = attempt ? savedReceipts(attempt) : [];
      const names = attempt?.summary.children ?? {};
      if (saved.length && attempt) {
        const notSaved = attempt.posts.filter((x) => x.state !== "saved").map((x) => names[x.post.studentId]?.name ?? "");
        return (
          <div className="cx-sv amber" role="alert">
            <Icon name="alert" size={28} />
            <p>{p(fill(mc.partSaved, { name: saved.map((r) => names[r.studentId]?.name ?? r.receiptNumber).join(", ") }))}</p>
            <p>{p(fill(mc.partNotSaved, { name: notSaved.join(", ") }))}{save.quoteChanged ? p(mc.quoteChanged) : save.message}</p>
            <div className="acts2">
              <button type="button" className="cx-btn pri sm" disabled={!info.canPost} onClick={() => void retryRest()}>{p(mc.retryRest)}</button>
              <button type="button" className="cx-btn sec sm" onClick={finishSaved}>{p(mc.finishSaved)}</button>
            </div>
          </div>
        );
      }
      return (
        <div className="cx-sv bad" role="alert">
          <Icon name="alert" size={28} />
          <p>{save.quoteChanged ? p(mc.quoteChanged) : save.message}</p>
          <div className="acts2">
            <button type="button" className="cx-btn sec sm" onClick={() => dismissRefusal(save.quoteChanged)}>{p(save.quoteChanged ? mc.changeAmount : mc.refusedBack)}</button>
          </div>
        </div>
      );
    }
    if (save.phase === "sealing")
      return (
        <div className="cx-seal" ref={sealRef}>
          <Seal date={attempt?.summary.paymentDate ?? date} />
          <span className="cx-inkring" ref={ringRef} />
        </div>
      );
    return null;
  })();

  // ── The card on screen ──
  let body: ReactNode;
  if (boot.unreadable) {
    body = (
      <CardShell eyebrow={mc.stepPay} title={mc.checkingSaved} foot={<Link className="cx-btn sec" style={{ flex: 1 }} href="/payments?classic=1">{p(mc.classic)}</Link>}>
        <div className="cx-error"><Icon name="alert" size={28} /><p>{p(mc.recoveryUnreadable)}</p></div>
      </CardShell>
    );
  } else if (attempt && !sealed && members.length === 0 && card !== "check") {
    // An unfinished payment restored after a reload: nothing else is offered until it is resolved.
    body = (
      <CardShell eyebrow={mc.stepPay} title={mc.checkingSaved} foot={<span className="cx-hint">{both(attempt.summary.tenderText)}</span>}>
        <div className="cx-ticket">
          {attempt.posts.map((x) => (
            <div key={x.post.commandId} className="cx-tl">
              <span className="lab">{attempt.summary.children[x.post.studentId]?.name ?? ""}</span>
              <span className="val">{money(x.post.amount)} <small>{p(dayMonth(x.post.paymentDate))}</small></span>
              <span />
            </div>
          ))}
          <div className="cx-ttotal"><b>{money(attempt.summary.total)}</b></div>
          {overlay}
        </div>
      </CardShell>
    );
  } else if (card === "sealed" && sealed) {
    const sibling = (() => {
      const paid = new Set(sealed.view.receipts.map((r) => r.studentId));
      const base = primary ?? (primaryId ? okDues(dues[primaryId]) : null);
      const pool = base ? [base.student.id, ...base.siblings.map((s) => s.id)] : [];
      for (const id of pool) {
        if (paid.has(id)) continue;
        const d = okDues(dues[id]);
        if (d && childTotals({ id, rows: d.rows, takeLate: true }, today).fees > 0) return { id, name: d.student.name };
      }
      return null;
    })();
    body = (
      <SealedCard
        view={sealed.view}
        animate={sealed.animate}
        nextSibling={sibling}
        onNextStudent={resetAll}
        onNextSibling={() => {
          if (!sibling) return;
          const d = okDues(dues[sibling.id]);
          resetMoney();
          setPrimaryId(sibling.id);
          setFam([sibling.id]);
          setFocus(sibling.id);
          setWantAll(null);
          setDone(new Set<Card>(["who"]));
          loadDues(sibling.id);
          go("dues", { text: d?.student.name ?? sibling.name, from: "who" });
        }}
      />
    );
  } else if (card === "who") {
    body = <WhoCard query={q} onQuery={(v) => { setQ(v); setHl(0); }} found={foundNow} likely={likely} highlight={hl} onPick={pick} inputRef={searchRef} />;
  } else if (!primary) {
    const state = primaryId ? dues[primaryId] : undefined;
    body = (
      <CardShell eyebrow={mc.stepDues} title={mc.duesTitle} foot={<button type="button" className="cx-btn sec" style={{ flex: 1 }} onClick={resetAll}>{p(mc.goBack)}</button>}>
        {state && state.status === "error" ? (
          <div className="cx-error">
            <Icon name="alert" size={28} />
            <p>{p(mc.duesFailed)}</p>
            <button type="button" className="cx-btn sec sm" onClick={() => primaryId && loadDues(primaryId)}>{p(mc.retry)}</button>
          </div>
        ) : (
          <div className="cx-empty">{p(mc.loadingNow)}</div>
        )}
      </CardShell>
    );
  } else if (card === "dues") {
    const siblings: SiblingView[] = primary.siblings
      .map((s) => {
        const st = dues[s.id];
        return { id: s.id, name: s.name, classLabel: s.classLabel, ticked: famShown.includes(s.id), dues: okDues(st), loading: st?.status === "loading", outstanding: s.outstanding };
      })
      .filter((s) => s.ticked || !s.dues || childTotals({ id: s.id, rows: s.dues.rows, takeLate: true }, today).fees > 0);
    body = (
      <DuesCard
        dues={primary}
        today={today}
        paidToday={paidTodayOf(primary)}
        siblings={siblings}
        familyCount={members.length}
        canWaive={info.canWaive}
        choice={choice}
        reason={late.reason}
        familyLate={familyLate}
        onLate={(c) => setLate((l) => ({ ...l, choice: c }))}
        onReason={() => setLate((l) => ({ ...l, reason: nextReason(l.reason) }))}
        onSibling={toggleSibling}
        onBack={back}
        onNext={next}
      />
    );
  } else if (card === "amount") {
    body = (
      <AmountCard
        kids={children}
        total={total}
        shares={shares}
        max={maxAll}
        ok={amountOk}
        rule={rule}
        focus={focus}
        suggestions={family ? familySuggestions(children, today) : amountSuggestions(children[0], today, lastAmount)}
        rollFrom={rollFrom}
        onDate={today}
        onSuggestion={suggest}
        onKey={typeKey}
        onRule={changeRule}
        onFocus={setFocus}
        onBack={back}
        onNext={next}
        amountRef={amountRef}
      />
    );
  } else if (card === "pay") {
    body = (
      <>
        <PayCard
          total={total}
          sr={primary.student.sr}
          mode={mode}
          modes={accepted}
          canSplit={info.canSplit}
          showRealQr={info.showRealQr}
          received={received}
          notes={notes}
          splitCash={splitCash}
          cheque={cheque}
          date={date}
          today={today}
          sessionStart={info.sessionStart}
          calMonth={calMonth}
          sub={sub}
          effect={effect}
          needsCheck={needsCheck}
          ready={payReady && !busy}
          canPost={info.canPost}
          holdRef={holdRef}
          onMode={chooseMode}
          onReceived={(v) => {
            setReceived(v);
            setNotes(null);
          }}
          onNote={(d, by) => {
            const n = bumpNote(notes ?? {}, d, by);
            setNotes(n);
            setReceived(notesTotal(n));
          }}
          onSplitCash={setSplitCash}
          onCheque={(patch) => setCheque((c) => ({ ...c, ...patch }))}
          onDate={(d) => {
            if (!datePickable(d, { today, sessionStart: info.sessionStart })) return;
            setDate(d);
            if (sub === "cal") setSub(null);
          }}
          onCalMonth={setCalMonth}
          onSub={setSub}
          onAmount={() => jumpTo("amount")}
          onBack={back}
          onNext={next}
          onSave={startSave}
        />
        {!sub ? <div className="cx-overlay-host">{overlay}</div> : null}
      </>
    );
  } else {
    const lines: TicketLine[] = [];
    if (family) {
      members.forEach((d, i) => {
        if ((shares[i] ?? 0) <= 0) return;
        lines.push({ key: d.student.id, label: { hi: `${firstName(d.student.name)} · ${d.student.classLabel}`, en: `${firstName(d.student.name)} · ${d.student.classLabel}` }, value: <>{money(shares[i])} <small className="al">· {p(allocText(d.rows, shares[i], takesLate(d), date))}</small></>, goto: "amount" });
      });
    } else {
      lines.push({ key: "student", label: mc.lineStudent, value: <>{primary.student.name} <small>{primary.student.classLabel} · {primary.student.sr}</small></>, goto: "dues" });
      lines.push({ key: "goes", label: mc.lineGoesTo, value: p(allocText(primary.rows, total, takesLate(primary), date)), goto: "amount" });
    }
    if (familyLate) {
      const waiving = info.canWaive && choice === "waive";
      lines.push({ key: "late", label: mc.lateFee, value: waiving ? <>{p(fill(mc.lateWaived, { a: money(lateOnDate || familyLate) }))} <small>{p(REASON_TEXT[late.reason])}</small></> : p(fill(mc.lateCollected, { a: money(lateOnDate || familyLate) })), goto: info.canWaive ? "dues" : null });
    }
    lines.push({ key: "pay", label: mc.linePayment, value: p(tenderPair()), goto: "pay" });
    lines.push({ key: "date", label: mc.lineDate, value: <>{p(dayMonth(date))}{date !== today ? <small> · {p(mc.backdatedSmall)}</small> : null}</>, goto: "pay" });
    lines.push({ key: "by", label: mc.lineBy, value: info.staffName, goto: null });
    const dup = save.phase === "duplicate" ? save : null;
    body = (
      <CheckCard
        reasons={reasons}
        lines={lines}
        total={total}
        saved={Boolean(sealed)}
        ack={paidTodayAny || (dup && !dup.near) ? { needed: true, receipt: dup?.receipt ?? paidTodayAny?.number ?? null, ticked: ack.daily } : null}
        near={dup && dup.near ? { receipt: dup.receipt, allowed: info.canAdjust, ticked: ack.near } : null}
        ready={(payReady || save.phase === "duplicate") && !busy}
        canPost={info.canPost}
        holdRef={holdRef}
        overlay={overlay}
        onAck={(v) => setAck((a) => ({ ...a, daily: v }))}
        onNear={(v) => setAck((a) => ({ ...a, near: v }))}
        onGoto={jumpTo}
        onBack={back}
        onSave={startSave}
      />
    );
  }

  // ── Rail, strip and side panel ──
  const railItems = vis.map((c, i) => {
    const isDone = done.has(c) || (c === "who" && Boolean(primary)) || Boolean(sealed);
    const v = chipText(c);
    const can = !busy && canJumpTo(c, { current: card, done }, Boolean(sealed)) && isDone;
    const title = { who: mc.cardWho, dues: mc.cardDues, amount: mc.cardAmount, pay: mc.cardPay, check: mc.cardCheck, sealed: mc.cardCheck }[c];
    return (
      <button type="button" key={c} data-chip={c} className={`cx-ri${isDone ? " done" : ""}${c === card ? " cur" : ""}${c === "check" ? " opt" : ""}`} disabled={!can} onClick={() => jumpTo(c)}>
        <span className="dot">{isDone ? <Icon name="check" size={14} /> : i + 1}</span>
        <span>
          <span className="lab">{p(title)}{c === "check" ? ` · ${p(mc.needed)}` : ""}</span>
          <span className={`val${v ? "" : " empty"}`}>{v || "—"}</span>
        </span>
      </button>
    );
  });
  const summary = (["who", "amount", "pay"] as Card[]).map(chipText).filter(Boolean);

  return (
    <div className="vx cx" ref={rootRef} data-card={card}>
      <header className="cx-head">
        <b><Bi text={mc.title} inline /></b>
        <span className="cx-pill cx-ses">{info.sessionLabel}</span>
        {props.testSession ? <span className="cx-pill test">{p(mc.testLedger)}</span> : null}
        {!info.canPost ? <span className="cx-pill ro" role="status">{p(mc.readOnly)}</span> : null}
        <span className="cx-sp" />
        <Link className="cx-classic" href="/payments?classic=1" prefetch={false}>{p(mc.classic)}</Link>
      </header>
      <nav className="cx-rail" aria-label={f(mc.ticket)}>
        <h3>{p(mc.ticket)}</h3>
        <p>{p(mc.ticketHelp)}</p>
        {railItems}
        {!vis.includes("check") && primary ? <p style={{ marginTop: 8 }}>{p(mc.ticketNoCheck)}</p> : null}
      </nav>
      <button type="button" className="cx-strip" aria-label={f(mc.ticketShow)} onClick={() => setTicketOpen(true)}>
        <span className="cx-dots" data-chip="strip">
          {vis.map((c) => (
            <i key={c} className={`${done.has(c) || (c === "who" && primary) || sealed ? "done" : ""}${c === card ? " cur" : ""}`} />
          ))}
        </span>
        <span className="cx-sum">{summary.length ? summary.join(" · ") : p(mc.ticketStart)}</span>
        <Icon name="list" size={16} />
      </button>
      <main className="cx-stage">
        <div className="cx-ghosts" ref={ghostRef} />
        <section className={`cx-card${busy ? " cx-busy" : ""}`} ref={cardRef} key={card} data-step={card} aria-live="polite">
          {body}
        </section>
        {ticketOpen ? (
          <div className="cx-ovl">
            <button type="button" className="scr" aria-label={f(mc.goBack)} onClick={() => setTicketOpen(false)} />
            <div className="panel">{railItems}</div>
          </div>
        ) : null}
      </main>
      <aside className="cx-ctx">
        {members.map((d) => (
          <div className="cx-cbox" key={d.student.id}>
            <h4>{p(d.student.id === primary?.student.id ? mc.lineStudent : mc.siblingIn)}</h4>
            <div style={{ fontWeight: 700 }}>{d.student.name} <span style={{ color: "var(--mut)", fontWeight: 500 }}>· {d.student.classLabel}</span></div>
            <YearBar rows={d.rows} takeLate={takesLate(d)} onDate={today} slim />
            {d.receipts.slice(0, 3).map((r) => (
              <div className="cx-rl" key={r.id}><span>{p(dayMonth(r.date))} · <span className="mono">{r.number.slice(-4)}</span></span><b>{money(r.amount)}</b></div>
            ))}
          </div>
        ))}
        {desk.length ? (
          <div className="cx-cbox">
            <h4>{p(mc.today)}</h4>
            <div className="big">{money(desk.reduce((s, r) => s + r.amount, 0))}</div>
            {desk.slice(0, 3).map((r) => (
              <div className="cx-rl" key={r.receiptId}><span>{firstName(r.name)} · <span className="mono">{r.receiptNumber.slice(-4)}</span></span><b>{money(r.amount)}</b></div>
            ))}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
