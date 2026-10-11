"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import type { Pair } from "@/vx/text";
import { Chip, ChipRow } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Split, TopBar } from "@/vx/ui/page";
import { Btn, Card, EmptyState, IconTile, Pill, type Tone } from "@/vx/ui/primitives";
import { INBOX_TYPES, inboxCounts, whenLabel, type InboxType } from "@/vx/screens/admin/logic";
import { T } from "@/vx/screens/admin/text";
import type { CoverCandidate, InboxItem } from "@/vx/screens/admin/types";
import { readEarlierInboxDecisions, readInboxDecisions, removeInboxDecision, storeInboxDecision, type InboxBeacon, type InboxScope, type PendingInboxDecision } from "@/vx/screens/admin/inbox-outbox";

/*
 * Needs you (design F02/D03). A decision is held on this device for a few
 * seconds before it is sent, so Undo really undoes: nothing has reached the
 * server yet. Leaving the page sends whatever is still held.
 */

const HOLD_MS = 6000;

const TYPE_LABEL: Record<"all" | InboxType, Pair> = {
  all: T.tAll,
  attendance: T.tAttendance,
  money: T.tMoney,
  timetable: T.tTimetable,
  students: T.tStudents,
  system: T.tSystem,
};

const LOOK: Record<InboxItem["kind"], { icon: IconName; tone: Tone }> = {
  not_marked: { icon: "calCheck", tone: "warn" },
  cover: { icon: "swap", tone: "info" },
  submission: { icon: "clipboard", tone: "acc" },
  confirmations: { icon: "ticks", tone: "ok" },
  refund: { icon: "rupee", tone: "acc" },
  job: { icon: "alert", tone: "bad" },
};

/** What `/api/inbox` needs to send a held decision after the page has gone. */
type Beacon = InboxBeacon;
type Held = PendingInboxDecision & { timer: number; send: () => Promise<{ ok: boolean; message?: Pair }>; label: string; sending: boolean; flushing: boolean };

export function InboxScreen({ items, initial, previewing, unavailable, scope }: { items: InboxItem[]; initial: string | null; previewing: boolean; unavailable: boolean; scope: InboxScope }) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | InboxType>("all");
  const [selectedId, setSelectedId] = useState<string | null>(initial ?? items[0]?.id ?? null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState<InboxItem | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [earlier, setEarlier] = useState<PendingInboxDecision[]>([]);
  const held = useRef(new Map<string, Held>());

  const live = items.filter((item) => !hidden.has(item.id));
  const counts = inboxCounts(live);
  const shown = filter === "all" ? live : live.filter((item) => item.type === filter);
  const selected = live.find((item) => item.id === selectedId) ?? shown[0] ?? null;

  function acknowledge(id: string, entry: Held) {
    if (held.current.get(id) !== entry) return;
    try { removeInboxDecision(entry); } catch { /* A replay remains safe with the same id. */ }
    held.current.delete(id); setPendingCount(held.current.size);
  }
  function stillStored(id: string, entry: Held): boolean {
    if (held.current.get(id) !== entry) return false;
    const saved = readInboxDecisions(entry.scope).find(d => d.itemId === id && d.beacon.commandId === entry.beacon.commandId);
    if (saved && JSON.stringify(saved.beacon) === JSON.stringify(entry.beacon)) return true;
    window.clearTimeout(entry.timer); held.current.delete(id); setPendingCount(held.current.size);
    setHidden(all => { const next = new Set(all); next.delete(id); return next; });
    return false;
  }
  async function deliver(id: string, entry: Held) {
    if (entry.sending || entry.flushing || previewing || (!entry.attempted && Date.now() < entry.readyAt)) return;
    try { if (!stillStored(id, entry)) return; }
    catch { toast.show({ text: tx(T.inboxStorageFailed), tone: "bad" }); return; }
    entry.attempted = true;
    try { storeInboxDecision(entry); } catch { toast.show({ text: tx(T.inboxStorageFailed), tone: "bad" }); return; }
    entry.sending = true;
    const result = await entry.send().catch(() => ({ ok: false, message: T.failed }));
    entry.sending = false;
    if (result.ok) acknowledge(id, entry);
    else {
      setHidden(all => { const next = new Set(all); next.delete(id); return next; });
      toast.show({ text: tx(result.message ?? T.failed), tone: "bad" });
    }
    router.refresh();
  }

  // Send anything still held when the page goes away; the person decided it.
  useEffect(() => {
    const pending = held.current;
    pending.clear();
    const post = async (entry: PendingInboxDecision, keepalive = false) => {
      const response = await fetch("/api/inbox", { method: "POST", keepalive, headers: { "content-type": "application/json" }, body: JSON.stringify({ ...entry.beacon, scope: entry.scope }) });
      return { ok: response.ok && (await response.json()).ok === true };
    };
    const restore = () => {
      if (previewing) return;
      try {
        const saved = readInboxDecisions(scope);
        setEarlier(readEarlierInboxDecisions(scope));
        const ids = new Set(saved.map(d => d.itemId));
        for (const [id, entry] of pending) if (!ids.has(id) && !entry.sending) {
          window.clearTimeout(entry.timer); pending.delete(id);
          setHidden(all => { const next = new Set(all); next.delete(id); return next; });
        }
        for (const d of saved) if (!pending.has(d.itemId)) {
          const entry: Held = { ...d, timer: 0, label: "", send: () => post(d), sending: false, flushing: false };
          pending.set(d.itemId, entry);
          entry.timer = window.setTimeout(() => { void deliver(d.itemId, entry); }, Math.max(0, d.readyAt - Date.now()));
        }
        setPendingCount(pending.size);
      } catch { toast.show({ text: tx(T.inboxStorageFailed), tone: "bad" }); }
    };
    restore();
    // A server action started here is cancelled with the page, so the held
    // decision goes as a keepalive request that outlives it.
    const flush = () => {
      for (const [id, entry] of pending) {
        if (entry.flushing) continue;
        try { if (!stillStored(id, entry)) continue; } catch { continue; }
        entry.attempted = true;
        try { storeInboxDecision(entry); } catch { continue; }
        window.clearTimeout(entry.timer);
        entry.sending = true;
        entry.flushing = true;
        void post(entry, true)
          .then((response) => {
            if (response.ok) acknowledge(id, entry);
          })
          .catch(() => undefined)
          .finally(() => { entry.flushing = false; entry.sending = false; });
      }
    };
    window.addEventListener("pagehide", flush);
    const retry = () => { for (const [id, entry] of pending) void deliver(id, entry); };
    window.addEventListener("online", retry);
    window.addEventListener("storage", restore);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", retry);
      window.removeEventListener("storage", restore);
      flush();
    };
  // Scope comes from the authenticated server page; old-account work is never replayed here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.accountId, scope.sessionLabel, scope.day, previewing]);

  function handleDecision(item: InboxItem, label: string, beacon: Beacon) {
    if (previewing) {
      toast.show({ text: tx(T.previewing), tone: "info" });
      return;
    }
    if (held.current.has(item.id)) { toast.show({ text: tx(T.inboxPending), tone: "info" }); return; }
    // Called only by Detail's click handlers; the forwarded actions object
    // prevents the compiler from recognizing this as an event-time timestamp.
    // eslint-disable-next-line react-hooks/purity
    const decision: PendingInboxDecision = { itemId: item.id, beacon, scope, readyAt: Date.now() + HOLD_MS, attempted: false };
    try { storeInboxDecision(decision); } catch { toast.show({ text: tx(T.inboxStorageFailed), tone: "bad" }); return; }
    setHidden((all) => new Set(all).add(item.id));
    setPhoneOpen(false);
    const next = live.find((other) => other.id !== item.id && (filter === "all" || other.type === filter));
    setSelectedId(next?.id ?? null);

    const timer = window.setTimeout(async () => {
      const entry = held.current.get(item.id);
      if (!entry) return;
      await deliver(item.id, entry);
    }, HOLD_MS);
    const send = async () => {
      const response = await fetch("/api/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...beacon, scope }) });
      return { ok: response.ok && (await response.json()).ok === true };
    };
    held.current.set(item.id, { ...decision, timer, send, label, sending: false, flushing: false });
    setPendingCount(held.current.size);

    toast.show({
      text: label,
      undoLabel: tx(T.undo),
      ms: HOLD_MS,
      undo: () => {
        const entry = held.current.get(item.id);
        if (!entry || entry.sending || entry.attempted) return;
        try { removeInboxDecision(entry); } catch { toast.show({ text: tx(T.inboxStorageFailed), tone: "bad" }); return; }
        window.clearTimeout(entry.timer);
        held.current.delete(item.id);
        setPendingCount(held.current.size);
        setHidden((all) => {
          const copy = new Set(all);
          copy.delete(item.id);
          return copy;
        });
        setSelectedId(item.id);
      },
    });
  }

  function select(item: InboxItem) {
    setSelectedId(item.id);
    if (window.matchMedia("(max-width: 899px)").matches) setPhoneOpen(true);
  }

  const assign = (item: InboxItem, who: CoverCandidate) => {
    const commandId = crypto.randomUUID();
    const input = { commandId, needKey: item.needKey!, coveringStaffId: who.id, day: item.day!, dayRevision: item.dayRevision! };
    handleDecision(item, `${tx(T.assigned(who.name))}`, { kind: "cover", ...input });
  };

  const on: DetailActions = {
    remind: (item) =>
      handleDecision(item, tx(T.reminded(item.remindable ?? 0)), { kind: "remind", commandId: crypto.randomUUID(), classIds: item.classIds ?? [] }),
    assign,
    pick: (item) => setPicking(item),
    submissions: (item, accept) => {
      const commandId = crypto.randomUUID();
      handleDecision(item, `${tx(accept ? T.accepted : T.declined)} · ${tx(item.title)}`, { kind: "submissions", commandId, submissionIds: item.submissionIds ?? [], accept });
    },
  };

  const detailPane = selected ? <Detail item={selected} on={on} /> : <EmptyState icon="inbox" title={tx(T.pickItem)} />;

  const list = (
    <div style={{ minWidth: 0, borderRight: "1px solid var(--bd)" }}>
      <div style={{ padding: "16px 16px 12px" }}>
        <ChipRow label={tx(T.needsYou)} style={{ flexWrap: "wrap" }}>
          {(["all", ...INBOX_TYPES] as const)
            .filter((key) => key === "all" || counts[key] > 0)
            .map((key) => (
              <Chip key={key} on={filter === key} count={counts[key]} onClick={() => setFilter(key)}>
                {tx(TYPE_LABEL[key])}
              </Chip>
            ))}
        </ChipRow>
      </div>
      {unavailable ? <p style={{ margin: "0 16px 10px", fontSize: 13, color: "var(--warnfg)" }}>{tx(T.couldNotRead)}</p> : null}
      {!previewing && earlier.length > 0 ? <div style={{ margin: "0 16px 10px" }}><p>{tx(T.inboxEarlier)} ({earlier.length})</p><p>{tx(T.inboxEarlierHint)}</p><Btn variant="ghost" onClick={() => {
        try { for (const entry of earlier) removeInboxDecision(entry); setEarlier(readEarlierInboxDecisions(scope)); }
        catch { toast.show({ text: tx(T.inboxStorageFailed), tone: "bad" }); }
      }}>{tx(T.inboxClearReviewed)}</Btn></div> : null}
      {pendingCount > 0 ? <div style={{ margin: "0 16px 10px" }}><p>{tx(T.inboxPending)}</p><Btn variant="ghost" onClick={() => { for (const [id, entry] of held.current) void deliver(id, entry); }}>{tx(T.inboxRetry)}</Btn></div> : null}
      {live.length === 0 ? (
        <EmptyState icon="checkCircle" title={tx(T.emptyInbox)} body={tx(T.emptyInboxSub)} />
      ) : shown.length === 0 ? (
        <EmptyState icon="inbox" title={tx(T.emptyType)} />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {shown.map((item, i) => {
            const look = LOOK[item.kind];
            const on = selected?.id === item.id;
            return (
              <li key={item.id} style={{ animation: `xIn .32s var(--ease) ${Math.min(i * 22, 400)}ms both` }}>
                <button
                  type="button"
                  onClick={() => select(item)}
                  className={`row tap${on ? " sel" : ""}`}
                  aria-current={on ? "true" : undefined}
                  style={{ width: "100%", textAlign: "left", display: "flex", flexDirection: "column", gap: 4, padding: "14px 16px", border: 0, borderTop: "1px solid var(--bd)", background: on ? "var(--accs)" : "transparent", boxShadow: on ? "inset 0 0 0 1.5px var(--acc)" : undefined, color: "var(--fg)" }}
                >
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <Pill tone={look.tone} icon={look.icon}>{tx(item.badge)}</Pill>
                    <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{whenLabel(item.at)}</span>
                  </span>
                  <span className="clip" style={{ fontWeight: 600, fontSize: 15 }}>{tx(item.title)}</span>
                  <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(item.sub)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <>
      <TopBar crumb={tx(T.inboxCrumb(live.length))} title={tx(T.needsYou)} mSub={tx(T.inboxCrumb(live.length))} />
      <main>
        <Split list={list} detail={<div className="only-d" style={{ height: "100%" }}>{detailPane}</div>} detailWidth={640} />
      </main>
      <Sheet open={phoneOpen && selected !== null} onClose={() => setPhoneOpen(false)} title={selected ? tx(selected.badge) : undefined} label={tx(T.needsYou)}>
        {selected ? detailPane : <span />}
      </Sheet>
      <Sheet
        open={picking !== null}
        onClose={() => setPicking(null)}
        title={tx(T.pickAnother)}
        sub={picking ? tx(picking.title) : undefined}
        icon="users"
      >
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {(picking?.candidates ?? []).map((who) => (
            <li key={who.id}>
              <button
                type="button"
                className="row tap"
                disabled={!who.free}
                onClick={() => {
                  const item = picking!;
                  setPicking(null);
                  assign(item, who);
                }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", border: 0, borderTop: "1px solid var(--bd)", background: "transparent", color: "var(--fg)", textAlign: "left", opacity: who.free ? 1 : 0.55 }}
              >
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <strong>{who.name}</strong>
                  <span style={{ fontSize: 13, color: "var(--mut)" }}>{who.detail}</span>
                </span>
                {who.free ? <Ic n="chevRight" size={18} /> : <Pill tone="mut">{tx(T.busy)}</Pill>}
              </button>
            </li>
          ))}
        </ul>
        {picking && (picking.candidates ?? []).length === 0 ? <p style={{ color: "var(--mut)" }}>{tx(T.nobodyFree)}</p> : null}
      </Sheet>
    </>
  );
}

type DetailActions = {
  remind: (item: InboxItem) => void;
  assign: (item: InboxItem, who: CoverCandidate) => void;
  pick: (item: InboxItem) => void;
  submissions: (item: InboxItem, accept: boolean) => void;
};

function Detail({ item, on }: { item: InboxItem; on: DetailActions }) {
  const onRemind = () => on.remind(item);
  const onAssign = (who: CoverCandidate) => on.assign(item, who);
  const onPick = () => on.pick(item);
  const onSubmissions = (accept: boolean) => on.submissions(item, accept);
  const { tx } = useVx();
  const look = LOOK[item.kind];
  const best = item.candidates?.find((c) => c.free) ?? null;

  let actions: React.ReactNode = null;
  switch (item.kind) {
    case "not_marked":
      actions = (
        <>
          {(item.remindable ?? 0) > 0 ? (
            <Btn variant="pri" icon="message" onClick={onRemind}>{tx(T.remindN(item.remindable ?? 0))}</Btn>
          ) : (
            <span style={{ fontSize: 14, color: "var(--mut)" }}>{tx(T.nobodyToRemind)}</span>
          )}
          <Btn icon="calCheck" href={item.href}>{tx(T.openBoard)}</Btn>
        </>
      );
      break;
    case "cover":
      actions = (
        <>
          {best ? <Btn variant="pri" onClick={() => onAssign(best)}>{tx(T.assignName(best.name))}</Btn> : <span style={{ color: "var(--mut)" }}>{tx(T.nobodyFree)}</span>}
          <Btn onClick={onPick}>{tx(T.pickAnother)}</Btn>
          <Btn variant="ghost" icon="clock" href={item.href}>{tx(T.openCover)}</Btn>
        </>
      );
      break;
    case "submission":
    case "confirmations":
      actions = (
        <>
          <Btn variant="pri" icon="check" onClick={() => onSubmissions(true)}>{tx(T.accept)}</Btn>
          {item.kind === "submission" ? <Btn icon="x" onClick={() => onSubmissions(false)}>{tx(T.decline)}</Btn> : null}
          <Btn variant="ghost" href={item.href}>{tx(T.openReview)}</Btn>
        </>
      );
      break;
    case "refund":
      actions = <Btn variant="pri" icon="rupee" href={item.href}>{tx(T.review)}</Btn>;
      break;
    case "job":
      actions = <Btn variant="pri" icon="activity" href={item.href}>{tx(T.openJobs)}</Btn>;
      break;
  }

  return (
    <div className="fadein" style={{ padding: "26px 28px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }} className="only-d">
        <IconTile icon={look.icon} tone={look.tone} size={30} />
        <Pill tone={look.tone}>{tx(item.badge)}</Pill>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{whenLabel(item.at)}</span>
      </div>
      <h2 className="serif" style={{ margin: 0, fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>{tx(item.title)}</h2>
      {item.body ? <p style={{ margin: 0, color: "var(--mut)", fontSize: 16, lineHeight: 1.55 }}>{tx(item.body)}</p> : null}
      {item.facts.length ? (
        <Card pad={false} style={{ overflow: "hidden" }}>
          <dl style={{ margin: 0 }}>
            {item.facts.map((fact, i) => (
              <div key={`${fact.label.en}-${i}`} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 30%) minmax(0,1fr)", gap: 12, padding: "12px 18px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                <dt style={{ color: "var(--mut)", fontSize: 14 }}>{tx(fact.label)}</dt>
                <dd style={{ margin: 0, fontWeight: 600, fontSize: 14, overflowWrap: "anywhere" }}>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>{actions}</div>
      {item.footnote ? <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{tx(item.footnote)}</p> : null}
    </div>
  );
}
