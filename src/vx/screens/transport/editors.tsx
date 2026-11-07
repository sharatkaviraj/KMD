"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import {
  deleteDriverAction,
  deleteTripAction,
  saveDriverAction,
  saveTripAction,
  type TransportResult,
} from "@/app/(app)/transport/actions";
import {
  checkDriver,
  checkTrip,
  DRIVER_LIMITS,
  fold,
  moveStop,
  SHIFTS,
  TRIP_LIMITS,
  type Board,
  type DriverDraft,
  type Problem,
  type RouteInfo,
  type Shift,
  type TripDraft,
} from "@/modules/transport/domain/board";
import { cue } from "@/ui/feedback/cue";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { Pair } from "@/vx/text";
import { Field, Input, SearchBox, Seg, Select } from "@/vx/ui/controls";
import { Sheet } from "@/vx/ui/overlays";
import { Btn, Pill } from "@/vx/ui/primitives";
import { SAVE_IDLE, SaveStatus, useSlowSave, type SaveState } from "@/vx/ui/save-status";
import { VoiceNote } from "@/vx/ui/voice";

import { phoneText, SHIFT_ICON, timeText } from "./sheets";
import { PROBLEM, W } from "./words";

/*
 * The two forms behind Transport's buttons (D-550): a bus run, and a driver.
 * Both check the boxes here first, so a missed box turns red at once, and the
 * server checks them again. Saving shows its own line (saving, still saving,
 * saved or what went wrong); a removal asks first, in the same sheet.
 *
 * A save whose answer never came back may have saved. Then the form does not
 * offer to send it again, because a second copy of a new bus or driver is the
 * one mistake a person cannot see from here: it says to look at the list.
 */

/** The driver choice that means "the one typed in below". The action knows it too. */
const NEW_DRIVER = "new";

/** Field name → the problem code from `checkTrip`, `checkDriver` or the server. */
type Errors = Record<string, string>;

const said = (code: string | undefined): Pair | undefined => (code ? PROBLEM[code as Problem] ?? W.fixAbove : undefined);

/** The errors without these fields: a box stops being red as soon as it is changed. */
function without(errors: Errors, ...fields: string[]): Errors {
  return Object.fromEntries(Object.entries(errors).filter(([field]) => !fields.includes(field)));
}

/** How long the "Saved" tick stays before the form slides away. */
const SAVED_PAUSE_MS = 700;
/** The sheet's closing animation. */
const CLOSE_MS = 220;

/** The answers after which pressing Save again cannot help. */
const FINAL = [W.answer.changed, W.answer.not_found, W.answer.session, W.answer.denied, W.answer.preview, W.answer.not_set_up].map((m) => m.en);

function useClosing(onClose: () => void) {
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    window.setTimeout(onClose, CLOSE_MS);
  };
  return { open, close };
}

/* -------------------------------------------------------------------- bus */

export function TripEditor(props: {
  sessionLabel: string;
  test: boolean;
  initial: TripDraft;
  expected: string | null;
  board: Board;
  routes: RouteInfo[];
  onClose: () => void;
  onSaved: (message: Pair) => void;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const { open, close } = useClosing(props.onClose);
  const [draft, setDraft] = useState<TripDraft>(props.initial);
  const [newDriver, setNewDriver] = useState({ name: "", phone: "" });
  /** A driver the server made for this form although the bus itself did not save. */
  const [madeDriver, setMadeDriver] = useState<{ id: string; name: string; phone: string | null } | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [save, setSave] = useState<SaveState>(SAVE_IDLE);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [unsure, setUnsure] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [picking, setPicking] = useState(props.initial.stops.length === 0);
  const [find, setFind] = useState("");
  const [asking, setAsking] = useState(false);
  const slow = useSlowSave(busy);
  const editing = props.initial.id !== null;

  const ridersOn = useMemo(() => new Map(props.board.cards.map((c) => [c.id, c.riders.length])), [props.board.cards]);
  const drivers = useMemo(() => {
    const list = props.board.drivers.map((d) => ({ id: d.id, name: d.name, phone: d.phone, trips: d.trips }));
    if (madeDriver && !list.some((d) => d.id === madeDriver.id)) list.push({ ...madeDriver, trips: [] });
    return list;
  }, [props.board.drivers, madeDriver]);

  // The routes a bus may go to: Fees' list (never its "No Transport" row), or,
  // while Fees' names cannot be read, the routes children ride today.
  const options = useMemo(() => {
    const named = props.routes.filter((r) => !r.placeholder && (r.isActive || ridersOn.has(r.id)));
    if (named.length) {
      return named
        .map((r) => ({ id: r.id, name: r.name, code: r.code, known: true, riders: ridersOn.get(r.id) ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }));
    }
    return props.board.cards.map((c) => ({ id: c.id, name: c.known ? c.name : c.classes.map((k) => k.label).join(", "), code: c.code, known: c.known, riders: c.riders.length }));
  }, [props.routes, props.board.cards, ridersOn]);
  const nameOf = (routeId: string) => {
    const route = options.find((o) => o.id === routeId) ?? props.board.cards.find((c) => c.id === routeId);
    return route && route.known ? route.name : tx(W.unnamed);
  };

  const knownRoutes = useMemo(() => {
    if (!props.routes.length) return null;
    const set = new Set(props.routes.filter((r) => !r.placeholder).map((r) => r.id));
    props.initial.stops.forEach((s) => set.add(s.routeId));
    return set;
  }, [props.routes, props.initial.stops]);
  const knownDrivers = useMemo(() => new Set(drivers.map((d) => d.id)), [drivers]);

  const onBus = new Set(draft.stops.map((s) => s.routeId));
  const carries = draft.stops.reduce((sum, s) => sum + (ridersOn.get(s.routeId) ?? 0), 0);
  const q = fold(find);
  const offered = options.filter((o) => !onBus.has(o.id) && (!q || fold(o.name).includes(q) || fold(o.code).includes(q)));
  const chosen = drivers.find((d) => d.id === draft.driverId) ?? null;
  const alsoDrives = chosen ? chosen.trips.filter((t) => t.id !== draft.id) : [];

  const change = (patch: Partial<TripDraft>, fields: string[] = Object.keys(patch)) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (fields.some((f) => errors[f])) setErrors((all) => without(all, ...fields));
    if (save.kind === "failed" && !unsure) setSave(SAVE_IDLE);
  };
  const setStops = (stops: TripDraft["stops"]) => change({ stops }, ["stops"]);

  const addStop = (routeId: string) => {
    if (draft.stops.length >= TRIP_LIMITS.stops) return;
    cue("select");
    setStops([...draft.stops, { routeId, stopTime: "" }]);
  };

  const validate = (): Errors => {
    const wantsNew = draft.driverId === NEW_DRIVER;
    const checked = checkTrip({ ...draft, driverId: wantsNew ? "" : draft.driverId }, { routes: knownRoutes, drivers: knownDrivers });
    const found: Errors = {};
    if (!checked.ok) for (const [k, v] of Object.entries(checked.errors)) if (v) found[k] = v;
    if (wantsNew) {
      const d = checkDriver({ id: null, name: newDriver.name, phone: newDriver.phone, notes: "" });
      if (!d.ok) for (const [k, v] of Object.entries(d.errors)) if (v) found[`newDriver.${k}`] = v;
    }
    return found;
  };

  const submit = async () => {
    if (busy || done) return;
    const found = validate();
    if (Object.keys(found).length) {
      setErrors(found);
      setCanRetry(false);
      setSave({ kind: "failed", message: found.form ? W.answer.bad_request : W.fixAbove });
      return;
    }
    cue("tap");
    setErrors({});
    setBusy(true);
    setSave({ kind: "saving" });
    let result: TransportResult;
    try {
      result = await saveTripAction({
        session: props.sessionLabel,
        draft,
        expected: props.expected,
        newDriver: draft.driverId === NEW_DRIVER ? { id: null, name: newDriver.name, phone: newDriver.phone, notes: "" } : null,
      });
    } catch {
      setBusy(false);
      setUnsure(true);
      setCanRetry(false);
      setSave({ kind: "failed", message: W.unsure, next: W.unsureNext });
      router.refresh();
      return;
    }
    setBusy(false);
    if (result.ok) {
      setDone(true);
      setSave({ kind: "saved" });
      props.onSaved(result.message);
      window.setTimeout(close, SAVED_PAUSE_MS);
      return;
    }
    if (result.driverId) {
      // The new driver was added; only the bus was not. Pick them, so the
      // next Save does not add them a second time.
      setMadeDriver({ id: result.driverId, name: newDriver.name.trim(), phone: newDriver.phone.replace(/\D/g, "").slice(-10) || null });
      setDraft((d) => ({ ...d, driverId: result.driverId ?? "" }));
      router.refresh();
    }
    setErrors(result.fields ?? {});
    setCanRetry(!result.fields && !FINAL.includes(result.message.en));
    setSave({ kind: "failed", message: result.message });
  };

  const remove = async () => {
    if (!draft.id || busy) return;
    setBusy(true);
    setSave({ kind: "saving" });
    let result: TransportResult;
    try {
      result = await deleteTripAction({ session: props.sessionLabel, id: draft.id });
    } catch {
      setBusy(false);
      setAsking(false);
      setSave({ kind: "failed", message: W.unsure, next: W.unsureNext });
      router.refresh();
      return;
    }
    setBusy(false);
    setAsking(false);
    if (result.ok) {
      setDone(true);
      setSave({ kind: "removed" });
      props.onSaved(result.message);
      window.setTimeout(close, SAVED_PAUSE_MS);
      return;
    }
    setSave({ kind: "failed", message: result.message });
  };

  const locked = busy || done || (unsure && (!editing || draft.driverId === NEW_DRIVER));
  const err = (field: string) => said(errors[field]);

  return (
    <Sheet
      open={open}
      onClose={close}
      title={tx(editing ? W.changeBus : W.addBus)}
      sub={tx(W.editorSub)}
      icon="bus"
      wide
      dismissable={!busy}
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", minWidth: 0 }}>
          <SaveStatus state={busy ? { kind: "saving", slow } : save} test={props.test} onRetry={canRetry ? submit : undefined} reserve={false} />
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={close} disabled={busy} style={{ flex: 1 }}>{tx(W.cancel)}</Btn>
            <SaveButton busy={busy} done={done} disabled={locked} onClick={submit} label={tx(W.saveBus)} />
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 8 }}>
        {/* A group, not a <label>: a label would press its first button when its words are tapped. */}
        <div className="field" role="group" aria-label={tx(W.when)}>
          <span>{tx(W.when)}</span>
          <Seg<Shift>
            label={tx(W.when)}
            value={draft.shift}
            onChange={(shift) => change({ shift })}
            options={SHIFTS.map((s) => ({
              value: s,
              label: (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Ic n={SHIFT_ICON[s]} size={16} />
                  {tx(W.shift[s])}
                </span>
              ),
            }))}
            style={{ height: 48 }}
          />
          {err("shift") ? <span role="alert" style={{ fontSize: 12, color: "var(--bad)", fontWeight: 600 }}>{tx(err("shift")!)}</span> : null}
        </div>

        <div style={TWO}>
          <Field label={tx(W.leavesAt)} hint={tx(W.leavesHint)} error={err("startsAt") ? tx(err("startsAt")!) : undefined}>
            <Input
              type="time"
              value={draft.startsAt}
              invalid={Boolean(errors.startsAt)}
              onChange={(e) => change({ startsAt: e.target.value })}
              style={{ fontSize: 18, fontWeight: 600 }}
            />
          </Field>
          <Field label={tx(W.busName)} hint={tx(W.busNameHint)} error={err("busName") ? tx(err("busName")!) : undefined}>
            <Input
              value={draft.busName}
              maxLength={TRIP_LIMITS.busName}
              invalid={Boolean(errors.busName)}
              onChange={(e) => change({ busName: e.target.value })}
              placeholder={tx(W.busNameExample)}
              autoComplete="off"
            />
          </Field>
        </div>

        <Field label={tx(W.vehicleNo)} error={err("vehicleNo") ? tx(err("vehicleNo")!) : undefined}>
          <Input
            value={draft.vehicleNo}
            maxLength={TRIP_LIMITS.vehicleNo}
            invalid={Boolean(errors.vehicleNo)}
            onChange={(e) => change({ vehicleNo: e.target.value.toUpperCase() })}
            placeholder="RJ 00 PA 0000"
            autoComplete="off"
            autoCapitalize="characters"
          />
        </Field>

        <Field
          label={tx(W.whoDrives)}
          hint={alsoDrives.length ? tx(W.alsoDrives(alsoDrives.map((t) => `${t.busName} ${timeText(tx, t.startsAt)}`).join(", "))) : undefined}
          error={err("driverId") ? tx(err("driverId")!) : undefined}
        >
          <Select value={draft.driverId} invalid={Boolean(errors.driverId)} onChange={(e) => change({ driverId: e.target.value })} style={{ height: 48, fontSize: 16 }}>
            <option value="">{tx(W.noDriverYet)}</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>{d.phone ? `${d.name} · ${phoneText(d.phone)}` : d.name}</option>
            ))}
            <option value={NEW_DRIVER}>{tx(W.newDriver)}</option>
          </Select>
        </Field>

        {draft.driverId === NEW_DRIVER ? (
          <div className="fadein" style={{ ...TWO, padding: 14, borderRadius: 16, background: "var(--s2)" }}>
            <Field label={tx(W.newDriverName)} error={err("newDriver.name") ? tx(err("newDriver.name")!) : undefined}>
              <Input
                value={newDriver.name}
                maxLength={DRIVER_LIMITS.name}
                invalid={Boolean(errors["newDriver.name"])}
                onChange={(e) => { setNewDriver((n) => ({ ...n, name: e.target.value })); setErrors((all) => without(all, "newDriver.name")); }}
                autoComplete="off"
              />
            </Field>
            <Field label={tx(W.phone)} hint={tx(W.phoneHint)} error={err("newDriver.phone") ? tx(err("newDriver.phone")!) : undefined}>
              <PhoneInput
                value={newDriver.phone}
                invalid={Boolean(errors["newDriver.phone"])}
                onChange={(phone) => { setNewDriver((n) => ({ ...n, phone })); setErrors((all) => without(all, "newDriver.phone")); }}
              />
            </Field>
            <span style={{ gridColumn: "1 / -1", fontSize: 13, color: "var(--mut)" }}>{tx(W.newDriverHint)}</span>
          </div>
        ) : null}

        <div style={TWO}>
          <Field label={tx(W.helperName)} error={err("helperName") ? tx(err("helperName")!) : undefined}>
            <Input
              value={draft.helperName}
              maxLength={TRIP_LIMITS.helperName}
              invalid={Boolean(errors.helperName)}
              onChange={(e) => change({ helperName: e.target.value })}
              autoComplete="off"
            />
          </Field>
          <Field label={tx(W.helperPhone)} hint={tx(W.phoneHint)} error={err("helperPhone") ? tx(err("helperPhone")!) : undefined}>
            <PhoneInput value={draft.helperPhone} invalid={Boolean(errors.helperPhone)} onChange={(helperPhone) => change({ helperPhone })} />
          </Field>
        </div>

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-labelledby="transport-stops">
          <span id="transport-stops" style={{ fontWeight: 700, fontSize: 15 }}>{tx(W.routesInOrder)}</span>
          <span style={{ fontSize: 13, color: "var(--mut)", marginTop: -6 }}>{tx(W.routesHint)}</span>

          {draft.stops.length ? (
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {draft.stops.map((stop, index) => {
                const name = nameOf(stop.routeId);
                const riders = ridersOn.get(stop.routeId) ?? 0;
                return (
                  <li
                    key={stop.routeId}
                    className="card"
                    style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, boxShadow: "none", animation: "xIn .25s var(--ease) both" }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <span className="num" aria-hidden="true" style={NUMBER}>{index + 1}</span>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                        <strong className="clip" style={{ fontSize: 16 }}>{name}</strong>
                        <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.children(riders))}</span>
                      </span>
                      <IconButton icon="arrowUp" label={tx(W.moveUp(name))} disabled={index === 0} onClick={() => { cue("tap"); setStops(moveStop(draft.stops, index, -1)); }} />
                      <IconButton icon="arrowDown" label={tx(W.moveDown(name))} disabled={index === draft.stops.length - 1} onClick={() => { cue("tap"); setStops(moveStop(draft.stops, index, 1)); }} />
                      <IconButton icon="x" label={tx(W.removeStop(name))} danger onClick={() => { cue("undo"); setStops(draft.stops.filter((_, i) => i !== index)); }} />
                    </span>
                    <label style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px 10px", fontSize: 14, color: "var(--mut)", paddingLeft: 40 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}>
                        <Ic n="clock" size={16} />
                        {tx(W.stopTime)}
                      </span>
                      <Input
                        type="time"
                        value={stop.stopTime}
                        aria-label={`${tx(W.stopTime)}: ${name}`}
                        onChange={(e) => setStops(draft.stops.map((s, i) => (i === index ? { ...s, stopTime: e.target.value } : s)))}
                        style={{ width: 150, maxWidth: "100%", height: 40 }}
                      />
                    </label>
                  </li>
                );
              })}
            </ol>
          ) : null}

          {draft.stops.length ? (
            <span className="fadein" key={carries} style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: "var(--info)" }}>
              <Ic n="users" size={18} />
              {tx(W.carriesLive(carries))}
            </span>
          ) : null}

          {errors.stops ? (
            <span role="alert" style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--bad)", fontWeight: 600, fontSize: 13 }}>
              <Ic n="alert" size={14} />
              {tx(said(errors.stops)!)}
            </span>
          ) : null}

          {picking ? (
            <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, borderRadius: 16, border: "1px solid var(--acc)", background: "var(--accs)" }}>
              <strong style={{ fontSize: 15 }}>{tx(W.pickRoute)}</strong>
              {options.length > 8 ? <SearchBox value={find} onChange={setFind} placeholder={tx(W.findRoute)} /> : null}
              <div className="scroll" style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320 }}>
                {offered.length === 0 ? (
                  <span style={{ color: "var(--mut)", fontSize: 14, padding: "8px 2px" }}>
                    {tx(options.length === 0 ? W.namesMissing : find ? W.nothingFound : W.allAdded)}
                  </span>
                ) : (
                  offered.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="tap"
                      disabled={draft.stops.length >= TRIP_LIMITS.stops}
                      onClick={() => addStop(o.id)}
                      style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "8px 12px", borderRadius: 12, border: "1px solid var(--bd)", background: "var(--card)", color: "var(--fg)", textAlign: "left", width: "100%", font: "inherit" }}
                    >
                      <Ic n="plus" size={18} style={{ color: "var(--accfg)", flex: "none" }} />
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                        <span className="clip" style={{ fontWeight: 600 }}>{o.known ? o.name : tx(W.unnamed)}</span>
                        {!o.known && o.name ? <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{o.name}</span> : null}
                      </span>
                      <Pill tone={o.riders ? "info" : "mut"}>{tx(W.children(o.riders))}</Pill>
                    </button>
                  ))
                )}
              </div>
              <Btn variant="soft" icon="check" onClick={() => { cue("tap"); setPicking(false); setFind(""); }}>{tx(W.doneAdding)}</Btn>
            </div>
          ) : (
            <Btn big icon="plus" onClick={() => { cue("tap"); setPicking(true); }} disabled={draft.stops.length >= TRIP_LIMITS.stops}>
              {tx(W.addRoute)}
            </Btn>
          )}
        </section>

        <Field label={tx(W.notes)} hint={tx(W.notesHint)} error={err("notes") ? tx(err("notes")!) : undefined}>
          <VoiceNote value={draft.notes} onChange={(notes) => change({ notes })} rows={3} placeholder={tx(W.notesExample)} />
        </Field>

        {editing ? (
          <RemoveBox
            asking={asking}
            busy={busy}
            label={tx(W.removeBus)}
            question={tx(W.removeBusQ)}
            body={tx(W.removeBusBody)}
            onAsk={() => { cue("warn"); setAsking(true); }}
            onCancel={() => setAsking(false)}
            onConfirm={remove}
            disabled={done}
          />
        ) : null}
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------- driver */

export function DriverEditor(props: {
  sessionLabel: string;
  test: boolean;
  initial: DriverDraft;
  /** How many buses this driver drives now, for the removal question. */
  trips: number;
  onClose: () => void;
  onSaved: (message: Pair) => void;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const { open, close } = useClosing(props.onClose);
  const [draft, setDraft] = useState<DriverDraft>(props.initial);
  const [errors, setErrors] = useState<Errors>({});
  const [save, setSave] = useState<SaveState>(SAVE_IDLE);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [unsure, setUnsure] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const [asking, setAsking] = useState(false);
  const slow = useSlowSave(busy);
  const editing = props.initial.id !== null;

  const change = (patch: Partial<DriverDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    const fields = Object.keys(patch);
    if (fields.some((f) => errors[f])) setErrors((all) => without(all, ...fields));
    if (save.kind === "failed" && !unsure) setSave(SAVE_IDLE);
  };

  const submit = async () => {
    if (busy || done) return;
    const checked = checkDriver(draft);
    if (!checked.ok) {
      const found: Errors = {};
      for (const [k, v] of Object.entries(checked.errors)) if (v) found[k] = v;
      setErrors(found);
      setCanRetry(false);
      setSave({ kind: "failed", message: W.fixAbove });
      return;
    }
    cue("tap");
    setErrors({});
    setBusy(true);
    setSave({ kind: "saving" });
    let result: TransportResult;
    try {
      result = await saveDriverAction({ session: props.sessionLabel, draft });
    } catch {
      setBusy(false);
      setUnsure(true);
      setCanRetry(false);
      setSave({ kind: "failed", message: W.unsure, next: W.unsureNext });
      router.refresh();
      return;
    }
    setBusy(false);
    if (result.ok) {
      setDone(true);
      setSave({ kind: "saved" });
      props.onSaved(result.message);
      window.setTimeout(close, SAVED_PAUSE_MS);
      return;
    }
    setErrors(result.fields ?? {});
    setCanRetry(!result.fields && !FINAL.includes(result.message.en));
    setSave({ kind: "failed", message: result.message });
  };

  const remove = async () => {
    if (!draft.id || busy) return;
    setBusy(true);
    setSave({ kind: "saving" });
    let result: TransportResult;
    try {
      result = await deleteDriverAction({ session: props.sessionLabel, id: draft.id });
    } catch {
      setBusy(false);
      setAsking(false);
      setSave({ kind: "failed", message: W.unsure, next: W.unsureNext });
      router.refresh();
      return;
    }
    setBusy(false);
    setAsking(false);
    if (result.ok) {
      setDone(true);
      setSave({ kind: "removed" });
      props.onSaved(result.message);
      window.setTimeout(close, SAVED_PAUSE_MS);
      return;
    }
    setSave({ kind: "failed", message: result.message });
  };

  const err = (field: string) => said(errors[field]);
  const name = draft.name.trim() || props.initial.name;

  return (
    <Sheet
      open={open}
      onClose={close}
      title={tx(editing ? W.changeDriver : W.addDriverT)}
      icon="user"
      dismissable={!busy}
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", minWidth: 0 }}>
          <SaveStatus state={busy ? { kind: "saving", slow } : save} test={props.test} onRetry={canRetry ? submit : undefined} reserve={false} />
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={close} disabled={busy} style={{ flex: 1 }}>{tx(W.cancel)}</Btn>
            <SaveButton busy={busy} done={done} disabled={busy || done || (unsure && !editing)} onClick={submit} label={tx(W.saveDriver)} />
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 8 }}>
        <Field label={tx(W.driverName)} error={err("name") ? tx(err("name")!) : undefined}>
          <Input
            value={draft.name}
            maxLength={DRIVER_LIMITS.name}
            invalid={Boolean(errors.name)}
            onChange={(e) => change({ name: e.target.value })}
            autoComplete="off"
            style={{ fontSize: 17 }}
          />
        </Field>
        <Field label={tx(W.phone)} hint={tx(W.phoneHint)} error={err("phone") ? tx(err("phone")!) : undefined}>
          <PhoneInput value={draft.phone} invalid={Boolean(errors.phone)} onChange={(phone) => change({ phone })} />
        </Field>
        <Field label={tx(W.driverNotes)} hint={tx(W.driverNotesHint)} error={err("notes") ? tx(err("notes")!) : undefined}>
          <VoiceNote value={draft.notes} onChange={(notes) => change({ notes })} rows={3} />
        </Field>
        {editing ? (
          <RemoveBox
            asking={asking}
            busy={busy}
            label={tx(W.removeDriver)}
            question={tx(W.removeDriverQ(name))}
            body={tx(W.removeDriverBody(props.trips))}
            onAsk={() => { cue("warn"); setAsking(true); }}
            onCancel={() => setAsking(false)}
            onConfirm={remove}
            disabled={done}
          />
        ) : null}
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------- pieces */

const TWO: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 14 };

const NUMBER: CSSProperties = {
  flex: "none",
  width: 30,
  height: 30,
  borderRadius: 15,
  background: "var(--infos)",
  color: "var(--info)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
};

/** A 10-digit mobile box: the number pad on a phone, the digits grouped as they are read out. */
function PhoneInput({ value, invalid, onChange }: { value: string; invalid: boolean; onChange: (value: string) => void }) {
  return (
    <Input
      type="tel"
      inputMode="tel"
      autoComplete="off"
      value={value}
      invalid={invalid}
      maxLength={16}
      placeholder="98765 43210"
      onChange={(e) => onChange(e.target.value.replace(/[^\d+\s-]/g, ""))}
      lead={<Ic n="phone" size={16} />}
    />
  );
}

function IconButton({ icon, label, onClick, disabled, danger }: { icon: "arrowUp" | "arrowDown" | "x"; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      className="tap icon-btn"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{ flex: "none", border: "1px solid var(--bd)", background: "var(--card)", color: danger ? "var(--bad)" : "var(--fg)", opacity: disabled ? 0.35 : 1 }}
    >
      <Ic n={icon} size={18} />
    </button>
  );
}

function SaveButton({ busy, done, disabled, onClick, label }: { busy: boolean; done: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className="tap btn pri big" disabled={disabled} onClick={onClick} style={{ flex: 2, minWidth: 0 }}>
      {busy ? <Ic n="refresh" size={18} className="spin" /> : <Ic n="check" size={18} />}
      <span className="clip">{label}</span>
      {done ? <span aria-hidden="true" style={{ animation: "xPopIn .4s var(--spring) both" }}>✓</span> : null}
    </button>
  );
}

/** "Remove this …", then the question and its answer in place: never a second sheet over the first. */
function RemoveBox({
  asking,
  busy,
  label,
  question,
  body,
  onAsk,
  onCancel,
  onConfirm,
  disabled,
}: {
  asking: boolean;
  busy: boolean;
  label: string;
  question: string;
  body: ReactNode;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const { tx } = useVx();
  if (!asking) {
    return (
      <span style={{ display: "flex", justifyContent: "flex-start", paddingTop: 4, borderTop: "1px solid var(--bd)" }}>
        <Btn variant="ghost" icon="trash" onClick={onAsk} disabled={disabled || busy} style={{ color: "var(--bad)", marginTop: 10 }}>
          {label}
        </Btn>
      </span>
    );
  }
  return (
    <div role="alertdialog" aria-label={question} className="fadein" style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, borderRadius: 16, border: "1px solid var(--bad)", background: "var(--bads)" }}>
      <strong style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--bad)", fontSize: 16 }}>
        <Ic n="alert" size={18} />
        {question}
      </strong>
      <span style={{ fontSize: 14 }}>{body}</span>
      <span style={{ display: "flex", gap: 8 }}>
        <Btn onClick={onCancel} disabled={busy} style={{ flex: 1 }}>{tx(W.cancel)}</Btn>
        <Btn variant="danger" icon={busy ? undefined : "trash"} onClick={onConfirm} disabled={busy} style={{ flex: 1 }}>
          {busy ? <Ic n="refresh" size={16} className="spin" /> : null}
          {tx(W.remove)}
        </Btn>
      </span>
    </div>
  );
}
