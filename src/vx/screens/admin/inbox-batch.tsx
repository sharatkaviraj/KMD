"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { decideLeaveAction } from "@/app/(app)/timetable/vx-actions";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";
import { Btn } from "@/vx/ui/primitives";
import { SAVE_WORDS, SaveMark } from "@/vx/ui/save-status";
import { BATCH_GROUPS, BATCH_WORDS, batchGroupOf, batchSummary, groupSelection, type BatchChoice, type BatchGroup, type ItemOutcome } from "@/vx/screens/admin/inbox-batch-logic";
import type { InboxScope } from "@/vx/screens/admin/inbox-outbox";
import type { InboxItem } from "@/vx/screens/admin/types";

const W = {
  open: p("Decide several", "कई एक साथ तय करें"),
  title: p("Decide several at once", "कई एक साथ तय करें"),
  scope: (n: number) => p(`${n} in this list can be decided together. Money requests and cover are decided one at a time.`, `इस सूची के ${n} एक साथ तय हो सकते हैं। पैसे के अनुरोध और व्यवस्था एक-एक करके तय होते हैं।`),
  all: p("Select all", "सभी चुनें"),
  none: p("Clear", "हटाएँ"),
  picked: (n: number) => p(`${n} selected`, `${n} चुने गए`),
  review: p("Check before saving", "सहेजने से पहले देखें"),
  confirm: (label: string, n: number) => p(`${label} · ${n}`, `${label} · ${n}`),
  back: p("Back", "वापस"),
  // The one saving vocabulary (U01): the single-decision line says the same words.
  saving: SAVE_WORDS.saving,
  saved: SAVE_WORDS.saved,
  failed: SAVE_WORDS.failed,
  retry: p("Try the failed ones again", "जो नहीं हुए उन्हें फिर करें"),
  close: p("Close", "बंद करें"),
  previewing: p("Preview only: nothing is saved while you view as another role.", "केवल पूर्वावलोकन: दूसरी भूमिका में देखते समय कुछ सहेजा नहीं जाता।"),
  arrange: (day: string) => p(`Arrange cover for ${day}`, `${day} की व्यवस्था करें`),
  network: p("No answer from the server. Nothing is assumed saved.", "सर्वर से जवाब नहीं मिला। कुछ भी सहेजा हुआ नहीं माना गया।"),
};

/**
 * Needs you, several at once (review N01/N02). Picked items are grouped so a
 * decision never mixes meanings; the reader sees what the decision does
 * before saving; each item is saved and re-checked by the server on its own,
 * shows a tick and folds away only once the server confirms, and a failure
 * stays with its reason and can be retried alone — with the same command, so
 * a lost answer is never saved twice.
 */
export function InboxBatch({ items, scope, previewing, onSettled }: { items: InboxItem[]; scope: InboxScope; previewing: boolean; onSettled: (ids: string[]) => void }) {
  const { tx } = useVx();
  const router = useRouter();
  const eligible = items.filter((item) => batchGroupOf(item) !== null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [choice, setChoice] = useState<BatchChoice | null>(null);
  const [outcomes, setOutcomes] = useState<Map<string, ItemOutcome>>(new Map());
  const [running, setRunning] = useState(false);
  const [coverDays, setCoverDays] = useState<string[]>([]);
  // One command per item and answer, kept across retries: the server replays it rather than deciding twice.
  const commands = useRef(new Map<string, string>());

  if (eligible.length < 2 && !open) return null;
  const groups = groupSelection(eligible, selected);
  const toggle = (id: string) => setSelected((all) => { const next = new Set(all); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const commandFor = (id: string, yes: boolean) => {
    const key = `${id}:${yes}`;
    if (!commands.current.has(key)) commands.current.set(key, crypto.randomUUID());
    return commands.current.get(key)!;
  };
  const setOutcome = (id: string, outcome: ItemOutcome) => setOutcomes((all) => new Map(all).set(id, outcome));

  async function decide(item: InboxItem, group: BatchGroup, yes: boolean): Promise<ItemOutcome> {
    try {
      if (group === "reviews") {
        const response = await fetch("/api/inbox", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "submissions", commandId: commandFor(item.id, yes), submissionIds: item.submissionIds ?? [], accept: yes, scope }) });
        const body = (await response.json().catch(() => null)) as { ok?: boolean } | null;
        return response.ok && body?.ok ? { state: "done" } : { state: "failed", why: p(`Refused (${response.status}). It may have been decided already.`, `अस्वीकार (${response.status})। हो सकता है यह पहले ही तय हो चुका हो।`) };
      }
      const result = await decideLeaveAction({ id: item.leaveId!, approve: yes });
      if (result.ok && result.coverDay) setCoverDays((days) => (days.includes(result.coverDay!) ? days : [...days, result.coverDay!]));
      return result.ok ? { state: "done" } : { state: "failed", why: result.message };
    } catch {
      return { state: "failed", why: W.network };
    }
  }

  async function run(group: BatchGroup, yes: boolean, only?: InboxItem[]) {
    if (previewing) return;
    const list = only ?? groups[group];
    setRunning(true);
    const done: string[] = [];
    // One at a time: each item is re-checked at the server against what is there now.
    for (const item of list) {
      setOutcome(item.id, { state: "saving" });
      const outcome = await decide(item, group, yes);
      setOutcome(item.id, outcome);
      if (outcome.state === "done") done.push(item.id);
    }
    setRunning(false);
    if (done.length) {
      setSelected((all) => { const next = new Set(all); for (const id of done) next.delete(id); return next; });
      onSettled(done);
      router.refresh();
    }
  }

  const reviewing = choice ? groups[choice.group] : [];
  const tried = [...outcomes.entries()].filter(([, o]) => o.state === "done" || o.state === "failed");
  const summary = tried.length && !running ? batchSummary(new Map(tried)) : null;
  const failedItems = choice ? eligible.filter((item) => outcomes.get(item.id)?.state === "failed" && batchGroupOf(item) === choice.group) : [];

  const row = (item: InboxItem) => {
    const outcome = outcomes.get(item.id);
    return (
      <li key={item.id} className={`vx-batch-row${outcome?.state === "done" ? " done" : ""}`}>
        {choice ? (
          <span className="vx-batch-state" aria-hidden="true">
            <SaveMark kind={outcome?.state === "saving" ? "saving" : outcome?.state === "done" ? "saved" : outcome?.state === "failed" ? "failed" : "idle"} />
          </span>
        ) : (
          <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} aria-label={tx(item.title)} />
        )}
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 600 }}>{tx(item.title)}</span>
          <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(item.sub)}</span>
          {outcome?.state === "failed" ? <span role="alert" style={{ fontSize: 13, color: "var(--bad)" }}>{tx(W.failed)} · {tx(outcome.why)}</span> : null}
        </span>
        {choice && outcome ? <span className="sr" role="status">{tx(outcome.state === "saving" ? W.saving : outcome.state === "done" ? W.saved : outcome.state === "failed" ? W.failed : W.saving)}</span> : null}
      </li>
    );
  };

  const close = () => { if (running) return; setOpen(false); setChoice(null); setOutcomes(new Map()); setCoverDays([]); };

  return (
    <>
      <Btn icon="check" onClick={() => setOpen(true)} disabled={eligible.length === 0}>{tx(W.open)}</Btn>
      <Sheet open={open} onClose={close} dismissable={!running} title={tx(choice ? W.review : W.title)} sub={choice ? tx(BATCH_WORDS[choice.group][choice.yes ? "yesMeans" : "noMeans"]) : tx(W.scope(eligible.length))} wide
        footer={choice ? (
          <>
            <Btn disabled={running} onClick={() => { setChoice(null); setOutcomes(new Map()); }} style={{ flex: 1 }}>{tx(summary ? W.close : W.back)}</Btn>
            {summary && failedItems.length ? (
              <Btn variant="pri" disabled={running} onClick={() => run(choice.group, choice.yes, failedItems)} style={{ flex: 1.4 }}>{tx(W.retry)}</Btn>
            ) : !summary ? (
              <Btn variant="pri" disabled={running || previewing || reviewing.length === 0} onClick={() => run(choice.group, choice.yes)} style={{ flex: 1.4 }}>
                {running ? tx(W.saving) : tx(W.confirm(tx(BATCH_WORDS[choice.group][choice.yes ? "yes" : "no"]), reviewing.length))}
              </Btn>
            ) : null}
          </>
        ) : undefined}
      >
        {previewing ? <p role="status" style={{ margin: "0 0 10px", fontSize: 13, color: "var(--warnfg)" }}>{tx(W.previewing)}</p> : null}
        {choice ? (
          <>
            <ul className="vx-batch-list">{(summary ? eligible.filter((item) => outcomes.has(item.id)) : reviewing).map(row)}</ul>
            {summary ? <p role="status" style={{ margin: "12px 0 0", fontWeight: 600, color: summary.failed ? "var(--warnfg)" : "var(--ok)" }}>{tx(summary.line)}</p> : null}
            {summary && coverDays.length ? coverDays.map((day) => <Link key={day} href={`/timetable?view=subs&day=${day}`} className="tap vx-lnk" style={{ display: "inline-flex", minHeight: 44, alignItems: "center" }}>{tx(W.arrange(day))}</Link>) : null}
          </>
        ) : BATCH_GROUPS.map((group) => {
          const inGroup = eligible.filter((item) => batchGroupOf(item) === group);
          if (!inGroup.length) return null;
          const picked = groups[group].length;
          const words = BATCH_WORDS[group];
          return (
            <section key={group} className="vx-batch-group" aria-label={tx(words.title)}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span className="sech">{tx(words.title)} · {inGroup.length}</span>
                <button type="button" className="tap vx-lnk" style={{ fontSize: 13, fontWeight: 700, minHeight: 32 }}
                  onClick={() => setSelected((all) => { const next = new Set(all); const every = inGroup.every((item) => next.has(item.id)); for (const item of inGroup) { if (every) next.delete(item.id); else next.add(item.id); } return next; })}>
                  {tx(inGroup.every((item) => selected.has(item.id)) ? W.none : W.all)}
                </button>
              </div>
              <ul className="vx-batch-list">{inGroup.map(row)}</ul>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--mut)", marginRight: "auto" }}>{tx(W.picked(picked))}</span>
                <Btn disabled={picked === 0 || previewing} onClick={() => setChoice({ group, yes: false })}>{tx(words.no)}</Btn>
                <Btn variant="pri" disabled={picked === 0 || previewing} onClick={() => setChoice({ group, yes: true })}>{tx(words.yes)}</Btn>
              </div>
            </section>
          );
        })}
      </Sheet>
    </>
  );
}
