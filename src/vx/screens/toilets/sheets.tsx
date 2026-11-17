"use client";

import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";

import {
  beginChartAction,
  finishChartAction,
  orderToiletsAction,
  removeChartAction,
  removeToiletAction,
  saveSettingsAction,
  saveToiletAction,
  type ToiletResult,
} from "@/app/(app)/toilets/actions";
import { CameraCapture } from "@/lib/ai/ui/camera-capture";
import {
  addDays,
  LIMITS,
  SLOTS,
  USED_BY,
  weekDays,
  type Chart,
  type Problem,
  type Slot,
  type Toilet,
  type ToiletSettings,
  type UsedBy,
} from "@/modules/toilets/domain/checks";
import { createClient } from "@/platform/supabase/client";
import { cue } from "@/ui/feedback/cue";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { Pair } from "@/vx/text";
import { Field, Input, Seg, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Banner } from "@/vx/ui/page";
import { Btn, Pill, SecHead } from "@/vx/ui/primitives";
import { SAVE_IDLE, SaveStatus, useSlowSave, type SaveState } from "@/vx/ui/save-status";

import { clock, dayLabel, PROBLEM, W, weekRange } from "./words";

/*
 * The three sheets of Toilet checks (D-652): Upload photo (photo, then the
 * checks left empty, then a note), See photo, and Toilets & check times.
 */

const BUCKET = "toilet-charts";
const SAVED_PAUSE_MS = 900;
const CLOSE_MS = 220;

function useClosing(onClose: () => void) {
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    window.setTimeout(onClose, CLOSE_MS);
  };
  return { open, close };
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

const key = (day: string, slot: Slot) => `${day}|${slot}`;

/* ----------------------------------------------------------------- upload */

type Phase =
  | { kind: "idle" }
  | { kind: "sending"; i: number; n: number }
  | { kind: "checking" }
  | { kind: "saved"; message: Pair }
  | { kind: "failed"; message: Pair; retry: boolean }
  | { kind: "unsure" };

export function UploadSheet(props: {
  sessionLabel: string;
  test: boolean;
  toilet: Toilet;
  weekStart: string;
  isOpen: (day: string) => boolean;
  replacing: boolean;
  onClose: () => void;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const { open, close } = useClosing(props.onClose);
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [missed, setMissed] = useState<Set<string>>(() => new Set());
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // The phone's own id for this upload: a retry is the same chart, never a second one.
  const [chart, setChart] = useState<{ id: string; pages: number | null }>(() => ({ id: newId(), pages: null }));
  const busy = phase.kind === "sending" || phase.kind === "checking";
  const slow = useSlowSave(busy);
  const days = weekDays(props.weekStart);
  const week = weekRange(props.weekStart, addDays(props.weekStart, 5));

  const toggle = (day: string, slot: Slot) => {
    if (busy || phase.kind === "saved") return;
    cue("select");
    setMissed((m) => {
      const next = new Set(m);
      const k = key(day, slot);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const changePhotos = (next: Blob[]) => {
    setPhotos(next);
    if (phase.kind === "failed") setPhase({ kind: "idle" });
    // Different pages are a different upload: the server only lets the same id repeat the same pages.
    if (chart.pages !== null && chart.pages !== next.length) setChart({ id: newId(), pages: null });
  };

  const save = async () => {
    if (busy || phase.kind === "saved") return;
    if (!photos.length) {
      cue("warn");
      setPhase({ kind: "failed", message: W.needPhoto, retry: false });
      return;
    }
    cue("tap");
    const pages = photos.length;
    setChart((c) => ({ ...c, pages }));
    let begun: ToiletResult;
    try {
      setPhase({ kind: "sending", i: 1, n: pages });
      begun = await beginChartAction({ session: props.sessionLabel, chartId: chart.id, toiletId: props.toilet.id, weekStart: props.weekStart, pages });
    } catch {
      setPhase({ kind: "failed", message: W.answer.failed, retry: true });
      return;
    }
    if (!begun.ok) {
      setPhase({ kind: "failed", message: begun.message, retry: begun.message.en === W.answer.storage.en || begun.message.en === W.answer.failed.en });
      return;
    }
    const paths = begun.paths ?? [];
    const tokens = begun.tokens ?? [];
    if (tokens.length) {
      const bucket = createClient().storage.from(BUCKET);
      for (let i = 0; i < paths.length; i++) {
        setPhase({ kind: "sending", i: i + 1, n: paths.length });
        try {
          const { error } = await bucket.uploadToSignedUrl(paths[i], tokens[i], photos[i], { contentType: "image/jpeg", upsert: true });
          if (error) throw error;
        } catch {
          setPhase({ kind: "failed", message: W.answer.storage, retry: true });
          return;
        }
      }
    }
    setPhase({ kind: "checking" });
    let finished: ToiletResult;
    try {
      finished = await finishChartAction({
        session: props.sessionLabel,
        chartId: chart.id,
        weekStart: props.weekStart,
        missed: [...missed].map((k) => {
          const [day, slot] = k.split("|");
          return { day, slot };
        }),
        note: note.trim() || null,
      });
    } catch {
      setPhase({ kind: "unsure" });
      router.refresh();
      return;
    }
    if (!finished.ok) {
      setPhase({ kind: "failed", message: finished.message, retry: finished.message.en !== W.answer.not_found.en });
      return;
    }
    setPhase({ kind: "saved", message: finished.message });
    cue("done");
    toast.show({ text: tx(finished.message), tone: "ok", cue: false });
    router.refresh();
    window.setTimeout(close, SAVED_PAUSE_MS);
  };

  const status: SaveState =
    phase.kind === "sending" || phase.kind === "checking" ? { kind: "saving", slow }
    : phase.kind === "saved" ? { kind: "saved", detail: phase.message }
    : phase.kind === "failed" ? { kind: "failed", message: phase.message }
    : phase.kind === "unsure" ? { kind: "failed", message: W.savedLost }
    : SAVE_IDLE;
  const savingWord = phase.kind === "sending" ? W.uploading(phase.i, phase.n) : W.checking;

  return (
    <Sheet
      open={open}
      onClose={close}
      title={tx(W.uploadTitle(props.toilet.name))}
      sub={tx(week)}
      icon="camera"
      wide
      dismissable={!busy}
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", minWidth: 0 }}>
          <SaveStatus
            state={status}
            test={props.test}
            words={{ saving: savingWord, slow: savingWord, saved: W.saved }}
            onRetry={phase.kind === "failed" && phase.retry ? () => void save() : undefined}
            reserve={false}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={close} disabled={busy} style={{ flex: 1 }}>{tx(W.close)}</Btn>
            <button
              type="button"
              className="tap btn pri big"
              disabled={busy || phase.kind === "saved" || phase.kind === "unsure"}
              onClick={() => void save()}
              style={{ flex: 2, minWidth: 0 }}
            >
              {busy ? <Ic n="refresh" size={18} className="spin" /> : <Ic n="upload" size={18} />}
              <span className="clip">{tx(W.save)}</span>
              {phase.kind === "saved" ? <span aria-hidden="true" style={{ animation: "xPopIn .4s var(--spring) both" }}>✓</span> : null}
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 8 }}>
        {props.replacing ? <Banner tone="info">{tx(W.replaceNote)}</Banner> : null}

        <section style={STEP}>
          <SecHead>{tx(W.step1)}</SecHead>
          <p style={HINT}>{tx(W.step1Hint)}</p>
          <CameraCapture files={photos} onChange={changePhotos} disabled={busy || phase.kind === "saved"} />
        </section>

        <section style={STEP}>
          <SecHead>{tx(W.step2)}</SecHead>
          <p style={HINT}>{tx(W.step2Hint)}</p>
          <div role="table" aria-label={tx(W.step2)} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div role="row" style={GRID}>
              <span role="columnheader" />
              {SLOTS.map((s) => (
                <span key={s} role="columnheader" style={{ fontSize: 13, fontWeight: 700, color: "var(--mut)", textAlign: "center" }}>{tx(W.slot[s])}</span>
              ))}
            </div>
            {days.map((day) => {
              const shut = !props.isOpen(day);
              return (
                <div key={day} role="row" style={GRID}>
                  <span role="rowheader" style={{ fontSize: 15, fontWeight: 600 }}>{tx(dayLabel(day))}</span>
                  {SLOTS.map((slot) => {
                    if (shut) {
                      return (
                        <span key={slot} role="cell" style={{ ...CELL, background: "var(--s2)", color: "var(--mut)", cursor: "default" }}>
                          <Ic n="calMinus" size={16} /> {tx(W.closedDay)}
                        </span>
                      );
                    }
                    const off = missed.has(key(day, slot));
                    return (
                      <span key={slot} role="cell" style={{ display: "contents" }}>
                        <button
                          type="button"
                          className="tap"
                          aria-pressed={off}
                          aria-label={`${tx(dayLabel(day))} ${tx(W.slot[slot])}: ${tx(off ? W.missedWord : W.done)}`}
                          onClick={() => toggle(day, slot)}
                          disabled={busy || phase.kind === "saved"}
                          style={{
                            ...CELL,
                            background: off ? "var(--bads)" : "var(--oks)",
                            color: off ? "var(--bad)" : "var(--ok)",
                            borderColor: off ? "var(--bad)" : "transparent",
                          }}
                        >
                          <Ic n={off ? "x" : "check"} size={18} /> {tx(off ? W.missedWord : W.done)}
                        </button>
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {missed.size ? <Pill tone="bad" icon="alert">{tx(W.missedLine(missed.size))}</Pill> : null}
        </section>

        <section style={STEP}>
          <Field label={tx(W.step3)}>
            <Textarea
              value={note}
              maxLength={LIMITS.note}
              rows={2}
              placeholder={tx(W.notePlaceholder)}
              disabled={busy || phase.kind === "saved"}
              onChange={(e) => setNote(e.currentTarget.value)}
            />
          </Field>
        </section>
      </div>
    </Sheet>
  );
}

const STEP: CSSProperties = { display: "flex", flexDirection: "column", gap: 8 };
const HINT: CSSProperties = { margin: 0, fontSize: 14, color: "var(--mut)", lineHeight: 1.45 };
const GRID: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(88px, 1fr) minmax(0, 1.3fr) minmax(0, 1.3fr)", gap: 8, alignItems: "center" };
const CELL: CSSProperties = {
  minHeight: 48,
  borderRadius: 12,
  border: "2px solid transparent",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  fontSize: 14,
  fontWeight: 700,
  width: "100%",
};

/* ------------------------------------------------------------------ photo */

export function PhotoSheet(props: {
  sessionLabel: string;
  chart: Chart;
  toiletName: string;
  canManage: boolean;
  canUpload: boolean;
  onUploadAgain: () => void;
  onClose: () => void;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const { open, close } = useClosing(props.onClose);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Pair | null>(null);
  const c = props.chart;
  const week = weekRange(c.weekStart, addDays(c.weekStart, 5));
  const pages = Array.from({ length: c.pages }, (_, i) => i + 1);

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    let result: ToiletResult;
    try {
      result = await removeChartAction({ session: props.sessionLabel, chartId: c.id });
    } catch {
      setBusy(false);
      setError(W.answer.failed);
      return;
    }
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      router.refresh();
      return;
    }
    cue("done");
    toast.show({ text: tx(result.message), tone: "ok", cue: false });
    router.refresh();
    close();
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={tx(W.photoTitle(props.toiletName, week))}
      icon="image"
      wide
      dismissable={!busy}
      footer={
        <div style={{ display: "flex", gap: 8, width: "100%", flexWrap: "wrap" }}>
          <Btn onClick={close} disabled={busy} style={{ flex: "1 1 120px" }}>{tx(W.close)}</Btn>
          {props.canUpload ? <Btn variant="pri" icon="camera" onClick={props.onUploadAgain} disabled={busy} style={{ flex: "2 1 160px" }}>{tx(W.uploadAgain)}</Btn> : null}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 8 }}>
        <span style={{ fontSize: 14, color: "var(--mut)" }}>{tx(W.uploadedBy(c.uploadedByName, stampOf(c.storedAt)))}</span>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <strong style={{ fontSize: 15, color: c.missed.length ? "var(--bad)" : "var(--ok)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Ic n={c.missed.length ? "alert" : "checkCircle"} size={16} /> {tx(W.missedLine(c.missed.length))}
          </strong>
          {c.missed.length ? (
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, display: "flex", flexDirection: "column", gap: 2 }}>
              {c.missed.map((m) => <li key={key(m.day, m.slot)}>{tx(dayLabel(m.day))} · {tx(W.slot[m.slot])}</li>)}
            </ul>
          ) : null}
        </div>

        {c.note ? (
          <div style={{ background: "var(--s2)", borderRadius: 12, padding: "10px 12px", fontSize: 14 }}>
            <strong>{tx(W.noteFrom)}:</strong> {c.note}
          </div>
        ) : null}

        {pages.map((n) => {
          const src = `/toilets/photo/${c.id}/${n}`;
          return (
            <figure key={n} style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <a href={src} target="_blank" rel="noreferrer" aria-label={`${tx(W.openFull)}: ${tx(W.photoOf(n, c.pages))}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a private photo through our own route, never optimised */}
                <img src={src} alt={tx(W.photoOf(n, c.pages))} loading="lazy" style={{ width: "100%", height: "auto", borderRadius: 12, border: "1px solid var(--bd)", background: "var(--s2)", minHeight: 160 }} />
              </a>
              <figcaption style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.photoOf(n, c.pages))} · {tx(W.openFull)}</figcaption>
            </figure>
          );
        })}

        {error ? <Banner tone="bad">{tx(error)}</Banner> : null}

        {props.canManage ? (
          asking ? (
            <div role="group" style={{ border: "1px solid var(--bad)", borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 14 }}>{tx(W.removePhotoAsk)}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn onClick={() => setAsking(false)} disabled={busy} style={{ flex: 1 }}>{tx(W.close)}</Btn>
                <Btn variant="danger" icon={busy ? "refresh" : "trash"} onClick={() => void remove()} disabled={busy} style={{ flex: 1 }}>{tx(W.removePhoto)}</Btn>
              </div>
            </div>
          ) : (
            <Btn variant="ghost" icon="trash" onClick={() => { cue("tap"); setAsking(true); }}>{tx(W.removePhoto)}</Btn>
          )
        ) : null}
      </div>
    </Sheet>
  );
}

function stampOf(iso: string): Pair {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(d).toLowerCase();
  const label = dayLabel(day);
  return { en: `${label.en}, ${time}`, hi: `${label.hi}, ${time}` };
}

/* ----------------------------------------------------------------- manage */

type Editing = { id: string | null; name: string; place: string; usedBy: UsedBy; expected: string | null };

const said = (problem: string | undefined): Pair | null => (problem && problem in PROBLEM ? PROBLEM[problem as Problem] : null);

export function ManageSheet(props: { sessionLabel: string; test: boolean; toilets: Toilet[]; settings: ToiletSettings; onClose: () => void }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const { open, close } = useClosing(props.onClose);
  const [editing, setEditing] = useState<Editing | null>(props.toilets.length ? null : { id: null, name: "", place: "", usedBy: "all", expected: null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>(SAVE_IDLE);
  const [times, setTimes] = useState({ morningAt: props.settings.morningAt, afternoonAt: props.settings.afternoonAt });
  const [items, setItems] = useState(() => props.settings.checklist.map((i) => ({ ...i })));
  const [settingErrors, setSettingErrors] = useState<Record<string, string>>({});
  const [settingState, setSettingState] = useState<SaveState>(SAVE_IDLE);
  const slow = useSlowSave(busy !== null);

  const answered = (result: ToiletResult, onOk?: () => void) => {
    if (result.ok) {
      toast.show({ text: tx(result.message), tone: "ok" });
      router.refresh();
      onOk?.();
      return true;
    }
    return false;
  };

  const saveToilet = async () => {
    if (!editing || busy) return;
    cue("tap");
    setBusy("toilet");
    setState({ kind: "saving" });
    try {
      const result = await saveToiletAction({
        session: props.sessionLabel,
        id: editing.id,
        draft: { name: editing.name, place: editing.place, usedBy: editing.usedBy },
        expected: editing.expected,
      });
      if (answered(result, () => { setEditing(null); setErrors({}); setState({ kind: "saved" }); })) return;
      if (!result.ok) {
        setErrors(result.fields ?? {});
        setState({ kind: "failed", message: result.message });
      }
    } catch {
      setState({ kind: "failed", message: W.answer.failed });
    } finally {
      setBusy(null);
    }
  };

  const removeToilet = async (id: string) => {
    if (busy) return;
    setBusy(`remove:${id}`);
    try {
      const result = await removeToiletAction({ session: props.sessionLabel, id });
      if (!answered(result, () => setAsking(null)) && !result.ok) setState({ kind: "failed", message: result.message });
    } catch {
      setState({ kind: "failed", message: W.answer.failed });
    } finally {
      setBusy(null);
    }
  };

  const moveUp = async (index: number) => {
    if (busy || index === 0) return;
    cue("select");
    const ids = props.toilets.map((t) => t.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    setBusy(`move:${ids[index - 1]}`);
    try {
      const result = await orderToiletsAction({ session: props.sessionLabel, ids });
      if (result.ok) router.refresh();
      else setState({ kind: "failed", message: result.message });
    } catch {
      setState({ kind: "failed", message: W.answer.failed });
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = async () => {
    if (busy) return;
    cue("tap");
    setBusy("settings");
    setSettingState({ kind: "saving" });
    try {
      const result = await saveSettingsAction({ session: props.sessionLabel, draft: { ...times, checklist: items } });
      if (answered(result, () => { setSettingErrors({}); setSettingState({ kind: "saved" }); })) return;
      if (!result.ok) {
        setSettingErrors(result.fields ?? {});
        setSettingState({ kind: "failed", message: result.message });
      }
    } catch {
      setSettingState({ kind: "failed", message: W.answer.failed });
    } finally {
      setBusy(null);
    }
  };

  const err = (f: string) => said(errors[f]);
  const serr = (f: string) => said(settingErrors[f]);

  return (
    <Sheet open={open} onClose={close} title={tx(W.manage)} sub={tx(W.manageHint)} icon="settings" wide dismissable={busy === null}
      footer={<Btn onClick={close} disabled={busy !== null} style={{ flex: 1 }}>{tx(W.close)}</Btn>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 22, paddingBottom: 8 }}>
        {props.test ? <Banner tone="warn">{tx(W.testYear)}</Banner> : null}

        <section style={STEP}>
          <SecHead action={!editing ? <Btn variant="pri" icon="plus" onClick={() => { cue("tap"); setErrors({}); setEditing({ id: null, name: "", place: "", usedBy: "all", expected: null }); }}>{tx(W.addToilet)}</Btn> : undefined}>
            {tx(W.toiletsList)} <Pill tone="mut">{props.toilets.length}</Pill>
          </SecHead>

          {editing ? (
            <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14, borderColor: "var(--pri)" }}>
              <Field label={tx(W.name)} error={err("name") ? tx(err("name")!) : errors.name === "duplicate" ? tx(W.answer.duplicate) : undefined}>
                <Input value={editing.name} maxLength={LIMITS.name} placeholder={tx(W.namePlaceholder)} invalid={Boolean(errors.name)} autoFocus
                  onChange={(e) => { const name = e.currentTarget.value; setEditing((x) => (x ? { ...x, name } : x)); setErrors((all) => ({ ...all, name: "" })); }} />
              </Field>
              <Field label={tx(W.place)} error={err("place") ? tx(err("place")!) : undefined}>
                <Input value={editing.place} maxLength={LIMITS.place} placeholder={tx(W.placePlaceholder)} invalid={Boolean(errors.place)}
                  onChange={(e) => { const place = e.currentTarget.value; setEditing((x) => (x ? { ...x, place } : x)); }} />
              </Field>
              <div className="field" role="group" aria-label={tx(W.usedByLabel)}>
                <span>{tx(W.usedByLabel)}</span>
                <Seg<UsedBy> label={tx(W.usedByLabel)} value={editing.usedBy} onChange={(usedBy) => setEditing((x) => (x ? { ...x, usedBy } : x))}
                  options={USED_BY.map((u) => ({ value: u, label: tx(W.usedBy[u]) }))} style={{ height: 48 }} />
              </div>
              <SaveStatus state={busy === "toilet" ? { kind: "saving", slow } : state} test={props.test} reserve={false} />
              <div style={{ display: "flex", gap: 8 }}>
                {props.toilets.length ? <Btn onClick={() => { setEditing(null); setErrors({}); setState(SAVE_IDLE); }} disabled={busy !== null} style={{ flex: 1 }}>{tx(W.close)}</Btn> : null}
                <Btn variant="pri" big icon={busy === "toilet" ? "refresh" : "check"} onClick={() => void saveToilet()} disabled={busy !== null} style={{ flex: 2 }}>{tx(W.saveToilet)}</Btn>
              </div>
            </div>
          ) : state.kind === "failed" ? (
            <SaveStatus state={state} reserve={false} />
          ) : null}

          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {props.toilets.map((t, i) => (
              <li key={t.id} className="card" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Ic n="toilet" size={20} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: "block", overflowWrap: "anywhere" }}>{t.name}</strong>
                    <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.usedBy[t.usedBy])}{t.place ? ` · ${t.place}` : ""}</span>
                  </span>
                </div>
                {asking === t.id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ fontSize: 14 }}>{tx(W.removeAsk(t.name))}</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Btn onClick={() => setAsking(null)} disabled={busy !== null} style={{ flex: 1 }}>{tx(W.close)}</Btn>
                      <Btn variant="danger" icon={busy === `remove:${t.id}` ? "refresh" : "trash"} onClick={() => void removeToilet(t.id)} disabled={busy !== null} style={{ flex: 1 }}>{tx(W.remove)}</Btn>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Btn icon="edit" disabled={busy !== null} onClick={() => { cue("tap"); setErrors({}); setState(SAVE_IDLE); setEditing({ id: t.id, name: t.name, place: t.place ?? "", usedBy: t.usedBy, expected: t.updatedAt }); }} style={{ flex: "1 1 90px" }}>{tx(W.change)}</Btn>
                    {i > 0 ? <Btn icon={busy === `move:${t.id}` ? "refresh" : "arrowUp"} disabled={busy !== null} onClick={() => void moveUp(i)} style={{ flex: "1 1 90px" }}>{tx(W.moveUp)}</Btn> : null}
                    <Btn variant="ghost" icon="trash" disabled={busy !== null} onClick={() => { cue("tap"); setAsking(t.id); }} style={{ flex: "1 1 90px" }}>{tx(W.remove)}</Btn>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section style={STEP}>
          <SecHead>{tx(W.times)}</SecHead>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <Field label={tx(W.morningAt)} hint={times.morningAt ? tx(clock(times.morningAt)) : undefined} error={serr("morningAt") ? tx(serr("morningAt")!) : undefined}>
              <Input type="time" value={times.morningAt} invalid={Boolean(settingErrors.morningAt)} onChange={(e) => { const v = e.currentTarget.value; setTimes((x) => ({ ...x, morningAt: v })); }} />
            </Field>
            <Field label={tx(W.afternoonAt)} hint={times.afternoonAt ? tx(clock(times.afternoonAt)) : undefined} error={serr("afternoonAt") ? tx(serr("afternoonAt")!) : undefined}>
              <Input type="time" value={times.afternoonAt} invalid={Boolean(settingErrors.afternoonAt)} onChange={(e) => { const v = e.currentTarget.value; setTimes((x) => ({ ...x, afternoonAt: v })); }} />
            </Field>
          </div>

          <SecHead>{tx(W.checklist)}</SecHead>
          <p style={HINT}>{tx(W.checklistHint)}</p>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((item, i) => (
              <li key={i} style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr) minmax(0,1fr) 44px", gap: 6, alignItems: "center" }}>
                <span className="num" style={{ color: "var(--mut)", fontWeight: 700, textAlign: "center" }}>{i + 1}</span>
                <Input aria-label={`${tx(W.itemEn)} ${i + 1}`} placeholder={tx(W.itemEn)} value={item.en} maxLength={LIMITS.item}
                  onChange={(e) => { const en = e.currentTarget.value; setItems((all) => all.map((x, j) => (j === i ? { ...x, en } : x))); }} />
                <Input aria-label={`${tx(W.itemHi)} ${i + 1}`} placeholder={tx(W.itemHi)} value={item.hi} maxLength={LIMITS.item}
                  onChange={(e) => { const hi = e.currentTarget.value; setItems((all) => all.map((x, j) => (j === i ? { ...x, hi } : x))); }} />
                <button type="button" className="tap icon-btn" aria-label={`${tx(W.removeItem)} ${i + 1}`} disabled={items.length <= 1}
                  onClick={() => { cue("tap"); setItems((all) => all.filter((_, j) => j !== i)); }} style={{ width: 44, height: 44 }}>
                  <Ic n="x" size={18} />
                </button>
              </li>
            ))}
          </ol>
          {serr("checklist") ? <span role="alert" style={{ fontSize: 13, color: "var(--bad)", fontWeight: 600 }}>{tx(serr("checklist")!)}</span> : null}
          {items.length < LIMITS.items ? (
            <Btn icon="plus" variant="ghost" onClick={() => { cue("tap"); setItems((all) => [...all, { en: "", hi: "" }]); }}>{tx(W.addItem)}</Btn>
          ) : null}
          <SaveStatus state={busy === "settings" ? { kind: "saving", slow } : settingState} test={props.test} reserve={false} />
          <Btn variant="pri" big icon={busy === "settings" ? "refresh" : "check"} onClick={() => void saveSettings()} disabled={busy !== null}>{tx(W.saveSettings)}</Btn>
        </section>
      </div>
    </Sheet>
  );
}
