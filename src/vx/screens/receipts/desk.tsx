"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  deskModeOf,
  DESK_MODES,
  filterReceipts,
  groupByDay,
  NO_DESK_FILTERS,
  postedAfterClose,
  summarizeReceipts,
  type DaySpan,
  type DeskFilters,
  type DeskMode,
} from "@/modules/receipts/vx/domain/day-close";
import { clock, rupees, shortDay } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import { Chip, ChipRow, SearchBox, Seg } from "@/vx/ui/controls";
import { Banner, DataList, Grid, Section, Split, TopBar, VxPage, type Column } from "@/vx/ui/page";
import { Btn, Card, EmptyState, Kpi, Money, Pill, SecHead, StackedBar } from "@/vx/ui/primitives";

import { ClosePanel } from "./close-panel";
import { deskHref } from "./href";
import { ReceiptPanel } from "./receipt-panel";
import type { DeskProps, DeskRow } from "./types";
import { MODE_WORD, W } from "./words";

const MODE_COLOR: Record<Exclude<DeskMode, "other">, string> = {
  cash: "var(--acc)",
  upi: "var(--pri)",
  cheque: "var(--warn)",
  bank: "var(--info)",
};

function initialFilters(i: DeskProps["initial"]): DeskFilters {
  const mode = (DESK_MODES as readonly string[]).includes(i.mode) ? (i.mode as DeskMode) : "all";
  return { mode, staff: i.staff || "all", query: i.query };
}

export function ReceiptsDesk(props: DeskProps) {
  const { rows, anchor, today, span, view, selected, closeEvent, perms } = props;
  const { tx } = useVx();
  const router = useRouter();
  const [filters, setFilters] = useState<DeskFilters>(() => initialFilters(props.initial));

  const summary = useMemo(() => summarizeReceipts(rows), [rows]);
  const shown = useMemo(() => filterReceipts(rows, filters), [rows, filters]);
  const groups = useMemo(() => groupByDay(shown), [shown]);
  const staffNames = useMemo(() => [...new Set(rows.map((r) => r.receivedBy).filter((s): s is string => Boolean(s)))].sort(), [rows]);
  const late = useMemo(() => postedAfterClose(rows.filter((r) => r.paymentDate === anchor), closeEvent?.createdAt ?? null), [rows, anchor, closeEvent]);

  const base = { anchor, today, span };
  const spanLabel = span === "today" ? (anchor === today ? tx(W.today) : shortDay(anchor)) : span === "yesterday" ? tx(W.yesterday) : tx(W.last3);
  const closeHref = deskHref(base, { view: "close" });

  const columns: Column<DeskRow>[] = [
    {
      key: "no",
      label: tx(W.receipt),
      width: "120px",
      hideOnPhone: true,
      cell: (r) => <span className="num" style={{ fontWeight: 600 }}>{r.receiptNumber}</span>,
    },
    { key: "time", label: tx(W.time), width: "64px", hideOnPhone: true, cell: (r) => <span className="num" style={{ color: "var(--mut)" }}>{clock(r.createdAt)}</span> },
    {
      key: "student",
      label: tx(W.student),
      width: "minmax(0,2fr)",
      cell: (r) => (
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span className="clip" style={{ fontWeight: 600, textDecoration: r.isReversed ? "line-through" : undefined }}>{r.studentFullName}</span>
          <span className="clip only-d" style={{ fontSize: 12, color: "var(--mut)" }}>{r.classLabel} · {r.admissionNo}</span>
        </span>
      ),
    },
    {
      key: "mode",
      label: tx(W.mode),
      width: "110px",
      cell: (r) => (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="only-m num" style={{ color: "var(--mut)" }}>{r.receiptNumber} · {clock(r.createdAt)} ·</span>
          <Pill tone={r.isReversed ? "bad" : "mut"}>{r.isReversed ? tx(W.reversed) : tx(MODE_WORD[deskModeOf(r.paymentMode)])}</Pill>
        </span>
      ),
    },
    { key: "by", label: tx(W.takenBy), width: "minmax(0,1fr)", cell: (r) => <span className="clip">{r.receivedBy ?? "—"}</span> },
    {
      key: "amt",
      label: tx(W.amount),
      width: "110px",
      align: "right",
      cell: (r) => <Money value={r.totalAmount} style={{ fontWeight: 700, textDecoration: r.isReversed ? "line-through" : undefined, color: r.isReversed ? "var(--mut)" : undefined }} />,
    },
  ];

  const list = (
    <div className={selected || view === "close" ? "hide-m" : undefined} style={{ minWidth: 0 }}>
      <Section gap={16}>
        <Grid cols={4}>
          <Kpi label={span === "today" && anchor === today ? tx(W.collectedToday) : `${tx(W.collected)} · ${spanLabel}`} value={rupees(summary.net)} sub={`${summary.count} ${tx(W.receipts).toLowerCase()}`} icon="rupee" />
          <Kpi label={tx(W.cash)} value={rupees(summary.byMode.cash.amount)} sub={`${summary.byMode.cash.count} · ${tx(W.toCount)}`} delay={40} />
          <Kpi label={tx(W.upi)} value={rupees(summary.byMode.upi.amount)} sub={`${summary.byMode.upi.count} ${tx(W.receipts).toLowerCase()}`} delay={80} />
          <Kpi label={tx(W.reversed)} value={summary.reversedCount} sub={tx(W.reversedSub)} tone={summary.reversedCount ? "var(--bad)" : undefined} delay={120} />
        </Grid>

        {summary.net > 0 ? (
          <Card>
            <SecHead>{tx(W.howItCameIn)}</SecHead>
            <StackedBar parts={DESK_MODES.filter((m) => summary.byMode[m].amount > 0).map((m) => ({ label: tx(MODE_WORD[m]), value: summary.byMode[m].amount, color: MODE_COLOR[m] }))} />
          </Card>
        ) : null}

        {closeEvent ? (
          <Banner tone="ok" action={<Btn variant="ghost" href={closeHref}>{tx(W.seeClose)}</Btn>}>
            {tx(W.dayClosed)} · {shortDay(anchor)} · {clock(closeEvent.createdAt)}
            {closeEvent.actorName ? ` · ${closeEvent.actorName}` : ""}
          </Banner>
        ) : null}
        {late.length > 0 ? (
          <Banner tone="warn">
            {late.length} {tx(W.receipts).toLowerCase()} {tx(W.afterClose)}: {late.map((r) => r.receiptNumber).join(", ")}
          </Banner>
        ) : null}
        {props.truncated ? <Banner tone="info">{tx(W.truncated)}</Banner> : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <Seg<DaySpan>
            label={tx(W.title)}
            value={span}
            onChange={(v) => router.push(deskHref({ ...base, span: v }, {}))}
            options={[
              { value: "today", label: anchor === today ? tx(W.today) : shortDay(anchor) },
              { value: "yesterday", label: tx(W.yesterday) },
              { value: "3d", label: tx(W.last3) },
            ]}
          />
          <SearchBox value={filters.query} onChange={(query) => setFilters((f) => ({ ...f, query }))} placeholder={tx(W.search)} style={{ flex: 1, minWidth: 200 }} />
        </div>
        <ChipRow label={tx(W.mode)}>
          <Chip on={filters.mode === "all"} onClick={() => setFilters((f) => ({ ...f, mode: "all" }))}>{tx(W.allModes)}</Chip>
          {DESK_MODES.map((m) => (
            <Chip key={m} on={filters.mode === m} count={summary.byMode[m].count || undefined} onClick={() => setFilters((f) => ({ ...f, mode: f.mode === m ? "all" : m }))}>
              {tx(MODE_WORD[m])}
            </Chip>
          ))}
        </ChipRow>
        {staffNames.length > 1 ? (
          <ChipRow label={tx(W.takenBy)}>
            <Chip on={filters.staff === "all"} onClick={() => setFilters((f) => ({ ...f, staff: "all" }))}>{tx(W.everyone)}</Chip>
            {staffNames.map((s) => (
              <Chip key={s} on={filters.staff === s} onClick={() => setFilters((f) => ({ ...f, staff: f.staff === s ? "all" : s }))}>{s}</Chip>
            ))}
          </ChipRow>
        ) : null}

        {rows.length === 0 ? (
          <Card>
            <EmptyState
              icon="receipt"
              title={tx(W.emptyDay)}
              body={tx(W.emptyDayBody)}
              action={
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  {props.lastDate ? <Btn variant="sec" icon="history" href={deskHref({ ...base, anchor: props.lastDate, span: "today" }, {})}>{tx(W.lastDay)} · {shortDay(props.lastDate)}</Btn> : null}
                  {perms.collect ? <Btn variant="pri" icon="rupee" href="/payments">{tx(W.takeFee)}</Btn> : null}
                </div>
              }
            />
          </Card>
        ) : shown.length === 0 ? (
          <Card>
            <EmptyState icon="search" title={tx(W.noMatch)} body={tx(W.noMatchBody)} action={<Btn variant="sec" onClick={() => setFilters(NO_DESK_FILTERS)}>{tx(W.clearFilters)}</Btn>} />
          </Card>
        ) : (
          groups.map((g) => (
            <section key={g.date} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <SecHead action={<Money value={g.net} style={{ fontWeight: 700 }} />}>
                {shortDay(g.date)} · {g.receipts.length} {tx(W.receipts).toLowerCase()}
              </SecHead>
              <Card pad={false} style={{ overflow: "hidden" }}>
                <DataList
                  rows={g.receipts}
                  columns={columns}
                  rowKey={(r) => r.id}
                  caption={tx(W.title)}
                  selected={(r) => r.receiptNumber === selected?.receiptNumber}
                  href={(r) => deskHref(base, {}, `/receipts/${encodeURIComponent(r.receiptNumber)}`)}
                />
              </Card>
            </section>
          ))
        )}
      </Section>
    </div>
  );

  const detail =
    view === "close" ? (
      <ClosePanel {...props} />
    ) : selected ? (
      <ReceiptPanel {...props} receipt={selected} />
    ) : undefined;

  return (
    <VxPage>
      <TopBar
        crumb={<Bi {...W.crumb} block={false} />}
        title={tx(W.title)}
        mTitle={view === "close" ? tx(W.closeTitle) : selected ? selected.receiptNumber : tx(W.title)}
        mSub={selected ? selected.studentFullName : spanLabel}
        mBack={selected || view === "close" ? deskHref(base, {}) : undefined}
        actions={
          perms.accounts && view !== "close" ? (
            <Btn variant="pri" icon="lock" href={closeHref}>{closeEvent ? tx(W.dayClosed) : tx(W.closeDay)}</Btn>
          ) : null
        }
        mAction={perms.accounts && !selected && view !== "close" ? <Btn variant="ghost" icon="lock" href={closeHref} ariaLabel={tx(W.closeDay)} /> : null}
      />
      <main>
        <Split list={list} detail={detail} detailWidth={460} />
      </main>
    </VxPage>
  );
}
