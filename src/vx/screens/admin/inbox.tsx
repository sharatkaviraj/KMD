"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { assignCoverVx, decideSubmissionsVx } from "@/app/(app)/inbox/actions";
import { remindTeachersVx } from "@/app/(app)/attendance/actions";
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
type Beacon =
  | { kind: "submissions"; submissionIds: string[]; accept: boolean }
  | { kind: "remind"; classIds: string[] }
  | { kind: "cover"; commandId: string; needKey: string; coveringStaffId: string; day: string; dayRevision: number };

type Held = { timer: number; send: () => Promise<{ ok: boolean; message?: Pair }>; label: string; beacon: Beacon; sending: boolean; flushing: boolean };

export function InboxScreen({ items, initial, previewing, unavailable }: { items: InboxItem[]; initial: string | null; previewing: boolean; unavailable: boolean }) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | InboxType>("all");
  const [selectedId, setSelectedId] = useState<string | null>(initial ?? items[0]?.id ?? null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState<InboxItem | null>(null);
  const held = useRef(new Map<string, Held>());

  const live = items.filter((item) => !hidden.has(item.id));
  const counts = inboxCounts(live);
  const shown = filter === "all" ? live : live.filter((item) => item.type === filter);
  const selected = live.find((item) => item.id === selectedId) ?? shown[0] ?? null;

  // Send anything still held when the page goes away; the person decided it.
  useEffect(() => {
    const pending = held.current;
    // A server action started here is cancelled with the page, so the held
    // decision goes as a keepalive request that outlives it.
    const flush = () => {
      for (const [id, entry] of pending) {
        if (entry.flushing) continue;
        window.clearTimeout(entry.timer);
        entry.sending = true;
        entry.flushing = true;
        void fetch("/api/inbox", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify(entry.beacon) })
          .then(async (response) => {
            if (response.ok && (await response.json()).ok === true && pending.get(id) === entry) pending.delete(id);
          })
          .catch(() => undefined)
          .finally(() => { entry.flushing = false; });
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  function hold(item: InboxItem, label: string, send: Held["send"], beacon: Beacon) {
    if (previewing) {
      toast.show({ text: tx(T.previewing), tone: "info" });
      return;
    }
    if (held.current.has(item.id)) return;
    setHidden((all) => new Set(all).add(item.id));
    setPhoneOpen(false);
    const next = live.find((other) => other.id !== item.id && (filter === "all" || other.type === filter));
    setSelectedId(next?.id ?? null);

    const timer = window.setTimeout(async () => {
      const entry = held.current.get(item.id);
      if (!entry) return;
      entry.sending = true;
      const result = await send().catch(() => ({ ok: false as const, message: T.failed }));
      // Keep the decision available to pagehide until it is acknowledged.
      // The normal action can still be cancelled while its response is pending.
      if (held.current.get(item.id) === entry) held.current.delete(item.id);
      if (!result.ok) {
        setHidden((all) => {
          const copy = new Set(all);
          copy.delete(item.id);
          return copy;
        });
        toast.show({ text: tx(result.message ?? T.failed), tone: "bad" });
      }
      router.refresh();
    }, HOLD_MS);
    held.current.set(item.id, { timer, send, label, beacon, sending: false, flushing: false });

    toast.show({
      text: label,
      undoLabel: tx(T.undo),
      ms: HOLD_MS,
      undo: () => {
        const entry = held.current.get(item.id);
        if (!entry || entry.sending) return;
        window.clearTimeout(entry.timer);
        held.current.delete(item.id);
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
    hold(item, `${tx(T.assigned(who.name))}`, () => assignCoverVx(input), { kind: "cover", ...input });
  };

  const on: DetailActions = {
    remind: (item) =>
      hold(item, tx(T.reminded(item.remindable ?? 0)), () => remindTeachersVx(item.classIds ?? []).then((r) => ({ ok: r.ok, message: r.message })), { kind: "remind", classIds: item.classIds ?? [] }),
    assign,
    pick: (item) => setPicking(item),
    submissions: (item, accept) =>
      hold(item, `${tx(accept ? T.accepted : T.declined)} · ${tx(item.title)}`, () => decideSubmissionsVx(item.submissionIds ?? [], accept), { kind: "submissions", submissionIds: item.submissionIds ?? [], accept }),
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
