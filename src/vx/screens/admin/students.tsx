"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { initials, rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { ChipRow, SearchBox, Select } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { IntentLink } from "@/vx/ui/intent-link";
import { DataList, Section, TopBar, type Column } from "@/vx/ui/page";
import { Avatar, Btn, Card, EmptyState } from "@/vx/ui/primitives";
import { mobileOf, studentsHref, toCsv, type StudentSegment } from "@/vx/screens/admin/logic";
import { T } from "@/vx/screens/admin/text";

/*
 * Students (design F05/D01). The URL is the state — search, class, chip and
 * page are all query parameters, as the directory always was, so Back and a
 * pasted link keep working. Money columns appear only for `fees:view`.
 */

export type StudentListRow = {
  id: string;
  name: string;
  sr: string | null;
  classLabel: string;
  rollNo: string | null;
  route: string | null;
  parent: string | null;
  phone: string | null;
  money: { pendingToday: number; notDueYet: number; lateFee: number; percent: number } | null;
};

export type StudentsProps = {
  session: string;
  rows: StudentListRow[];
  total: number;
  window: { page: number; pages: number; firstRow: number; lastRow: number };
  q: string;
  classId: string | null;
  seg: StudentSegment;
  classes: { id: string; label: string }[];
  counts: Partial<Record<StudentSegment, number | null>> | null;
  seesMoney: boolean;
  canCollect: boolean;
  canAdmit: boolean;
  canRemind: boolean;
  failed: boolean;
};

const SEGS: { key: StudentSegment; label: keyof typeof T }[] = [
  { key: "all", label: "segAll" },
  { key: "pending", label: "segPending" },
  { key: "bus", label: "segBus" },
  { key: "new", label: "segNew" },
  { key: "paid", label: "segPaid" },
];

export function StudentsScreen(props: StudentsProps) {
  const { tx } = useVx();
  const toast = useToast();
  const form = useRef<HTMLFormElement>(null);
  const [q, setQ] = useState(props.q);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const filtered = props.q !== "" || props.classId !== null || props.seg !== "all";

  const toggle = (id: string) =>
    setPicked((all) => {
      const copy = new Set(all);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });
  const allOn = props.rows.length > 0 && props.rows.every((row) => picked.has(row.id));

  const exportRows = (rows: StudentListRow[]) => {
    const header = ["Name", "SR", "Class", "Roll", "Route", "Phone", ...(props.seesMoney ? ["Pending today", "Not due yet", "Late fee", "Year paid %"] : [])];
    const body = rows.map((row) => [
      row.name,
      row.sr,
      row.classLabel,
      row.rollNo,
      row.route,
      row.phone,
      ...(props.seesMoney && row.money ? [row.money.pendingToday, row.money.notDueYet, row.money.lateFee, row.money.percent] : []),
    ]);
    const blob = new Blob([`﻿${toCsv(header, body)}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `students-${props.session}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.show({ text: tx(T.exported(rows.length)), tone: "ok" });
  };

  const name: Column<StudentListRow> = {
    key: "name",
    label: (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
        <input
          type="checkbox"
          checked={allOn}
          onChange={() => setPicked(allOn ? new Set() : new Set(props.rows.map((row) => row.id)))}
          aria-label={tx(T.selectAll)}
          style={{ width: 18, height: 18, accentColor: "var(--pri)" }}
        />
        {tx(T.colStudent)}
      </span>
    ),
    width: "minmax(220px,2.2fr)",
    cell: (row) => (
      <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <input
          type="checkbox"
          checked={picked.has(row.id)}
          onChange={() => toggle(row.id)}
          aria-label={tx(T.selectRow(row.name))}
          style={{ width: 18, height: 18, flex: "none", accentColor: "var(--pri)" }}
        />
        <Avatar text={initials(row.name)} seed={row.name} size={36} />
        <IntentLink href={`/students/${row.id}`} className="tap" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span className="clip" style={{ fontWeight: 600 }}>{row.name}</span>
          <span className="clip only-d" style={{ fontSize: 12.5, color: "var(--mut)", fontWeight: 400 }}>
            {[row.sr ? `SR ${row.sr}` : null, row.parent].filter(Boolean).join(" · ") || "—"}
          </span>
        </IntentLink>
      </span>
    ),
  };

  const columns: Column<StudentListRow>[] = [
    name,
    { key: "class", label: tx(T.colClass), width: "minmax(110px,1fr)", cell: (row) => `${row.classLabel}${row.rollNo ? ` · ${tx(T.colRoll)} ${row.rollNo}` : ""}` },
    ...(props.seesMoney
      ? ([
          { key: "route", label: tx(T.colRoute), width: "minmax(90px,.8fr)", hideOnPhone: true, cell: (row) => row.route || "—" },
          {
            key: "pending",
            label: tx(T.colPending),
            width: "minmax(100px,.9fr)",
            align: "right",
            cell: (row) => (row.money && row.money.pendingToday > 0 ? <strong className="num" style={{ color: "var(--bad)" }}>{rupees(row.money.pendingToday)}</strong> : <span style={{ color: "var(--mut)" }}>—</span>),
          },
          {
            key: "notdue",
            label: tx(T.colNotDue),
            width: "minmax(100px,.9fr)",
            align: "right",
            hideOnPhone: true,
            cell: (row) => (row.money && row.money.notDueYet > 0 ? <span className="num">{rupees(row.money.notDueYet)}</span> : <span style={{ color: "var(--mut)" }}>—</span>),
          },
          {
            key: "paid",
            label: tx(T.colYearPaid),
            width: "minmax(130px,1fr)",
            hideOnPhone: true,
            cell: (row) =>
              row.money ? (
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--s3)", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${row.money.percent}%`, background: row.money.percent >= 100 ? "var(--ok)" : row.money.pendingToday > 0 ? "var(--warn)" : "var(--pri)" }} />
                  </span>
                  <span className="num" style={{ fontSize: 13, fontWeight: 600, width: 38, textAlign: "right" }}>{row.money.percent}%</span>
                </span>
              ) : (
                "—"
              ),
          },
        ] satisfies Column<StudentListRow>[])
      : ([
          { key: "parent", label: tx(T.colParent), width: "minmax(120px,1fr)", hideOnPhone: true, cell: (row) => row.parent ?? "—" },
          { key: "phone", label: tx(T.colPhone), width: "minmax(110px,.8fr)", cell: (row) => row.phone ?? "—" },
        ] satisfies Column<StudentListRow>[])),
    {
      key: "act",
      label: "",
      width: props.canCollect ? "124px" : "84px",
      align: "right",
      hideOnPhone: props.seesMoney,
      cell: (row) => {
        const mobile = mobileOf(row.phone);
        return (
          <span style={{ display: "inline-flex", gap: 2 }}>
            {mobile ? (
              <>
                <a href={`tel:${mobile}`} className="tap icon-btn" aria-label={`${tx(T.call)} ${row.name}`} style={{ width: 38, height: 38 }}>
                  <Ic n="phone" size={18} />
                </a>
                <a href={`https://wa.me/91${mobile}`} target="_blank" rel="noreferrer" className="tap icon-btn" aria-label={`${tx(T.whatsapp)} ${row.name}`} style={{ width: 38, height: 38 }}>
                  <Ic n="message" size={18} />
                </a>
              </>
            ) : null}
            {props.canCollect ? (
              <Link href={`/payments?student=${row.id}`} className="tap icon-btn" aria-label={`${tx(T.collect)} ${row.name}`} style={{ width: 38, height: 38 }}>
                <Ic n="rupee" size={18} />
              </Link>
            ) : null}
          </span>
        );
      },
    },
  ];

  const selectedRows = props.rows.filter((row) => picked.has(row.id));

  return (
    <>
      <TopBar
        crumb={tx(T.studentsCrumb(props.session))}
        title={tx(T.students)}
        mSub={tx(T.studentsCrumb(props.session))}
        actions={
          <span style={{ display: "flex", gap: 10 }}>
            <Btn icon="download" onClick={() => exportRows(props.rows)} disabled={props.rows.length === 0}>{tx(T.export)}</Btn>
            {props.canAdmit ? <Btn variant="pri" icon="userPlus" href="/admissions">{tx(T.addStudent)}</Btn> : null}
          </span>
        }
      />
      <main>
        <Section gap={14}>
          <form ref={form} action="/students" method="get" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }} role="search">
            <SearchBox name="q" value={q} onChange={setQ} placeholder={tx(T.searchStudents)} style={{ flex: "1 1 260px", maxWidth: 420 }} />
            <Select
              name="class"
              defaultValue={props.classId ?? ""}
              aria-label={tx(T.colClass)}
              onChange={() => form.current?.requestSubmit()}
              style={{ width: 170, height: 44 }}
            >
              <option value="">{tx(T.allClasses)}</option>
              {props.classes.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
            {props.seg !== "all" ? <input type="hidden" name="seg" value={props.seg} /> : null}
            <button type="submit" className="sr">{tx(T.searchStudents)}</button>
            {filtered ? <Btn variant="ghost" href="/students">{tx(T.clear)}</Btn> : null}
          </form>

          {props.seesMoney ? (
            <ChipRow label={tx(T.students)}>
              {SEGS.map((s) => (
                <Link key={s.key} href={studentsHref({ q: props.q, classId: props.classId, seg: s.key })} className={`tap chip${props.seg === s.key ? " on" : ""}`} aria-current={props.seg === s.key ? "true" : undefined}>
                  {tx(T[s.label] as { en: string; hi?: string })}
                  {props.counts?.[s.key] != null ? (
                    <span className="num" style={{ fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 9, background: props.seg === s.key ? "rgba(255,255,255,.2)" : "var(--s3)" }}>{props.counts[s.key]}</span>
                  ) : null}
                </Link>
              ))}
            </ChipRow>
          ) : null}

          {props.failed ? <p style={{ margin: 0, fontSize: 13, color: "var(--warnfg)" }}>{tx(T.couldNotRead)}</p> : null}

          <Card pad={false} style={{ overflow: "hidden" }}>
            <DataList
              rows={props.rows}
              columns={columns}
              rowKey={(row) => row.id}
              selected={(row) => picked.has(row.id)}
              caption={tx(T.students)}
              empty={
                <EmptyState
                  icon="users"
                  title={tx(filtered ? T.noMatch : T.noStudents)}
                  body={filtered ? tx(T.noMatchSub) : undefined}
                  action={filtered ? <Btn href="/students">{tx(T.clear)}</Btn> : undefined}
                />
              }
            />
            {props.total > 0 ? (
              <nav aria-label={tx(T.students)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px", borderTop: "1px solid var(--bd)" }}>
                {props.window.page > 1 ? (
                  <Btn icon="chevLeft" href={studentsHref({ q: props.q, classId: props.classId, seg: props.seg, page: props.window.page - 1 })}>{tx(T.previous)}</Btn>
                ) : (
                  <span />
                )}
                <span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.rangeOf(props.window.firstRow, props.window.lastRow, props.total))}</span>
                {props.window.page < props.window.pages ? (
                  <Btn href={studentsHref({ q: props.q, classId: props.classId, seg: props.seg, page: props.window.page + 1 })}>
                    {tx(T.next)} <Ic n="chevRight" size={18} />
                  </Btn>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </Card>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--mut)" }}>{tx(T.sourceNote)}</p>
        </Section>
      </main>

      {selectedRows.length > 0 ? (
        <div className="fadein" role="region" aria-label={tx(T.selected(selectedRows.length))} style={{ position: "fixed", left: "50%", bottom: 88, transform: "translateX(-50%)", zIndex: 30, display: "flex", alignItems: "center", gap: 8, padding: "8px 10px 8px 16px", borderRadius: 16, background: "var(--tbg, #151923)", color: "var(--tfg, #fff)", boxShadow: "var(--shl)", maxWidth: "calc(100% - 32px)" }}>
          <strong style={{ fontSize: 14, whiteSpace: "nowrap" }}>{tx(T.selected(selectedRows.length))}</strong>
          {props.canRemind ? (
            <Link href={`/reminders?students=${selectedRows.map((row) => row.id).join(",")}`} className="tap btn soft" style={{ height: 38 }}>
              <Ic n="message" size={16} /> <span className="hide-m">{tx(T.sendReminder)}</span>
            </Link>
          ) : null}
          <button type="button" className="tap btn ghost" style={{ height: 38, color: "inherit" }} onClick={() => exportRows(selectedRows)}>
            <Ic n="download" size={16} /> {tx(T.export)}
          </button>
          <button type="button" className="tap icon-btn" aria-label={tx(T.clearSelection)} style={{ width: 36, height: 36, color: "inherit" }} onClick={() => setPicked(new Set())}>
            <Ic n="x" size={18} />
          </button>
        </div>
      ) : null}
    </>
  );
}
