"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

import { telHref, type Rider, type RouteCard, type Shift, type TripView } from "@/modules/transport/domain/board";
import { cue } from "@/ui/feedback/cue";
import Link from "@/ui/link";
import { timeP } from "@/vx/format";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { Pair } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";
import { Avatar, Btn, EmptyState, Pill, SecHead } from "@/vx/ui/primitives";

import { W } from "./words";

/*
 * The two sheets the Transport screen opens (D-550): a route, with the buses
 * that come to it and its children class by class; and a bus run, with its
 * driver and helper and its children route by route, in the order the bus
 * goes. Both only read. The buttons that change a bus open the editor.
 */

export const SHIFT_ICON: Record<Shift, IconName> = { morning: "sun", afternoon: "clock", other: "bus" };

/** "7:05 am" / "सुबह 7:05". An empty time reads as nothing. */
export function timeText(tx: (pair: Pair | string) => string, time: string | null | undefined): string {
  return time ? tx(timeP(time)) : "";
}

/** "98765 43210": a mobile number the way people read it out. */
export function phoneText(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : phone;
}

/** "AK" for a name; "?" for none. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * A big "Call" button. A plain `<a>`: `tel:` opens the phone's dialler, so it
 * must never go through the app's router link.
 */
export function CallLink({ phone, name, style }: { phone: string; name: string; style?: CSSProperties }) {
  const { tx } = useVx();
  return (
    <a
      href={telHref(phone)}
      className="tap btn soft"
      aria-label={`${tx(W.callWho(name))}, ${phoneText(phone)}`}
      onClick={() => cue("tap")}
      style={{ flex: "none", textDecoration: "none", ...style }}
    >
      <Ic n="phone" size={18} />
      {tx(W.call)}
    </a>
  );
}

/** The last value that was not null, so a sheet keeps its words while it slides away. */
function useLast<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(value);
  if (value !== null && value !== last) setLast(value);
  return value ?? last;
}

/* ------------------------------------------------------------------ route */

export function RouteSheet({
  card,
  onClose,
  fleetReady,
  manage,
  canOpenChildren,
  onAddBus,
  onOpenTrip,
}: {
  card: RouteCard | null;
  onClose: () => void;
  fleetReady: boolean;
  manage: boolean;
  canOpenChildren: boolean;
  onAddBus: (routeId: string) => void;
  onOpenTrip: (tripId: string) => void;
}) {
  const { tx } = useVx();
  const shown = useLast(card);
  if (!shown) return null;
  const name = shown.known ? shown.name : tx(W.unnamed);
  const groups = byClass(shown.riders);

  return (
    <Sheet
      open={Boolean(card)}
      onClose={onClose}
      title={name}
      sub={[tx(W.children(shown.riders.length)), shown.code].filter(Boolean).join(" · ")}
      icon="mapPin"
      wide
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {fleetReady ? (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SecHead>{tx(W.busesHere)}</SecHead>
            {shown.visits.length === 0 ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--warnfg)", fontWeight: 600 }}>
                <Ic n="alert" size={18} style={{ flex: "none" }} />
                {tx(W.noBusHere)}
              </span>
            ) : (
              shown.visits.map((visit, index) => (
                <div
                  key={`${visit.tripId}-${index}`}
                  className="card"
                  style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, minWidth: 0, boxShadow: "none" }}
                >
                  <button
                    type="button"
                    className="tap"
                    onClick={() => { cue("tap"); onOpenTrip(visit.tripId); }}
                    style={{ all: "unset", cursor: "pointer", flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, minHeight: 48 }}
                  >
                    <TimeBox shift={visit.shift} time={visit.stopTime ?? visit.startsAt} />
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <strong style={{ fontSize: 16, lineHeight: 1.25, overflowWrap: "anywhere" }}>{visit.busName}</strong>
                      <span style={{ fontSize: 14, lineHeight: 1.35, overflowWrap: "anywhere", color: visit.driver ? "var(--mut)" : "var(--warnfg)", fontWeight: visit.driver ? 400 : 600 }}>
                        {tx(W.shift[visit.shift])} · {visit.driver ? `${tx(W.driver)}: ${visit.driver.name}` : tx(W.noDriver)}
                      </span>
                    </span>
                    <Ic n="chevRight" size={18} style={{ color: "var(--mut)", flex: "none" }} />
                  </button>
                  {visit.driver?.phone ? <CallLink phone={visit.driver.phone} name={visit.driver.name} /> : null}
                </div>
              ))
            )}
            {manage ? (
              <Btn variant={shown.visits.length ? "soft" : "pri"} big={!shown.visits.length} icon="plus" onClick={() => onAddBus(shown.id)}>
                {tx(W.addBusHere)}
              </Btn>
            ) : null}
          </section>
        ) : null}

        <section style={{ display: "flex", flexDirection: "column" }}>
          <SecHead>{tx(W.childrenOnRoute)}</SecHead>
          {shown.riders.length === 0 ? (
            <EmptyState icon="users" title={tx(W.noChildren)} />
          ) : (
            groups.map((group, index) => (
              <div key={`${index}-${group.label}`} style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontWeight: 700, fontSize: 14, padding: "6px 4px" }}>
                  <span className="clip">{group.label}</span>
                  <Pill tone="info">{tx(W.children(group.riders.length))}</Pill>
                </span>
                {group.riders.map((rider) => (
                  <RiderRow key={rider.id} rider={rider} canOpen={canOpenChildren} />
                ))}
              </div>
            ))
          )}
        </section>
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------------- bus */

export function TripSheet({
  trip,
  cards,
  onClose,
  manage,
  canOpenChildren,
  onChange,
  onReturn,
}: {
  trip: TripView | null;
  cards: RouteCard[];
  onClose: () => void;
  manage: boolean;
  canOpenChildren: boolean;
  onChange: (trip: TripView) => void;
  onReturn: (trip: TripView) => void;
}) {
  const { tx } = useVx();
  const shown = useLast(trip);
  if (!shown) return null;
  const ridersOf = (routeId: string) => cards.find((c) => c.id === routeId)?.riders ?? [];
  const title = shown.vehicleNo ? `${shown.busName} · ${shown.vehicleNo}` : shown.busName;
  const sub = [tx(W.shiftLong[shown.shift]), tx(W.leaves(timeP(shown.startsAt))), tx(W.busCarries(shown.riders))].join(" · ");
  const canReturn = shown.shift === "morning" || shown.shift === "afternoon";

  return (
    <Sheet
      open={Boolean(trip)}
      onClose={onClose}
      title={title}
      sub={sub}
      icon={SHIFT_ICON[shown.shift]}
      wide
      footer={manage ? (
        <>
          <Btn icon="edit" onClick={() => onChange(shown)} style={{ flex: 1 }}>{tx(W.edit)}</Btn>
          {canReturn ? (
            <Btn variant="soft" icon="refresh" className="wrap" onClick={() => onReturn(shown)} style={{ flex: 2 }}>
              {tx(shown.shift === "morning" ? W.makeReturn : W.makeMorning)}
            </Btn>
          ) : null}
        </>
      ) : undefined}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Person label={tx(W.driver)} name={shown.driver?.name ?? null} phone={shown.driver?.phone ?? null} seed={shown.driver?.id ?? shown.id} missing={tx(W.noDriver)} />
          {shown.helperName || shown.helperPhone ? (
            <Person label={tx(W.helper)} name={shown.helperName} phone={shown.helperPhone} seed={`${shown.id}-helper`} missing={tx(W.helper)} />
          ) : null}
          {shown.notes ? (
            <span style={{ display: "flex", gap: 8, alignItems: "flex-start", color: "var(--mut)", fontSize: 14, whiteSpace: "pre-line" }}>
              <Ic n="info" size={16} style={{ flex: "none", marginTop: 2 }} />
              <span>{shown.notes}</span>
            </span>
          ) : null}
        </section>

        <section style={{ display: "flex", flexDirection: "column" }}>
          <SecHead>{tx(W.childrenOnBus)}</SecHead>
          {shown.stopViews.map((stop, index) => {
            const riders = ridersOf(stop.routeId);
            return (
              <div key={stop.routeId} style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px", minWidth: 0 }}>
                  <span
                    className="num"
                    aria-hidden="true"
                    style={{ flex: "none", width: 28, height: 28, borderRadius: 14, background: "var(--infos)", color: "var(--info)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}
                  >
                    {index + 1}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <strong style={{ fontSize: 15, lineHeight: 1.25, overflowWrap: "anywhere" }}>{stop.known ? stop.name : tx(W.unnamed)}</strong>
                    {stop.stopTime ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.stopAt(timeP(stop.stopTime)))}</span> : null}
                  </span>
                  <Pill tone={riders.length ? "info" : "mut"}>{tx(W.children(riders.length))}</Pill>
                </span>
                {riders.map((rider) => (
                  <RiderRow key={rider.id} rider={rider} canOpen={canOpenChildren} />
                ))}
              </div>
            );
          })}
        </section>
      </div>
    </Sheet>
  );
}

/* ----------------------------------------------------------------- pieces */

function TimeBox({ shift, time }: { shift: Shift; time: string }) {
  const { tx } = useVx();
  return (
    <span style={{ flex: "none", minWidth: 72, padding: "6px 8px", borderRadius: 12, background: "var(--infos)", color: "var(--info)", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <Ic n={SHIFT_ICON[shift]} size={14} />
      <span className="num" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.1, whiteSpace: "nowrap" }}>{timeText(tx, time)}</span>
    </span>
  );
}

function Person({ label, name, phone, seed, missing }: { label: string; name: string | null; phone: string | null; seed: string; missing: string }) {
  return (
    <div className="card" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 12, minWidth: 0, boxShadow: "none" }}>
      <Avatar text={name ? initialsOf(name) : "?"} seed={seed} size={44} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{label}</span>
        <strong className="clip" style={{ fontSize: 16, color: name ? undefined : "var(--warnfg)" }}>{name ?? missing}</strong>
        {phone ? <span className="num" style={{ fontSize: 14, color: "var(--mut)" }}>{phoneText(phone)}</span> : null}
      </span>
      {phone ? <CallLink phone={phone} name={name ?? label} /> : null}
    </div>
  );
}

function RiderRow({ rider, canOpen }: { rider: Rider; canOpen: boolean }) {
  const { tx } = useVx();
  const style: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    padding: "8px 4px",
    borderTop: "1px solid var(--bd)",
    color: "var(--fg)",
    textDecoration: "none",
    minWidth: 0,
  };
  const inner: ReactNode = (
    <>
      <Avatar text={initialsOf(rider.name)} seed={rider.id} photo={rider.photo} size={40} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span className="clip" style={{ fontWeight: 600 }}>{rider.name}</span>
        <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>
          {rider.classLabel}
          {rider.admissionNo ? ` · ${tx(W.sr(rider.admissionNo))}` : ""}
        </span>
      </span>
      {canOpen ? <Ic n="chevRight" size={16} style={{ color: "var(--mut)", flex: "none" }} /> : null}
    </>
  );
  return canOpen ? (
    <Link href={`/students/${rider.id}`} className="row tap" style={style}>
      {inner}
    </Link>
  ) : (
    <div className="row" style={style}>
      {inner}
    </div>
  );
}

function byClass(riders: readonly Rider[]): { label: string; riders: Rider[] }[] {
  const groups: { label: string; riders: Rider[] }[] = [];
  for (const rider of riders) {
    const last = groups[groups.length - 1];
    if (last && last.label === rider.classLabel) last.riders.push(rider);
    else groups.push({ label: rider.classLabel, riders: [rider] });
  }
  return groups;
}
