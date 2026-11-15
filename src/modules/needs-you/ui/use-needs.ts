"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { addOwnNeedAction, arrangeNeedsAction, bringBackNeedAction, cancelReminderAction, ownDoneAction, snoozeNeedAction } from "@/app/(app)/needs/actions";
import { useVx } from "@/vx/i18n";
import { answerCoverVx } from "@/vx/screens/teach/actions";
import type { Pair } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";

import type { NeedsView } from "../data/board";
import { whenP } from "../domain/format";
import { arrange, broughtBack, mergeDone, needSignature, ownItem, planFits, wakeDue, type NeedBoard } from "../domain/lanes";
import { planFacts } from "../domain/plan";
import type { DoneItem, NeedItem, NeedPlan } from "../domain/types";
import { NW } from "../domain/words";

export type NeedsState = {
  board: NeedBoard;
  done: DoneItem[];
  readOnly: boolean;
  /** The AI is arranging the list now. */
  arranging: boolean;
  /** The school's clock, as the page was drawn (a QA seat's set time), moving on in real time. */
  now: () => Date;
  /** Ticks a to-do of their own, or says yes to a cover, right where it is shown. */
  quickDone: (item: NeedItem) => Promise<void>;
  snooze: (item: NeedItem, at: string, heard: string | null) => Promise<boolean>;
  /** A job put off by mistake, or an own to-do for later, back on today's list (D-636). */
  bringBack: (item: NeedItem) => Promise<void>;
  add: (title: string, at: string | null, heard: string | null) => Promise<boolean>;
  remove: (item: NeedItem) => Promise<void>;
};

/**
 * Needs you's state in the browser (D-630..D-633): the list arranged by the
 * same pure rules as the server, a tick or a reminder moving a job at once
 * (and back with Undo), reminders coming back while the list is open, and
 * the AI asked once for an order when the page says it may be.
 */
export function useNeeds(view: NeedsView, options: { onArranged?: (plan: NeedPlan) => void } = {}): NeedsState {
  const { tx } = useVx();
  const toast = useToast();
  const [items, setItems] = useState<NeedItem[]>(view.items);
  const [plan, setPlan] = useState<NeedPlan | null>(view.plan);
  const [done, setDone] = useState<DoneItem[]>(view.done);
  const [arranging, setArranging] = useState(false);
  // A fresh read of the page (another decision on it re-reads it) brings the server's list.
  const [shown, setShown] = useState(view);
  if (shown !== view) {
    setShown(view);
    setItems(view.items);
    setDone((all) => mergeDone(view.done, all));
    setPlan((old) => view.plan ?? (old && planFits(old, view.items) ? old : null));
  }
  // The page's clock against this device's: a QA seat may be set to another time of day.
  const [skew] = useState(() => Date.parse(view.nowIso) - Date.now());
  const now = useCallback(() => new Date(Date.now() + skew), [skew]);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });

  const board = useMemo(() => arrange(items, plan), [items, plan]);
  const readOnly = view.readOnly;
  const say = useCallback((pair: Pair) => tx(pair), [tx]);

  /* ---------------------------------------------- reminders coming back */
  useEffect(() => {
    if (readOnly) return;
    const check = () => {
      const { items: next, woke } = wakeDue(itemsRef.current, now());
      if (!woke.length) return;
      setItems(next);
      const first = woke[0];
      toast.show({ text: `${say(NW.backNow)}: ${say(first.title)}`, tone: "info", cue: "ready", ms: 8000 });
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [now, readOnly, say, toast]);

  /* ---------------------------------------------- the AI's order, asked once per read of the page */
  const asked = useRef<NeedsView | null>(null);
  const onArranged = options.onArranged;
  useEffect(() => {
    if (asked.current === view || readOnly || !view.mayAsk) return;
    asked.current = view;
    const list = itemsRef.current;
    const facts = planFacts(arrange(list, null), view.role, now());
    if (!facts) return;
    setArranging(true);
    let live = true;
    void arrangeNeedsAction({ signature: needSignature(list), facts })
      .then((result) => {
        if (!live || !result.ok) return;
        setPlan(result.plan);
        onArranged?.(result.plan);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setArranging(false);
      });
    return () => {
      live = false;
    };
  }, [now, onArranged, readOnly, view]);

  /* ---------------------------------------------- what a person does */
  const finish = useCallback(
    (item: NeedItem, title: Pair) => {
      setItems((all) => all.filter((i) => i.key !== item.key));
      setDone((all) => [{ key: item.key, kind: item.kind, title, at: new Date().toISOString() }, ...all.filter((d) => d.key !== item.key)]);
    },
    [],
  );
  const restore = useCallback((item: NeedItem) => {
    setItems((all) => (all.some((i) => i.key === item.key) ? all : [...all, item]));
    setDone((all) => all.filter((d) => d.key !== item.key));
  }, []);

  const quickDone = useCallback(
    async (item: NeedItem) => {
      if (readOnly) return;
      if (item.quick === "own-done" && item.ownId) {
        const id = item.ownId;
        finish(item, item.title);
        const result = await ownDoneAction({ id, done: true }).catch(() => null);
        if (!result?.ok) {
          restore(item);
          toast.show({ text: say(result && !result.ok ? result.error : NW.failed), tone: "bad" });
          return;
        }
        toast.show({
          text: `${say(NW.done)} · ${say(item.title)}`,
          tone: "ok",
          cue: "done",
          undoLabel: say(NW.undo),
          undo: async () => {
            restore(item);
            const back = await ownDoneAction({ id, done: false }).catch(() => null);
            if (!back?.ok) finish(item, item.title);
          },
        });
        return;
      }
      if (item.quick === "cover-yes" && item.key.startsWith("cover:")) {
        const dutyId = item.key.slice("cover:".length);
        const said = { en: `${item.title.en} · you said yes`, hi: `${item.title.hi ?? item.title.en} · आपने हाँ कहा` };
        finish(item, said);
        const result = await answerCoverVx(dutyId, "acknowledge", "").catch(() => null);
        if (!result?.ok) {
          restore(item);
          toast.show({ text: say(result && !result.ok ? result.error : NW.failed), tone: "bad" });
          return;
        }
        toast.show({ text: say(said), tone: "ok", cue: "done" });
      }
    },
    [finish, readOnly, restore, say, toast],
  );

  const snooze = useCallback(
    async (item: NeedItem, at: string, heard: string | null) => {
      if (readOnly) return false;
      const before = item;
      // The lane it leaves is kept, so "Bring back" can return it there (D-636).
      setItems((all) => all.map((i) => (i.key === item.key ? { ...i, lane: item.kind === "own" && sameDayAsNow(at, now()) ? "today" : "later", remindAt: at, reminded: false, dueAt: item.kind === "own" ? at : i.dueAt, baseLane: i.baseLane ?? i.lane } : i)));
      const result = await snoozeNeedAction({ itemKey: item.key, remindAt: at, heard }).catch(() => null);
      if (!result?.ok) {
        setItems((all) => all.map((i) => (i.key === before.key ? before : i)));
        toast.show({ text: say(result && !result.ok ? result.error : NW.failed), tone: "bad" });
        return false;
      }
      const reminder = result.value;
      toast.show({
        text: `${say(NW.remindSet)} · ${say(whenP(at, now()))}`,
        tone: "ok",
        cue: "success",
        undoLabel: say(NW.undo),
        undo:
          item.kind === "own"
            ? undefined
            : async () => {
                setItems((all) => all.map((i) => (i.key === before.key ? before : i)));
                await cancelReminderAction({ id: reminder.id }).catch(() => null);
              },
      });
      return true;
    },
    [now, readOnly, say, toast],
  );

  const bringBack = useCallback(
    async (item: NeedItem) => {
      if (readOnly) return;
      const before = item;
      setItems((all) => all.map((i) => (i.key === item.key ? broughtBack(i) : i)));
      const result = await bringBackNeedAction({ itemKey: item.key }).catch(() => null);
      if (!result?.ok) {
        setItems((all) => all.map((i) => (i.key === before.key ? before : i)));
        toast.show({ text: say(result && !result.ok ? result.error : NW.failed), tone: "bad" });
        return;
      }
      toast.show({ text: `${say(NW.backNow)} · ${say(item.title)}`, tone: "ok", cue: "undo" });
    },
    [readOnly, say, toast],
  );

  const add = useCallback(
    async (title: string, at: string | null, heard: string | null) => {
      if (readOnly) return false;
      const result = await addOwnNeedAction({ title, remindAt: at, heard }).catch(() => null);
      if (!result?.ok) {
        toast.show({ text: say(result && !result.ok ? result.error : NW.failed), tone: "bad" });
        return false;
      }
      const item = ownItem(result.value, now());
      setItems((all) => [...all, item]);
      toast.show({ text: at ? `${say(NW.saved)} · ${say(NW.heard)}: ${say(whenP(at, now()))}` : say(NW.saved), tone: "ok", cue: "success" });
      return true;
    },
    [now, readOnly, say, toast],
  );

  const remove = useCallback(
    async (item: NeedItem) => {
      if (readOnly || item.kind !== "own" || !item.ownId) return;
      const id = item.ownId;
      setItems((all) => all.filter((i) => i.key !== item.key));
      const result = await cancelReminderAction({ id }).catch(() => null);
      if (!result?.ok) {
        restore(item);
        toast.show({ text: say(NW.failed), tone: "bad" });
        return;
      }
      toast.show({ text: `${say(NW.removed)} · ${say(item.title)}`, tone: "info", cue: "undo" });
    },
    [readOnly, restore, say, toast],
  );

  return { board, done, readOnly, arranging, now, quickDone, snooze, bringBack, add, remove };
}

/** The same school day as now, in IST. */
function sameDayAsNow(iso: string, now: Date): boolean {
  const day = (t: number) => new Date(t + 330 * 60_000).toISOString().slice(0, 10);
  return day(Date.parse(iso)) === day(now.getTime());
}
