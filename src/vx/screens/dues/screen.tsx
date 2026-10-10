"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  filterFamilies,
  hasCallFilters,
  NO_CALL_FILTERS,
  type CallFilters,
  type ClassBand,
  type DuesFamily,
} from "@/modules/defaulters/vx/domain/families";
import { ago, dayMonth, initials, rupees, rupeesShort } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import { Chip, ChipRow, SearchBox, Seg } from "@/vx/ui/controls";
import { Banner, DataList, Grid, Section, Split, TopBar, VxPage, type Column } from "@/vx/ui/page";
import { Avatar, avatarColor, Btn, Card, EmptyState, Kpi, ListRow, Money, Pill, Progress, Ring, SecHead } from "@/vx/ui/primitives";

import { FamilyPanel } from "./family-panel";
import { duesHref } from "./href";
import type { DuesProps, DuesTab, LeftView, PromiseView } from "./types";
import { LOG_OUTCOME_WORD, W } from "./words";
import { WriteOffSheet } from "./write-off-sheet";


const STATUS_WORD: Record<string, { en: string; hi?: string }> = { left: W.status_left, graduated: W.status_graduated, inactive: W.status_inactive };

const BANDS: { value: ClassBand; pair: { en: string; hi?: string } }[] = [
  { value: "pre", pair: W.bandPre },
  { value: "p", pair: W.bandP },
  { value: "m", pair: W.bandM },
  { value: "s", pair: W.bandS },
];

function PromiseGroup({ title, sub, rows, tab }: { title: string; sub?: string; rows: PromiseView[]; tab: DuesTab }) {
  const { tx } = useVx();
  if (rows.length === 0) return null;
  const tone = { kept: "ok", due: "warn", broken: "bad", upcoming: "info" } as const;
  const word = { kept: W.kept, due: W.due, broken: W.broken, upcoming: W.upcoming };
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <SecHead>
        {title}
        {sub ? <span style={{ fontWeight: 500, color: "var(--mut)", textTransform: "none", letterSpacing: 0 }}> · {sub}</span> : null}
      </SecHead>
      <Card pad={false} style={{ overflow: "hidden" }}>
        {rows.map((pv, i) => (
          <ListRow
            key={pv.id}
            delay={i * 20}
            style={i === 0 ? { borderTop: 0 } : undefined}
            href={duesHref(tab, { family: pv.familyKey })}
            lead={<Avatar text={initials(pv.fatherName)} bg={avatarColor(pv.fatherName)} size={38} />}
            title={pv.fatherName}
            sub={`${pv.kidsLine} · ${dayMonth(pv.promisedOn)}${pv.by ? ` · ${pv.by}` : ""}`}
            trail={
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                {pv.kind === "visit" ? <Pill tone="info">{tx(W.visit)}</Pill> : <Money value={pv.amount} style={{ fontWeight: 700 }} />}
                <Pill tone={tone[pv.state]}>
                  {tx(word[pv.state])}
                  {pv.state === "kept" && pv.receiptNumber ? ` · ${pv.receiptNumber}` : pv.paid > 0 && pv.state !== "kept" ? ` · ${rupees(pv.paid)} ${tx(W.paidReceipt)}` : ""}
                </Pill>
              </span>
            }
          />
        ))}
      </Card>
    </section>
  );
}

export function DuesScreen(props: DuesProps) {
  const { tab, families, metrics, selected, today } = props;
  const { tx } = useVx();
  const router = useRouter();
  const [filters, setFilters] = useState<CallFilters>(NO_CALL_FILTERS);
  const shown = useMemo(() => filterFamilies(families, filters), [families, filters]);

  const familyColumns: Column<DuesFamily>[] = [
    {
      key: "fam",
      label: tx(W.family),
      width: "minmax(0,1.3fr)",
      cell: (f) => (
        <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span className="only-d"><Avatar text={initials(f.fatherName)} bg={avatarColor(f.fatherName)} size={34} /></span>
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span className="clip" style={{ fontWeight: 600 }}>{f.fatherName}</span>
            <span className="clip only-d num" style={{ fontSize: 12, color: "var(--mut)" }}>{f.phone ?? "—"}</span>
          </span>
        </span>
      ),
    },
    { key: "kids", label: tx(W.children), width: "minmax(0,1.6fr)", cell: (f) => <span className="clip">{f.kids.map((k) => `${k.fullName.split(" ")[0]} · ${k.classLabel}`).join(", ")}</span> },
    {
      key: "days",
      label: tx(W.overdue),
      width: "100px",
      cell: (f) => <Pill tone={f.days > 90 ? "bad" : f.days > 30 ? "warn" : "mut"}>{f.days} {tx(W.days)}</Pill>,
    },
    {
      key: "last",
      label: tx(W.lastContact),
      width: "minmax(0,1fr)",
      hideOnPhone: true,
      cell: (f) =>
        f.lastContact?.lastContactedAt ? (
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span>{ago(f.lastContact.lastContactedAt)}</span>
            {f.lastContact.lastOutcome ? <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(LOG_OUTCOME_WORD[f.lastContact.lastOutcome] ?? W.never)}</span> : null}
          </span>
        ) : (
          <span style={{ color: "var(--mut)" }}>{tx(W.never)}</span>
        ),
    },
    {
      key: "pending",
      label: tx(W.pendingToday),
      width: "130px",
      align: "right",
      cell: (f) => (
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <Money value={f.pendingToday} style={{ fontWeight: 700 }} />
          {f.lateFee > 0 ? <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx(W.lateFee)} {rupees(f.lateFee)} {tx(W.lateApart)}</span> : null}
        </span>
      ),
    },
  ];

  const tabs = (
    <Seg<DuesTab>
      label={tx(W.title)}
      value={tab}
      onChange={(v) => router.push(duesHref(v))}
      options={[
        { value: "call", label: `${tx(W.tabCall)} · ${families.length}` },
        { value: "prom", label: tx(W.tabProm) },
        { value: "left", label: `${tx(W.tabLeft)} · ${props.left.length}` },
        { value: "aging", label: tx(W.tabAging) },
      ]}
    />
  );

  const promToday = props.promises.filter((pv) => pv.promisedOn === today);
  const promBroken = props.promises.filter((pv) => pv.state === "broken");
  const promUpcoming = props.promises.filter((pv) => pv.state === "upcoming" && pv.promisedOn !== today);
  const promKept = props.promises.filter((pv) => pv.state === "kept" && pv.promisedOn !== today);
  const agingMax = Math.max(1, ...props.aging.buckets.map((b) => b.amount));

  const list = (
    <div className={selected ? "hide-m" : undefined} style={{ minWidth: 0 }}>
      <Section gap={16}>
        <Grid cols={4}>
          <Kpi label={tx(W.pendingToday)} value={rupees(metrics.pendingToday)} sub={`${metrics.students} ${tx(W.students)} · ${rupeesShort(metrics.notDueYet)} ${tx(W.notDueYet).toLowerCase()}`} icon="rupee" tone="var(--bad)" />
          <Kpi label={tx(W.promisesToday)} value={metrics.promisesToday} sub={`${metrics.promisesKeptToday} ${tx(W.keptSoFar)}`} href={duesHref("prom")} delay={40} icon="flag" />
          <div className="card rise" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, animationDelay: "80ms", minWidth: 0 }}>
            <Ring value={metrics.callsToday} max={Math.max(metrics.callsToday, families.length, 1)} size={56} stroke={7}>
              <span className="num" style={{ fontWeight: 700 }}>{metrics.callsToday}</span>
            </Ring>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 13, color: "var(--mut)", fontWeight: 600 }}>{tx(W.callsToday)}</span>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{families.length} {tx(W.families)}</span>
            </span>
          </div>
          <Kpi label={tx(W.collectedWeek)} value={rupees(metrics.collectedWeek)} sub={tx(W.allReceipts)} delay={120} />
        </Grid>

        <div style={{ overflowX: "auto" }}>{tabs}</div>

        {tab === "call" ? (
          <>
            <SearchBox value={filters.query} onChange={(query) => setFilters((f) => ({ ...f, query }))} placeholder={tx(W.search)} />
            <ChipRow label={tx(W.cls)}>
              {BANDS.map((b) => (
                <Chip key={b.value} on={filters.band === b.value} onClick={() => setFilters((f) => ({ ...f, band: f.band === b.value ? "" : b.value }))}>{tx(b.pair)}</Chip>
              ))}
              <Chip on={filters.inst === "i2"} onClick={() => setFilters((f) => ({ ...f, inst: f.inst === "i2" ? "" : "i2" }))}>{tx(W.inst2Only)}</Chip>
              <Chip on={filters.inst === "i12"} onClick={() => setFilters((f) => ({ ...f, inst: f.inst === "i12" ? "" : "i12" }))}>{tx(W.inst12)}</Chip>
              <Chip on={filters.big} onClick={() => setFilters((f) => ({ ...f, big: !f.big }))}>{tx(W.over5k)}</Chip>
              <Chip on={filters.bus} icon="bus" onClick={() => setFilters((f) => ({ ...f, bus: !f.bus }))}>{tx(W.usesBus)}</Chip>
            </ChipRow>
            {props.lateFeeOnly.count > 0 ? (
              <Banner tone="info">
                {props.lateFeeOnly.count} {tx(W.families)} {tx(W.lateOnlyNote)}
              </Banner>
            ) : null}
            {families.length === 0 ? (
              <Card><EmptyState icon="checkCircle" title={tx(W.nobody)} body={tx(W.nobodyBody)} /></Card>
            ) : shown.length === 0 ? (
              <Card>
                <EmptyState icon="search" title={tx(W.noMatch)} body={tx(W.noMatchBody)} action={hasCallFilters(filters) ? <Btn onClick={() => setFilters(NO_CALL_FILTERS)}>{tx(W.clearFilters)}</Btn> : undefined} />
              </Card>
            ) : (
              <Card pad={false} style={{ overflow: "hidden" }}>
                <DataList rows={shown} columns={familyColumns} rowKey={(f) => f.key} caption={tx(W.tabCall)} selected={(f) => f.key === selected?.key} href={(f) => duesHref("call", { family: f.key })} />
              </Card>
            )}
          </>
        ) : null}

        {tab === "prom" ? (
          props.promises.length === 0 ? (
            <Card><EmptyState icon="flag" title={tx(W.noPromises)} body={tx(W.noPromisesBody)} /></Card>
          ) : (
            <>
              <PromiseGroup tab="prom" title={tx(W.pToday)} sub={`${promToday.filter((x) => x.state === "kept").length} ${tx(W.keptSoFar)}`} rows={promToday} />
              <PromiseGroup tab="prom" title={tx(W.pBroken)} sub={tx(W.pBrokenSub)} rows={promBroken} />
              <PromiseGroup tab="prom" title={tx(W.pUpcoming)} sub={tx(W.pUpcomingSub)} rows={promUpcoming} />
              <PromiseGroup tab="prom" title={tx(W.pKept)} rows={promKept} />
            </>
          )
        ) : null}

        {tab === "left" ? (
          <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <SecHead>
              {tx(W.leftTitle)}
              <span style={{ fontWeight: 500, color: "var(--mut)", textTransform: "none", letterSpacing: 0 }}> · {tx(W.leftSub)}</span>
            </SecHead>
            {props.left.length === 0 ? (
              <Card><EmptyState icon="door" title={tx(W.noLeft)} body={tx(W.noLeftBody)} /></Card>
            ) : (
              <Card pad={false} style={{ overflow: "hidden" }}>
                {props.left.map((l: LeftView, i) => (
                  <ListRow
                    key={l.studentId}
                    delay={i * 20}
                    style={i === 0 ? { borderTop: 0 } : undefined}
                    lead={<Avatar text={initials(l.fullName)} bg={avatarColor(l.fullName)} size={38} />}
                    title={l.fullName}
                    sub={`${l.classLabel ?? "—"} · ${tx(STATUS_WORD[l.status] ?? W.status_left)}${l.lastPaymentDate ? ` · ${tx(W.lastPaid)} ${dayMonth(l.lastPaymentDate)}` : ""}${l.phone ? ` · ${l.phone}` : ""}`}
                    trail={
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                        <Money value={l.owed} style={{ fontWeight: 700 }} />
                        {l.writeOff?.status === "pending" ? (
                          <Pill tone="warn">{tx(W.woPending)} · {rupees(l.writeOff.amount)}</Pill>
                        ) : props.perms.log ? (
                          <Btn variant="ghost" href={duesHref("left", { wo: l.studentId, sheet: "wo" })} style={{ height: 30, fontSize: 12 }}>{tx(W.requestWriteOff)}</Btn>
                        ) : null}
                      </span>
                    }
                  />
                ))}
              </Card>
            )}
          </section>
        ) : null}

        {tab === "aging" ? (
          <>
            <SecHead>{tx(W.howLate)}</SecHead>
            <Grid cols={4}>
              {props.aging.buckets.map((b) => (
                <Card key={b.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 13, color: "var(--mut)", fontWeight: 600 }}>{b.key} {tx(W.days)}</span>
                  <Money value={b.amount} style={{ fontSize: 22, fontWeight: 700 }} />
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{b.students} {tx(W.students)}</span>
                  <Progress value={b.amount} max={agingMax} tone={b.key === "90+" ? "var(--bad)" : b.key === "61-90" ? "var(--warn)" : "var(--acc)"} />
                </Card>
              ))}
            </Grid>
            <SecHead>{tx(W.top10)}</SecHead>
            <Card pad={false} style={{ overflow: "hidden" }}>
              {props.aging.top.map((f, i) => (
                <ListRow
                  key={f.key}
                  style={i === 0 ? { borderTop: 0 } : undefined}
                  href={duesHref("aging", { family: f.key })}
                  lead={<span className="num" style={{ width: 22, textAlign: "center", color: "var(--mut)", fontWeight: 700 }}>{i + 1}</span>}
                  title={f.fatherName}
                  sub={`${f.kids.map((k) => k.classLabel).join(", ")} · ${f.days} ${tx(W.days)}`}
                  trail={<Money value={f.pendingToday} style={{ fontWeight: 700 }} />}
                />
              ))}
            </Card>
            <SecHead>{tx(W.classByInst)}</SecHead>
            <Card pad={false} style={{ overflow: "hidden" }}>
              <DataList
                rows={props.aging.classByInst}
                rowKey={(r) => r.classLabel}
                caption={tx(W.classByInst)}
                columns={[
                  { key: "c", label: tx(W.cls), width: "minmax(0,1.4fr)", cell: (r) => <strong>{r.classLabel}</strong> },
                  { key: "1", label: tx(W.inst1), align: "right", cell: (r) => <span className="num">{r.inst1 ? rupees(r.inst1) : "—"}</span> },
                  { key: "2", label: tx(W.inst2), align: "right", cell: (r) => <span className="num">{r.inst2 ? rupees(r.inst2) : "—"}</span> },
                  { key: "ly", label: tx(W.lastYear), align: "right", cell: (r) => <span className="num">{r.lastYear ? rupees(r.lastYear) : "—"}</span> },
                  { key: "t", label: tx(W.total), align: "right", cell: (r) => <Money value={r.total} style={{ fontWeight: 700 }} /> },
                ]}
              />
            </Card>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.classByInstNote)}</span>
          </>
        ) : null}
      </Section>
    </div>
  );

  return (
    <VxPage>
      <TopBar
        crumb={<Bi {...W.crumb} block={false} />}
        title={tx(W.title)}
        mTitle={selected ? selected.fatherName : tx(W.title)}
        mSub={selected ? `${rupees(selected.pendingToday)} · ${tx(W.pendingToday)}` : `${families.length} ${tx(W.families)}`}
        mBack={selected ? duesHref(tab) : undefined}
      />
      <main>
        <Split list={list} detail={selected ? <FamilyPanel {...props} family={selected} /> : undefined} detailWidth={440} />
      </main>
      {props.writeOffFor ? <WriteOffSheet key={props.writeOffFor.studentId} row={props.writeOffFor} sessionLabel={props.sessionLabel} open={props.sheet === "wo"} /> : null}
    </VxPage>
  );
}
