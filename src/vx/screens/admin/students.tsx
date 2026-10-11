"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import { dateLabel, initials, rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { ChipRow, SearchBox, Seg, Select } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { IntentLink } from "@/vx/ui/intent-link";
import { DataList, Section, TopBar, type Column } from "@/vx/ui/page";
import { Avatar, Btn, Card, EmptyState, Pill } from "@/vx/ui/primitives";
import { mobileOf, studentsHref, toCsv, type StudentSegment } from "@/vx/screens/admin/logic";
import {
  attendanceFigure,
  savedScroll,
  scrollToRestore,
  studentBadges,
  studentViewCookieValue,
  STUDENT_VIEW_COOKIE,
  STUDENTS_SCROLL_KEY,
  type StudentBadge,
  type StudentFacts,
  type StudentView,
} from "@/vx/screens/admin/students-logic";
import { ST } from "@/vx/screens/admin/students-text";
import { T } from "@/vx/screens/admin/text";

/*
 * Students (design F05/D01). The URL is the state — search, class, view, chip
 * and page are all query parameters, as the directory always was, so Back and
 * a pasted link keep working. Two views: School for everyone, Fees (the money
 * columns and chips) only for `fees:view`.
 *
 * A whole row opens the child's profile; the checkbox, call, WhatsApp, Collect
 * and "+N details" keep their own clicks. The name stays a real link, so the
 * keyboard and a screen reader reach the profile the same way. Opening a
 * profile remembers where the list was scrolled, and coming back to the same
 * list puts it there again.
 */

/** Clicks that land on one of these belong to that control, not to the row. */
const OWN_CLICK = "a, button, input, select, textarea, label, summary, [role='button'], [data-row-stop]";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function rememberScroll() {
  try {
    window.sessionStorage.setItem(STUDENTS_SCROLL_KEY, savedScroll(currentUrl(), window.scrollY, Date.now()));
  } catch {
    // Private mode or storage full: Back still works, it just starts at the top.
  }
}

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
  /** What the badges are made from. Money facts are empty without `fees:view`. */
  facts: StudentFacts;
};

export type StudentsProps = {
  session: string;
  rows: StudentListRow[];
  total: number;
  window: { page: number; pages: number; firstRow: number; lastRow: number };
  q: string;
  classId: string | null;
  /** Always "school" without `fees:view`. */
  view: StudentView;
  seg: StudentSegment;
  classes: { id: string; label: string }[];
  counts: Partial<Record<StudentSegment, number | null>> | null;
  seesMoney: boolean;
  /** False when the attendance read failed: the column says "—", not "No attendance yet". */
  attendanceRead: boolean;
  /** The reader's staff id, which keys the remembered view to them. */
  viewKey: string;
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

type Tx = ReturnType<typeof useVx>["tx"];

function badgeLabel(badge: StudentBadge, tx: Tx): string {
  switch (badge.kind) {
    case "attendance":
      return tx(ST.bAttendance(badge.present, badge.counted));
    case "siblings":
      return tx(ST.bSiblings(badge.count));
    case "new":
      return tx(ST.bNew);
    case "route":
      return tx(ST.bRoute(badge.route));
    case "yearClear":
      return tx(ST.bYearClear);
    case "emi":
      return tx(badge.status === "behind" ? ST.bEmiBehind : badge.status === "due" ? ST.bEmiDue : badge.status === "completed" ? ST.bEmiDone : ST.bEmi);
    case "concession":
      return tx(ST.bConcession(badge.label));
  }
}

/** The period, reason and source behind a badge. */
function badgeDetail(badge: StudentBadge, session: string, tx: Tx): string {
  switch (badge.kind) {
    case "attendance":
      return tx(ST.dAttendance(session, badge.pct));
    case "siblings":
      return tx(ST.dSiblings);
    case "new":
      return tx(ST.dNew(session));
    case "route":
      return tx(ST.dRoute);
    case "yearClear":
      return tx(ST.dYearClear(session));
    case "emi": {
      const line = tx(ST.dEmi(rupees(badge.monthly), badge.nextDue ? dateLabel(badge.nextDue) : null));
      return badge.status === "behind" ? `${line} · ${tx(ST.dEmiBehind)}` : line;
    }
    case "concession":
      return tx(ST.dConcession);
  }
}

/** Up to three factual badges, then "+N details" that opens the rest in place. */
function Badges({ shown, more, session, open, onToggle }: { shown: StudentBadge[]; more: StudentBadge[]; session: string; open: boolean; onToggle: () => void }) {
  const { tx } = useVx();
  if (shown.length === 0 && more.length === 0) return null;
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {shown.map((badge, i) => (
          <span key={`${badge.kind}-${i}`} title={badgeDetail(badge, session, tx)} style={{ display: "inline-flex" }}>
            <Pill tone={badge.tone} style={{ fontSize: 11.5 }}>{badgeLabel(badge, tx)}</Pill>
          </span>
        ))}
        {more.length > 0 ? (
          <button
            type="button"
            className="tap"
            aria-expanded={open}
            onClick={onToggle}
            style={{ border: 0, background: "none", padding: "2px 4px", fontSize: 12, fontWeight: 600, color: "var(--pri)", cursor: "pointer" }}
          >
            {open ? tx(ST.lessDetails) : tx(ST.moreDetails(more.length))}
          </button>
        ) : null}
      </span>
      {open && more.length > 0 ? (
        <ul data-row-stop style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4, cursor: "auto" }}>
          {more.map((badge, i) => (
            <li key={`${badge.kind}-${i}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 8px", fontSize: 12 }}>
              <Pill tone={badge.tone} style={{ fontSize: 11.5 }}>{badgeLabel(badge, tx)}</Pill>
              <span style={{ color: "var(--mut)" }}>{badgeDetail(badge, session, tx)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}

export function StudentsScreen(props: StudentsProps) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [q, setQ] = useState(props.q);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const filtered = props.q !== "" || props.classId !== null || props.seg !== "all";
  const fees = props.seesMoney && props.view === "fees";
  // Written into every link only for a reader who has two views to choose from.
  const viewParam = props.seesMoney ? props.view : undefined;

  // Back from a profile: put the list where it was, once, and only for the same list.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(STUDENTS_SCROLL_KEY);
    } catch {
      return;
    }
    const y = scrollToRestore(raw, currentUrl(), Date.now());
    if (y === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo(0, y);
      try {
        window.sessionStorage.removeItem(STUDENTS_SCROLL_KEY);
      } catch {
        // Nothing to clean up if storage is unavailable.
      }
      // Late layout (fonts, the row fade-in) can pull a short page back up; one more try.
      timer = setTimeout(() => {
        if (window.scrollY < 4) window.scrollTo(0, y);
      }, 150);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const pickView = (next: StudentView) => {
    if (next === props.view) return;
    try {
      document.cookie = `${STUDENT_VIEW_COOKIE}=${studentViewCookieValue(props.viewKey, next)}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`;
    } catch {
      // Not remembered, but the URL still opens the view chosen.
    }
    router.push(studentsHref({ q: props.q, classId: props.classId, view: next }));
  };

  const toggleOpen = (id: string) =>
    setOpened((all) => {
      const copy = new Set(all);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });

  /**
   * A click anywhere on a row opens the profile through the row's own name
   * link — so prefetch, Ctrl/⌘-click and the back trail all behave exactly as
   * if the name had been clicked. Clicks on a control, or the end of a text
   * selection, are left alone.
   */
  const onListClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    if (!target) return;
    if (target.closest("a[data-row-link]")) {
      // A modified click opens a new tab; this list is not being left.
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey) rememberScroll();
      return;
    }
    if (target.closest(OWN_CLICK)) return;
    if ((window.getSelection()?.toString() ?? "") !== "") return;
    const row = target.closest("[role='row']");
    if (!row || !event.currentTarget.contains(row)) return;
    const link = row.querySelector<HTMLAnchorElement>("a[data-row-link]");
    if (!link) return;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey }));
  };

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

  const badgesFor = (row: StudentListRow) => {
    const { shown, more } = studentBadges(row.facts, { view: props.view, seesMoney: props.seesMoney });
    return <Badges shown={shown} more={more} session={props.session} open={opened.has(row.id)} onToggle={() => toggleOpen(row.id)} />;
  };

  const attendanceCell = (row: StudentListRow) => {
    if (!props.attendanceRead) return <span style={{ color: "var(--mut)" }}>—</span>;
    const figure = attendanceFigure(row.facts.attendance);
    if (!figure) return <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{tx(ST.noAttendance)}</span>;
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", minWidth: 0 }} title={tx(ST.dAttendance(props.session, figure.pct))}>
        <span className="num" style={{ fontWeight: 600 }}>{tx(ST.attendanceDays(figure.present, figure.counted))}</span>
        {figure.pct !== null ? <span className="num only-d" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(ST.attendancePct(figure.pct))}</span> : null}
      </span>
    );
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
        <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <IntentLink href={`/students/${row.id}`} data-row-link="" className="tap" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span className="clip" style={{ fontWeight: 600 }}>{row.name}</span>
            <span className="clip only-d" style={{ fontSize: 12.5, color: "var(--mut)", fontWeight: 400 }}>
              {[row.sr ? `SR ${row.sr}` : null, row.parent].filter(Boolean).join(" · ") || "—"}
            </span>
          </IntentLink>
          {/* In the Fees view the facts ride under the name, so the money columns keep their width. */}
          {fees ? badgesFor(row) : null}
        </span>
      </span>
    ),
  };

  const columns: Column<StudentListRow>[] = [
    name,
    { key: "class", label: tx(T.colClass), width: "minmax(110px,1fr)", cell: (row) => `${row.classLabel}${row.rollNo ? ` · ${tx(T.colRoll)} ${row.rollNo}` : ""}` },
    ...(!fees
      ? ([
          { key: "attendance", label: tx(ST.colAttendance), width: "minmax(110px,.9fr)", cell: attendanceCell },
          { key: "details", label: tx(ST.colDetails), width: "minmax(180px,1.6fr)", cell: (row) => badgesFor(row) },
        ] satisfies Column<StudentListRow>[])
      : []),
    ...(fees
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
      : []),
    {
      key: "act",
      label: "",
      width: props.canCollect ? "124px" : "84px",
      align: "right",
      hideOnPhone: fees,
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
            {viewParam ? <input type="hidden" name="view" value={viewParam} /> : null}
            {props.seg !== "all" ? <input type="hidden" name="seg" value={props.seg} /> : null}
            <button type="submit" className="sr">{tx(T.searchStudents)}</button>
            {filtered ? <Btn variant="ghost" href={studentsHref({ view: viewParam })}>{tx(T.clear)}</Btn> : null}
            {props.seesMoney ? (
              <Seg<StudentView>
                label={tx(ST.views)}
                value={props.view}
                onChange={pickView}
                options={[
                  { value: "school", label: tx(ST.viewSchool) },
                  { value: "fees", label: tx(ST.viewFees) },
                ]}
                style={{ width: 200, marginLeft: "auto" }}
              />
            ) : null}
          </form>

          {fees ? (
            <ChipRow label={tx(T.students)}>
              {SEGS.map((s) => (
                <Link key={s.key} href={studentsHref({ q: props.q, classId: props.classId, view: "fees", seg: s.key })} className={`tap chip${props.seg === s.key ? " on" : ""}`} aria-current={props.seg === s.key ? "true" : undefined}>
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
            {/* Row clicks are delegated here; the keyboard path is each row's name link. */}
            <div className="row-links" onClick={onListClick}>
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
                  action={filtered ? <Btn href={studentsHref({ view: viewParam })}>{tx(T.clear)}</Btn> : undefined}
                />
              }
            />
            </div>
            {props.total > 0 ? (
              <nav aria-label={tx(T.students)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px", borderTop: "1px solid var(--bd)" }}>
                {props.window.page > 1 ? (
                  <Btn icon="chevLeft" href={studentsHref({ q: props.q, classId: props.classId, view: viewParam, seg: props.seg, page: props.window.page - 1 })}>{tx(T.previous)}</Btn>
                ) : (
                  <span />
                )}
                <span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.rangeOf(props.window.firstRow, props.window.lastRow, props.total))}</span>
                {props.window.page < props.window.pages ? (
                  <Btn href={studentsHref({ q: props.q, classId: props.classId, view: viewParam, seg: props.seg, page: props.window.page + 1 })}>
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
