"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type CSSProperties } from "react";

import { refreshRouteNamesAction } from "@/app/(app)/transport/actions";
import {
  buildBoard,
  draftOf,
  emptyTrip,
  returnTripOf,
  searchBoard,
  suggestedShift,
  type Driver,
  type DriverDraft,
  type DriverView,
  type Rider,
  type RouteCard,
  type RouteInfo,
  type RouteSource,
  type Shift,
  type Trip,
  type TripDraft,
  type TripView,
} from "@/modules/transport/domain/board";
import { cue } from "@/ui/feedback/cue";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { Chip, ChipRow, SearchBox, Seg } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { Banner, Grid, Section, TopBar, VxPage } from "@/vx/ui/page";
import { Avatar, Btn, Card, EmptyState, IconTile, Kpi, Pill, SecHead } from "@/vx/ui/primitives";

import { DriverEditor, TripEditor } from "./editors";
import { CallLink, initialsOf, phoneText, RouteSheet, SHIFT_ICON, TripSheet, timeText } from "./sheets";
import { W } from "./words";

/*
 * Transport (owner, 7 Nov 2026, D-550). Three views of one set of facts:
 *  - Routes: every route with its children and the buses that come to it;
 *  - Bus times: every bus run by time of day, its driver, its routes in order
 *    and how many children it carries;
 *  - Drivers: every driver with the buses they drive.
 * Tapping a route or a bus opens its children. With `transport:manage` the
 * buttons to add and change buses and drivers appear; everything else reads.
 */

export type TransportTab = "routes" | "times" | "drivers";

type Props = {
  sessionLabel: string;
  test: boolean;
  canManage: boolean;
  canRefreshNames: boolean;
  /** The reader may open a child's page (`students:view`). */
  canOpenChildren: boolean;
  fleetReady: boolean;
  routeSource: RouteSource;
  routes: RouteInfo[];
  riders: Rider[];
  drivers: Driver[];
  trips: Trip[];
  initialTab: TransportTab;
};

type RouteFilter = "all" | "noMorning" | "noAfternoon";
type TimeFilter = "all" | Shift | "noDriver";

const cardButton: CSSProperties = {
  textAlign: "left",
  font: "inherit",
  color: "var(--fg)",
  cursor: "pointer",
  width: "100%",
  padding: "14px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minWidth: 0,
  lineHeight: "normal",
};

/** The classes on a route card: up to two lines; the route sheet lists every child. */
const TWO_LINES: CSSProperties = {
  fontSize: 13,
  color: "var(--mut)",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  overflowWrap: "anywhere",
};

export function TransportScreen(props: Props) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [tab, setTabState] = useState<TransportTab>(props.initialTab);
  const [query, setQuery] = useState("");
  const [routeFilter, setRouteFilter] = useState<RouteFilter>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [openRoute, setOpenRoute] = useState<string | null>(null);
  const [openTrip, setOpenTrip] = useState<string | null>(null);
  const [tripEdit, setTripEdit] = useState<{ draft: TripDraft; expected: string | null; key: number } | null>(null);
  const [driverEdit, setDriverEdit] = useState<{ draft: DriverDraft; key: number } | null>(null);
  const [refreshing, startRefresh] = useTransition();

  const board = useMemo(
    () => buildBoard({ routes: props.routes, riders: props.riders, trips: props.trips, drivers: props.drivers }),
    [props.routes, props.riders, props.trips, props.drivers],
  );
  const found = useMemo(() => searchBoard(board, query), [board, query]);
  const searching = query.trim().length > 0;
  const manage = props.canManage && props.fleetReady;
  const unnamed = board.cards.some((c) => !c.known && c.riders.length > 0);

  const setTab = (next: TransportTab) => {
    setTabState(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === "routes") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url.toString());
  };

  const newTrip = (stops: string[] = []) => {
    cue("tap");
    setOpenRoute(null);
    setOpenTrip(null);
    setTripEdit({ draft: emptyTrip(suggestedShift(props.trips), stops), expected: null, key: Date.now() });
  };
  const changeTrip = (trip: Trip) => {
    cue("tap");
    setOpenTrip(null);
    setTripEdit({ draft: draftOf(trip), expected: trip.updatedAt, key: Date.now() });
  };
  const returnTrip = (trip: Trip) => {
    cue("tap");
    setOpenTrip(null);
    setTripEdit({ draft: returnTripOf(trip), expected: null, key: Date.now() });
  };
  const newDriver = () => {
    cue("tap");
    setDriverEdit({ draft: { id: null, name: "", phone: "", notes: "" }, key: Date.now() });
  };
  const changeDriver = (driver: Driver) => {
    cue("tap");
    setDriverEdit({ draft: { id: driver.id, name: driver.name, phone: driver.phone ?? "", notes: driver.notes ?? "" }, key: Date.now() });
  };

  // The form's own saving line has already been felt and heard, so the toast is quiet.
  const saved = (message: { en: string; hi?: string }) => {
    toast.show({ text: tx(message), tone: "ok", cue: false });
    router.refresh();
  };

  const refreshNames = () => {
    cue("tap");
    startRefresh(async () => {
      const result = await refreshRouteNamesAction({ session: props.sessionLabel });
      toast.show({ text: tx(result.message), tone: result.ok ? "ok" : "bad" });
      if (result.ok) router.refresh();
    });
  };

  const tripsMorning = board.trips.filter((t) => t.shift === "morning").length;
  const tripsAfternoon = board.trips.filter((t) => t.shift === "afternoon").length;
  const idleDrivers = board.drivers.filter((d) => d.trips.length === 0).length;
  const routeOf = openRoute ? board.cards.find((c) => c.id === openRoute) ?? null : null;
  const tripOf = openTrip ? board.trips.find((t) => t.id === openTrip) ?? null : null;

  const addBusButton = manage ? (
    <Btn variant="pri" icon="plus" onClick={() => newTrip()}>
      {tx(W.addBus)}
    </Btn>
  ) : null;

  return (
    <VxPage label={tx(W.title)}>
      <TopBar
        crumb={tx(W.crumb)}
        title={tx(W.title)}
        mSub={props.sessionLabel}
        mBack="/menu"
        actions={addBusButton}
        mAction={manage ? (
          <Btn variant="pri" icon="plus" onClick={() => newTrip()} style={{ height: 40, padding: "0 12px" }}>
            {tx(W.addBus)}
          </Btn>
        ) : null}
      />
      <Section gap={14}>
        <p style={{ margin: 0, color: "var(--mut)", fontSize: 15 }}>{tx(W.lead)}</p>

        {!props.fleetReady ? <Banner tone="info">{tx(W.notReady)}</Banner> : null}
        {props.routeSource === "none" || unnamed ? (
          <Banner
            tone="warn"
            action={props.canRefreshNames ? (
              <Btn variant="soft" icon="refresh" onClick={refreshNames} disabled={refreshing}>
                {tx(refreshing ? W.refreshing : W.refreshNames)}
              </Btn>
            ) : undefined}
          >
            {tx(W.namesMissing)}
          </Banner>
        ) : null}

        <Grid cols={4}>
          <Kpi icon="users" label={tx(W.kpi.riders)} value={board.totals.riders} sub={tx(W.kpiSub.riders(board.totals.riders))} />
          <Kpi icon="mapPin" label={tx(W.kpi.routes)} value={board.totals.routes} sub={tx(W.kpiSub.routes(board.quietRoutes))} delay={40} />
          <Kpi
            icon="bus"
            label={tx(W.kpi.trips)}
            value={board.totals.trips}
            sub={board.totals.trips ? tx(W.kpiSub.trips(tripsMorning, tripsAfternoon)) : tx(W.kpiSub.tripsNone)}
            delay={80}
          />
          <Kpi
            icon="user"
            label={tx(W.kpi.drivers)}
            value={board.totals.drivers}
            sub={board.totals.drivers ? (idleDrivers ? tx(W.kpiSub.drivers(idleDrivers)) : tx(W.kpiSub.driversAll)) : undefined}
            delay={120}
          />
        </Grid>

        {manage && board.trips.length === 0 ? (
          <Card style={{ display: "flex", flexDirection: "column", gap: 12, borderColor: "var(--acc)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <IconTile icon="flag" tone="acc" />
              <strong style={{ fontSize: 17 }}>{tx(W.startHere)}</strong>
            </span>
            <span style={{ color: "var(--mut)", whiteSpace: "pre-line" }}>{tx(W.startBody).replace(/\s{2,}(?=\d\.)/g, "\n")}</span>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn big icon="user" onClick={newDriver}>{tx(W.addDriver)}</Btn>
              <Btn big variant="pri" icon="bus" onClick={() => newTrip()}>{tx(W.addBus)}</Btn>
            </span>
          </Card>
        ) : null}

        {manage && board.trips.length > 0 && (board.noMorning.length || board.noAfternoon.length || board.noDriver.length) ? (
          <Card style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <SecHead>{tx(W.todo)}</SecHead>
            {board.noMorning.length ? (
              <TodoLine icon="sun" text={tx(W.todoNoMorning(board.noMorning.length))} action={tx(W.show)} onClick={() => { cue("select"); setQuery(""); setRouteFilter("noMorning"); setTab("routes"); }} />
            ) : null}
            {board.noAfternoon.length ? (
              <TodoLine icon="clock" text={tx(W.todoNoAfternoon(board.noAfternoon.length))} action={tx(W.show)} onClick={() => { cue("select"); setQuery(""); setRouteFilter("noAfternoon"); setTab("routes"); }} />
            ) : null}
            {board.noDriver.length ? (
              <TodoLine icon="user" text={tx(W.todoNoDriver(board.noDriver.length))} action={tx(W.show)} onClick={() => { cue("select"); setQuery(""); setTimeFilter("noDriver"); setTab("times"); }} />
            ) : null}
          </Card>
        ) : null}

        <Seg<TransportTab>
          label={tx(W.tabsLabel)}
          value={tab}
          onChange={setTab}
          options={[
            { value: "routes", label: `${tx(W.tabs.routes)} · ${board.totals.routes}` },
            { value: "times", label: `${tx(W.tabs.times)} · ${board.totals.trips}` },
            { value: "drivers", label: `${tx(W.tabs.drivers)} · ${board.totals.drivers}` },
          ]}
          style={{ height: 48 }}
        />

        <SearchBox value={query} onChange={setQuery} placeholder={tx(W.search)} />

        {tab === "routes" ? (
          <RoutesView
            cards={found.cards}
            riders={found.riders}
            searching={searching}
            filter={routeFilter}
            setFilter={(f) => { cue("select"); setRouteFilter(f); }}
            board={board}
            fleetReady={props.fleetReady}
            onOpen={(id) => { cue("tap"); setOpenRoute(id); }}
            onClear={() => setQuery("")}
          />
        ) : null}

        {tab === "times" ? (
          <TimesView
            trips={found.trips}
            searching={searching}
            filter={timeFilter}
            setFilter={(f) => { cue("select"); setTimeFilter(f); }}
            fleetReady={props.fleetReady}
            manage={manage}
            onOpen={(id) => { cue("tap"); setOpenTrip(id); }}
            onAdd={() => newTrip()}
            onClear={() => setQuery("")}
          />
        ) : null}

        {tab === "drivers" ? (
          <DriversView
            drivers={found.drivers}
            searching={searching}
            fleetReady={props.fleetReady}
            manage={manage}
            onAdd={newDriver}
            onChange={changeDriver}
            onOpenTrip={(id) => { cue("tap"); setOpenTrip(id); }}
            onClear={() => setQuery("")}
          />
        ) : null}

        <Card style={{ display: "flex", flexDirection: "column", gap: 10, background: "var(--s2)", boxShadow: "none" }}>
          <span style={{ display: "flex", gap: 10, alignItems: "flex-start", color: "var(--mut)", fontSize: 14 }}>
            <Ic n="info" size={18} style={{ flex: "none", marginTop: 1 }} />
            <span>{tx(props.canManage ? W.fromFees : W.readOnly)}</span>
          </span>
          {props.canRefreshNames && props.routeSource !== "none" && !unnamed ? (
            <span>
              <Btn variant="ghost" icon="refresh" onClick={refreshNames} disabled={refreshing}>
                {tx(refreshing ? W.refreshing : W.refreshNames)}
              </Btn>
            </span>
          ) : null}
        </Card>
      </Section>

      <RouteSheet
        card={routeOf}
        onClose={() => setOpenRoute(null)}
        fleetReady={props.fleetReady}
        manage={manage}
        canOpenChildren={props.canOpenChildren}
        onAddBus={(routeId) => newTrip([routeId])}
        onOpenTrip={(id) => { setOpenRoute(null); setOpenTrip(id); }}
      />
      <TripSheet
        trip={tripOf}
        cards={board.cards}
        onClose={() => setOpenTrip(null)}
        manage={manage}
        canOpenChildren={props.canOpenChildren}
        onChange={changeTrip}
        onReturn={returnTrip}
      />
      {tripEdit ? (
        <TripEditor
          key={tripEdit.key}
          sessionLabel={props.sessionLabel}
          test={props.test}
          initial={tripEdit.draft}
          expected={tripEdit.expected}
          board={board}
          routes={props.routes}
          onClose={() => setTripEdit(null)}
          onSaved={saved}
        />
      ) : null}
      {driverEdit ? (
        <DriverEditor
          key={driverEdit.key}
          sessionLabel={props.sessionLabel}
          test={props.test}
          initial={driverEdit.draft}
          trips={driverEdit.draft.id ? board.trips.filter((t) => t.driverId === driverEdit.draft.id).length : 0}
          onClose={() => setDriverEdit(null)}
          onSaved={saved}
        />
      ) : null}
    </VxPage>
  );
}

function TodoLine({ icon, text, action, onClick }: { icon: IconName; text: string; action: string; onClick: () => void }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48 }}>
      <Ic n={icon} size={18} style={{ color: "var(--warnfg)", flex: "none" }} />
      <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{text}</span>
      <Btn variant="soft" onClick={onClick}>{action}</Btn>
    </span>
  );
}

/* ----------------------------------------------------------------- Routes */

function RoutesView(props: {
  cards: RouteCard[];
  riders: Rider[];
  searching: boolean;
  filter: RouteFilter;
  setFilter: (f: RouteFilter) => void;
  board: ReturnType<typeof buildBoard>;
  fleetReady: boolean;
  onOpen: (routeId: string) => void;
  onClear: () => void;
}) {
  const { tx } = useVx();
  const noMorning = new Set(props.board.noMorning);
  const noAfternoon = new Set(props.board.noAfternoon);
  const cards = props.cards.filter((c) =>
    props.filter === "noMorning" ? noMorning.has(c.id) : props.filter === "noAfternoon" ? noAfternoon.has(c.id) : true,
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {props.fleetReady && (props.board.noMorning.length || props.board.noAfternoon.length) ? (
        <ChipRow label={tx(W.tabs.routes)}>
          <Chip on={props.filter === "all"} onClick={() => props.setFilter("all")}>{tx(W.all)}</Chip>
          <Chip on={props.filter === "noMorning"} icon="sun" count={props.board.noMorning.length} onClick={() => props.setFilter("noMorning")}>{tx(W.filterNoMorning)}</Chip>
          <Chip on={props.filter === "noAfternoon"} icon="clock" count={props.board.noAfternoon.length} onClick={() => props.setFilter("noAfternoon")}>{tx(W.filterNoAfternoon)}</Chip>
        </ChipRow>
      ) : null}

      {props.searching && props.riders.length ? (
        <Card pad={false} style={{ overflow: "hidden" }}>
          <div style={{ padding: "12px 16px 8px" }}>
            <SecHead>{tx(W.childrenFound(props.riders.length))}</SecHead>
          </div>
          {props.riders.slice(0, 30).map((rider) => {
            const card = props.board.cards.find((c) => c.id === rider.routeId);
            return (
              <button
                key={rider.id}
                type="button"
                className="row tap"
                onClick={() => props.onOpen(rider.routeId)}
                style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 60, padding: "10px 16px", width: "100%", textAlign: "left", font: "inherit", color: "var(--fg)", background: "transparent", border: 0, borderTop: "1px solid var(--bd)", cursor: "pointer" }}
              >
                <Avatar text={initialsOf(rider.name)} seed={rider.id} photo={rider.photo} size={40} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span className="clip" style={{ fontWeight: 600 }}>{rider.name}</span>
                  <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>
                    {rider.classLabel}{rider.admissionNo ? ` · ${tx(W.sr(rider.admissionNo))}` : ""}
                  </span>
                </span>
                <Pill tone="info" icon="mapPin">{card?.known ? card.name : tx(W.unnamed)}</Pill>
              </button>
            );
          })}
        </Card>
      ) : null}

      {cards.length === 0 ? (
        props.searching ? (
          <EmptyState icon="search" title={tx(W.nothingFound)} action={<Btn onClick={props.onClear}>{tx(W.clearSearch)}</Btn>} />
        ) : (
          <EmptyState icon="mapPin" title={tx(W.noChildren)} />
        )
      ) : (
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
          {cards.map((card, index) => (
            <RouteRow key={card.id} card={card} fleetReady={props.fleetReady} delay={Math.min(index * 30, 300)} onOpen={() => props.onOpen(card.id)} />
          ))}
        </div>
      )}

      {!props.searching && props.filter === "all" && props.board.quietRoutes > 0 ? (
        <span style={{ color: "var(--mut)", fontSize: 13 }}>{tx(W.quietRoutes(props.board.quietRoutes))}</span>
      ) : null}
    </div>
  );
}

function RouteRow({ card, fleetReady, delay, onOpen }: { card: RouteCard; fleetReady: boolean; delay: number; onOpen: () => void }) {
  const { tx } = useVx();
  const morning = card.visits.filter((v) => v.shift === "morning");
  const afternoon = card.visits.filter((v) => v.shift === "afternoon");
  const other = card.visits.filter((v) => v.shift === "other");
  // "Class 5 (2) · Class 8 (1)". Spaces alone collapsed in HTML and the pairs
  // ran together ("NUR · 1 Class 1 · 1"); the count in brackets matches the
  // stop counts on Bus times.
  const classes = card.classes.map((c) => `${c.label} (${c.count})`).join(" · ");
  return (
    <button type="button" className="card tap lift" onClick={onOpen} style={{ ...cardButton, animation: `xIn .32s var(--ease) ${delay}ms both` }}>
      <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <IconTile icon="mapPin" tone="info" size={44} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <strong style={{ fontSize: 17, lineHeight: 1.25 }}>{card.known ? card.name : tx(W.unnamed)}</strong>
          {classes ? <span style={TWO_LINES}>{classes}</span> : null}
        </span>
        <span style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span className="num" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{card.riders.length}</span>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.children(card.riders.length)).replace(/^\d+\s*/, "")}</span>
        </span>
        <Ic n="chevRight" size={18} style={{ color: "var(--mut)", flex: "none" }} />
      </span>
      {fleetReady ? (
        <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <VisitLine shift="morning" visits={morning} missing={W.noMorningBus} />
          <VisitLine shift="afternoon" visits={afternoon} missing={W.noAfternoonBus} />
          {other.length ? <VisitLine shift="other" visits={other} /> : null}
        </span>
      ) : null}
    </button>
  );
}

function VisitLine({ shift, visits, missing }: { shift: Shift; visits: RouteCard["visits"]; missing?: { en: string; hi?: string } }) {
  const { tx } = useVx();
  if (!visits.length) {
    if (!missing) return null;
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--warnfg)", fontWeight: 600 }}>
        <Ic n="alert" size={15} style={{ flex: "none" }} />
        <span className="clip">{tx(missing)}</span>
      </span>
    );
  }
  return (
    <span style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 14, minWidth: 0 }}>
      <Ic n={SHIFT_ICON[shift]} size={15} style={{ flex: "none", color: "var(--mut)", marginTop: 2 }} />
      {/* One line per bus, wrapping rather than cut off: two buses on one route used to share a clipped line. */}
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2, lineHeight: 1.35, overflowWrap: "anywhere" }}>
        {visits.map((v) => (
          <span key={v.tripId}>
            {`${timeText(tx, v.stopTime ?? v.startsAt)} · ${v.busName} · ${v.driver ? v.driver.name : tx(W.noDriver)}`}
          </span>
        ))}
      </span>
    </span>
  );
}

/* -------------------------------------------------------------- Bus times */

function TimesView(props: {
  trips: TripView[];
  searching: boolean;
  filter: TimeFilter;
  setFilter: (f: TimeFilter) => void;
  fleetReady: boolean;
  manage: boolean;
  onOpen: (tripId: string) => void;
  onAdd: () => void;
  onClear: () => void;
}) {
  const { tx } = useVx();
  if (!props.fleetReady) return <EmptyState icon="clock" title={tx(W.noTrips)} body={tx(W.notReady)} />;
  const trips = props.trips.filter((t) =>
    props.filter === "all" ? true : props.filter === "noDriver" ? !t.driver : t.shift === props.filter,
  );
  const shifts: Shift[] = ["morning", "afternoon", "other"];
  const count = (f: TimeFilter) => props.trips.filter((t) => (f === "noDriver" ? !t.driver : t.shift === f)).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {props.trips.length ? (
        <ChipRow label={tx(W.tabs.times)}>
          <Chip on={props.filter === "all"} onClick={() => props.setFilter("all")}>{tx(W.all)}</Chip>
          {shifts.filter((s) => count(s) > 0).map((s) => (
            <Chip key={s} on={props.filter === s} icon={SHIFT_ICON[s]} count={count(s)} onClick={() => props.setFilter(s)}>{tx(W.shift[s])}</Chip>
          ))}
          {count("noDriver") ? (
            <Chip on={props.filter === "noDriver"} icon="alert" count={count("noDriver")} onClick={() => props.setFilter("noDriver")}>{tx(W.filterNoDriver)}</Chip>
          ) : null}
        </ChipRow>
      ) : null}

      {trips.length === 0 ? (
        props.searching ? (
          <EmptyState icon="search" title={tx(W.nothingFound)} action={<Btn onClick={props.onClear}>{tx(W.clearSearch)}</Btn>} />
        ) : (
          <EmptyState
            icon="bus"
            title={tx(W.noTrips)}
            body={tx(W.noTripsBody)}
            action={props.manage ? <Btn big variant="pri" icon="plus" onClick={props.onAdd}>{tx(W.addBus)}</Btn> : undefined}
          />
        )
      ) : (
        shifts.map((shift) => {
          const list = trips.filter((t) => t.shift === shift);
          if (!list.length) return null;
          return (
            <div key={shift} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SecHead>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Ic n={SHIFT_ICON[shift]} size={14} />
                  {tx(W.shiftLong[shift])}
                </span>
              </SecHead>
              <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
                {list.map((trip, index) => (
                  <TripRow key={trip.id} trip={trip} delay={Math.min(index * 30, 300)} onOpen={() => props.onOpen(trip.id)} />
                ))}
              </div>
            </div>
          );
        })
      )}

      {props.manage && trips.length > 0 ? (
        <Btn big full icon="plus" onClick={props.onAdd}>{tx(W.addBus)}</Btn>
      ) : null}
    </div>
  );
}

function TripRow({ trip, delay, onOpen }: { trip: TripView; delay: number; onOpen: () => void }) {
  const { tx } = useVx();
  return (
    <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, animation: `xIn .32s var(--ease) ${delay}ms both`, minWidth: 0 }}>
      <button type="button" className="tap" onClick={onOpen} style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <span style={{ flex: "none", minWidth: 76, padding: "8px 10px", borderRadius: 14, background: "var(--infos)", color: "var(--info)", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span className="num" style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.1 }}>{timeText(tx, trip.startsAt)}</span>
        </span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <strong className="clip" style={{ fontSize: 17 }}>
            {trip.busName}
            {trip.vehicleNo ? <span style={{ fontWeight: 500, color: "var(--mut)", fontSize: 14 }}> · {trip.vehicleNo}</span> : null}
          </strong>
          <span className="clip" style={{ fontSize: 14, color: "var(--mut)" }}>{tx(W.busCarries(trip.riders))}</span>
        </span>
        <Ic n="chevRight" size={18} style={{ color: "var(--mut)", flex: "none" }} />
      </button>

      <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <Avatar text={trip.driver ? initialsOf(trip.driver.name) : "?"} seed={trip.driver?.id ?? trip.id} size={36} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.driver)}</span>
          <span className="clip" style={{ fontWeight: 600, color: trip.driver ? undefined : "var(--warnfg)" }}>
            {trip.driver ? trip.driver.name : tx(W.noDriver)}
          </span>
        </span>
        {trip.driver?.phone ? <CallLink phone={trip.driver.phone} name={trip.driver.name} /> : null}
      </span>

      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {trip.stopViews.map((stop, i) => (
          <li key={stop.routeId} className="pill" style={{ background: "var(--s2)", color: "var(--fg)", maxWidth: "100%" }}>
            <span className="num" style={{ fontWeight: 700, color: "var(--mut)" }}>{i + 1}</span>
            <span className="clip">{stop.known ? stop.name : tx(W.unnamed)}</span>
            {stop.stopTime ? <span style={{ color: "var(--mut)" }}>{timeText(tx, stop.stopTime)}</span> : null}
            <span className="num" style={{ fontWeight: 700 }}>({stop.riders})</span>
          </li>
        ))}
      </ol>

      <Btn variant="soft" icon="users" onClick={onOpen}>{tx(W.seeChildren)}</Btn>
    </div>
  );
}

/* ---------------------------------------------------------------- Drivers */

function DriversView(props: {
  drivers: DriverView[];
  searching: boolean;
  fleetReady: boolean;
  manage: boolean;
  onAdd: () => void;
  onChange: (driver: Driver) => void;
  onOpenTrip: (tripId: string) => void;
  onClear: () => void;
}) {
  const { tx } = useVx();
  if (!props.fleetReady) return <EmptyState icon="user" title={tx(W.noDrivers)} body={tx(W.notReady)} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {props.drivers.length === 0 ? (
        props.searching ? (
          <EmptyState icon="search" title={tx(W.nothingFound)} action={<Btn onClick={props.onClear}>{tx(W.clearSearch)}</Btn>} />
        ) : (
          <EmptyState
            icon="user"
            title={tx(W.noDrivers)}
            body={tx(W.noDriversBody)}
            action={props.manage ? <Btn big variant="pri" icon="plus" onClick={props.onAdd}>{tx(W.addDriver)}</Btn> : undefined}
          />
        )
      ) : (
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
          {props.drivers.map((driver, index) => (
            <div key={driver.id} className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0, animation: `xIn .32s var(--ease) ${Math.min(index * 30, 300)}ms both` }}>
              <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <Avatar text={initialsOf(driver.name)} seed={driver.id} size={44} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <strong className="clip" style={{ fontSize: 17 }}>{driver.name}</strong>
                  <span className="clip num" style={{ fontSize: 14, color: "var(--mut)" }}>{driver.phone ? phoneText(driver.phone) : tx(W.noPhone)}</span>
                </span>
                {driver.phone ? <CallLink phone={driver.phone} name={driver.name} /> : null}
              </span>
              {driver.notes ? <span style={{ fontSize: 14, color: "var(--mut)", whiteSpace: "pre-line" }}>{driver.notes}</span> : null}
              <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)", textTransform: "uppercase", letterSpacing: ".06em" }}>{tx(W.drives)}</span>
                {driver.trips.length === 0 ? (
                  <span style={{ color: "var(--warnfg)", fontWeight: 600, fontSize: 14 }}>{tx(W.noBusForDriver)}</span>
                ) : (
                  driver.trips.map((trip) => (
                    <button key={trip.id} type="button" className="tap" onClick={() => props.onOpenTrip(trip.id)} style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, minHeight: 40, minWidth: 0 }}>
                      <Ic n={SHIFT_ICON[trip.shift]} size={16} style={{ flex: "none", color: "var(--mut)" }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.35, overflowWrap: "anywhere", padding: "4px 0" }}>
                        <strong>{timeText(tx, trip.startsAt)}</strong> · {trip.busName} · {trip.stopViews.map((s) => (s.known ? s.name : tx(W.unnamed))).join(", ")}
                      </span>
                      <Ic n="chevRight" size={16} style={{ flex: "none", color: "var(--mut)" }} />
                    </button>
                  ))
                )}
              </span>
              {props.manage ? (
                <Btn variant="soft" icon="edit" onClick={() => props.onChange(driver)}>{tx(W.edit)}</Btn>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {props.manage && props.drivers.length > 0 ? (
        <Btn big full icon="plus" onClick={props.onAdd}>{tx(W.addDriver)}</Btn>
      ) : null}
    </div>
  );
}
