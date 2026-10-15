"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

import { dateLabel, initials, rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { NewMenu, SearchTrigger } from "@/vx/shell/top-actions";
import { Seg } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { IntentLink } from "@/vx/ui/intent-link";
import { TopBar } from "@/vx/ui/page";
import { Btn, Pill } from "@/vx/ui/primitives";
import { mobileOf, studentsHref, toCsv, type StudentSegment } from "@/vx/screens/admin/logic";
import {
  attendanceFigure,
  moneyStatus,
  nextSort,
  savedScroll,
  scrollToRestore,
  sortMode,
  sortStudentRows,
  studentBadges,
  studentProfileHref,
  studentViewCookieValue,
  STUDENT_VIEW_COOKIE,
  STUDENTS_SCROLL_KEY,
  type StudentBadge,
  type StudentFacts,
  type StudentSort,
  type StudentSortKey,
  type StudentView,
} from "@/vx/screens/admin/students-logic";
import { ST } from "@/vx/screens/admin/students-text";
import { T } from "@/vx/screens/admin/text";

import "./students.css";

/*
 * Students, as the design draws it: D01 on a desk (a sortable table, ticks and
 * a floating bulk bar) and F05 on a phone (cards that swipe left for Call,
 * WhatsApp and Collect). The URL is the state — search, class, view, chip,
 * page and sort are query parameters — so Back and a pasted link keep working.
 *
 * Fees (the design's list: chips and money columns) is for `fees:view`, and is
 * where such a reader starts (UI-89). School (class, attendance and a few
 * facts) is everyone else's list, and stays one tap away for fee readers at
 * the foot of the table.
 *
 * A whole row opens the child's profile; ticks, call, WhatsApp and Collect
 * keep their own clicks. The name stays a real link, so the keyboard and a
 * screen reader reach the profile the same way. Opening a profile remembers
 * where the list was scrolled, and coming back to the same list puts it there.
 */

/** Clicks that land on one of these belong to that control, not to the row. */
const OWN_CLICK = "a, button, input, select, textarea, label, summary, [role='button'], [role='checkbox'], [data-row-stop]";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

/** The design's avatar tones, taken in turn down the list. */
const TONES: [string, string][] = [
  ["var(--accs)", "var(--accfg)"],
  ["var(--infos)", "var(--info)"],
  ["var(--oks)", "var(--ok)"],
  ["var(--warns)", "var(--warnfg)"],
  ["var(--s3)", "var(--fg)"],
];

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
  /** The class's place in the school's order, for sorting by class on one page. */
  classOrder?: number;
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
  /** The class asked for in the URL (`?class=`); a class typed into the search box is not here. */
  classId: string | null;
  /** That class's name, for the chip that clears it. */
  classLabel?: string | null;
  /** Always "school" without `fees:view`. */
  view: StudentView;
  seg: StudentSegment;
  /** How the list is ordered; across pages only name and class (A→Z). */
  sort?: StudentSort;
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
  /** The quick actions this reader may open from "New" in the top bar. */
  quick?: string[];
  failed: boolean;
  /** Rows ticked when the list first draws (the design fixture's D01). */
  initialPicked?: string[];
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

/** The design's tick box: a 22px rounded square, filled when on, a dash when some are. */
function Tick({ on, some, label, onToggle }: { on: boolean; some?: boolean; label: string; onToggle: () => void }) {
  const filled = on || some;
  return (
    <button type="button" role="checkbox" aria-checked={on ? true : some ? "mixed" : false} aria-label={label} onClick={onToggle} className="tap stu-tick" data-on={filled ? "" : undefined}>
      <Ic n={on || !some ? "check" : "minus"} size={14} stroke={3} style={{ opacity: filled ? 1 : 0 }} />
    </button>
  );
}

function withSort(href: string, sort: StudentSort | null): string {
  if (!sort || (sort.key === "name" && sort.dir === 1)) return href;
  const url = new URL(href, "https://students.invalid");
  url.searchParams.set("sort", sort.key);
  if (sort.dir === -1) url.searchParams.set("dir", "desc");
  return `${url.pathname}${url.search}`;
}

/** How long the list waits after the last key before it searches. */
const SEARCH_PAUSE_MS = 450;

export function StudentsScreen(props: StudentsProps) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [q, setQ] = useState(props.q);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(props.initialPicked ?? []));
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const onePage = props.window.pages <= 1;
  const [sort, setSort] = useState<StudentSort>(props.sort ?? { key: "name", dir: 1 });
  const filtered = props.q !== "" || props.classId !== null || props.seg !== "all";
  const fees = props.seesMoney && props.view === "fees";
  // Written into every link only for a reader who has two views to choose from.
  const viewParam = props.seesMoney ? props.view : undefined;
  // Across pages the server's order rides on every link; on one page the sort is in place.
  const serverSort = !onePage && sort.key === "class" ? sort : null;
  const hrefFor = (query: Parameters<typeof studentsHref>[0]) => withSort(studentsHref(query), serverSort);
  const returnTo = hrefFor({ q: props.q, classId: props.classId, view: viewParam, seg: props.seg, page: props.window.page });
  const rows = onePage ? sortStudentRows(props.rows, sort) : props.rows;

  // The list follows the box as you type (school-day run B11): a short pause,
  // then the same GET the form makes on Enter, in place of the current entry.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  const typeQuery = (value: string) => {
    setQ(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const next = value.trim();
      if (next === props.q.trim()) return;
      router.replace(hrefFor({ q: next || undefined, classId: props.classId, view: viewParam, seg: props.seg }), { scroll: false });
    }, SEARCH_PAUSE_MS);
  };

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

  // The fee list orders by class in the database; this app's directory only by name.
  const modeOf = (key: StudentSortKey) => {
    const mode = sortMode(key, onePage);
    return mode === "server" && key === "class" && !props.seesMoney ? null : mode;
  };

  const sortBy = (key: StudentSortKey) => {
    const mode = modeOf(key);
    if (mode === "page") {
      const next = nextSort(sort, key);
      setSort(next);
      try {
        const url = withSort(studentsHref({ q: props.q, classId: props.classId, view: viewParam, seg: props.seg }), next);
        window.history.replaceState(window.history.state, "", url);
      } catch {
        // The order holds on screen; only a reload forgets it.
      }
    } else if (mode === "server") {
      router.push(withSort(studentsHref({ q: props.q, classId: props.classId, view: viewParam, seg: props.seg }), { key, dir: 1 }));
    }
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
  const allOn = rows.length > 0 && rows.every((row) => picked.has(row.id));
  const someOn = rows.some((row) => picked.has(row.id));

  const exportRows = (list: StudentListRow[]) => {
    const header = ["Name", "SR", "Class", "Roll", "Route", "Phone", ...(props.seesMoney ? ["Pending today", "Not due yet", "Late fee", "Year paid %"] : [])];
    const body = list.map((row) => [
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
    toast.show({ text: tx(T.exported(list.length)), tone: "ok" });
  };

  const badgesFor = (row: StudentListRow, only?: StudentBadge["kind"]) => {
    const all = studentBadges(row.facts, { view: props.view, seesMoney: props.seesMoney });
    const shown = only ? all.shown.filter((b) => b.kind === only) : all.shown;
    const more = only ? all.more.filter((b) => b.kind === only) : all.more;
    return <Badges shown={shown} more={more} session={props.session} open={opened.has(row.id)} onToggle={() => toggleOpen(row.id)} />;
  };

  const attendanceCell = (row: StudentListRow) => {
    if (!props.attendanceRead) return <span style={{ color: "var(--sub)" }}>—</span>;
    const figure = attendanceFigure(row.facts.attendance);
    if (!figure) return <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{tx(ST.noAttendance)}</span>;
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", minWidth: 0 }} title={tx(ST.dAttendance(props.session, figure.pct))}>
        <span className="num" style={{ fontWeight: 600 }}>{tx(ST.attendanceDays(figure.present, figure.counted))}</span>
        {figure.pct !== null ? <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(ST.attendancePct(figure.pct))}</span> : null}
      </span>
    );
  };

  /* ------------------------------------------------------------ the table */

  type Col = { key: string; label: string; sort?: StudentSortKey; align?: "right"; pad?: string };
  const cols: Col[] = fees
    ? [
        { key: "name", label: tx(T.colStudent), sort: "name" },
        { key: "class", label: tx(T.colClass), sort: "class" },
        { key: "route", label: tx(T.colRoute) },
        { key: "pending", label: tx(ST.colPendingToday), sort: "pending", align: "right" },
        { key: "notdue", label: tx(ST.colNotDueYet), sort: "notdue", align: "right" },
        { key: "paid", label: tx(T.colYearPaid), sort: "paid" },
        { key: "act", label: "" },
      ]
    : [
        { key: "name", label: tx(T.colStudent), sort: "name" },
        { key: "class", label: tx(T.colClass), sort: "class" },
        { key: "attendance", label: tx(ST.colAttendance) },
        { key: "details", label: tx(ST.colDetails) },
        { key: "act", label: "" },
      ];
  const tracks = fees
    ? "52px minmax(230px,2.2fr) minmax(130px,1.2fr) 96px 130px 130px minmax(150px,1.3fr) 136px"
    : "52px minmax(230px,2.2fr) minmax(130px,1.2fr) minmax(130px,1fr) minmax(200px,2fr) 96px";

  const headCell = (c: Col): ReactNode => {
    const mode = c.sort ? modeOf(c.sort) : null;
    if (!c.sort || !mode) {
      return (
        <span role="columnheader" key={c.key} className="stu-th" style={{ justifyContent: c.align === "right" ? "flex-end" : "flex-start" }}>
          <span className="stu-thl" title={c.sort ? tx(ST.sortOnePage) : undefined}>{c.label}</span>
        </span>
      );
    }
    const on = sort.key === c.sort;
    return (
      <span role="columnheader" key={c.key} className="stu-th" aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : undefined} style={{ justifyContent: c.align === "right" ? "flex-end" : "flex-start" }}>
        <button type="button" className="tap stu-sort" data-on={on ? "" : undefined} onClick={() => sortBy(c.sort!)} aria-label={tx(ST.sortBy(c.label))}>
          {c.label}
          <Ic n="arrowUp" size={14} style={{ opacity: on ? 1 : 0.25, transform: on && sort.dir === -1 ? "rotate(180deg)" : "none", transition: "transform .25s var(--ease), opacity .2s" }} />
        </button>
      </span>
    );
  };

  const nameCell = (row: StudentListRow, i: number) => {
    const [bg, fg] = TONES[i % TONES.length];
    return (
      <span role="cell" style={{ minWidth: 0 }}>
        <span className="stu-name">
          <span className="stu-ava" style={{ background: bg, color: fg }} aria-hidden="true">{initials(row.name)}</span>
          <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <IntentLink href={studentProfileHref(row.id, returnTo)} data-row-link="" className="stu-link">
              <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{row.name}</span>
            </IntentLink>
            <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{[row.sr ? `SR ${row.sr}` : null, row.parent].filter(Boolean).join(" · ") || "—"}</span>
            {/* An EMI plan is the one fact the money columns cannot show. */}
            {fees ? badgesFor(row, "emi") : null}
          </span>
        </span>
      </span>
    );
  };

  const actions = (row: StudentListRow, desk: boolean) => {
    const mobile = mobileOf(row.phone);
    const who = row.parent ?? row.name;
    if (desk) {
      return (
        <span role="cell" className="stu-ra">
          {mobile ? (
            <>
              <a href={`tel:${mobile}`} className="tap btn ghost stu-ib" aria-label={tx(ST.callParent(who))} style={{ color: "var(--info)" }}>
                <Ic n="phone" />
              </a>
              <a href={`https://wa.me/91${mobile}`} target="_blank" rel="noreferrer" className="tap btn ghost stu-ib" aria-label={tx(ST.whatsappParent(who))} style={{ color: "var(--ok)" }}>
                <Ic n="message" />
              </a>
            </>
          ) : null}
          {props.canCollect && fees ? (
            <Link prefetch={false} href={`/payments?student=${row.id}`} className="tap btn soft stu-ib" aria-label={tx(ST.collectFrom(row.name))}>
              <Ic n="rupee" />
            </Link>
          ) : null}
        </span>
      );
    }
    if (!mobile && !props.canCollect) return null;
    return (
      <div className="stu-acts" data-row-stop>
        {mobile ? (
          <>
            <a href={`tel:${mobile}`} className="tap" aria-label={tx(ST.callParent(who))} style={{ background: "var(--infos)", color: "var(--info)" }}>
              <Ic n="phone" />
              {tx(T.call)}
            </a>
            <a href={`https://wa.me/91${mobile}`} target="_blank" rel="noreferrer" className="tap" aria-label={tx(ST.whatsappParent(who))} style={{ background: "var(--oks)", color: "var(--ok)" }}>
              <Ic n="message" />
              {tx(T.whatsapp)}
            </a>
          </>
        ) : null}
        {props.canCollect ? (
          <Link prefetch={false} href={`/payments?student=${row.id}`} className="tap" aria-label={tx(ST.collectFrom(row.name))} style={{ background: "var(--pri)", color: "var(--prifg)" }}>
            <Ic n="rupee" />
            {tx(T.collect)}
          </Link>
        ) : null}
      </div>
    );
  };

  const moneyLine = (row: StudentListRow): ReactNode => {
    if (!row.money) {
      const figure = props.attendanceRead ? attendanceFigure(row.facts.attendance) : null;
      return figure ? (
        <>
          <span className="num" style={{ fontSize: 14, fontWeight: 700 }}>{tx(ST.attendanceDays(figure.present, figure.counted))}</span>
          <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx(ST.colAttendance)}</span>
        </>
      ) : null;
    }
    const st = moneyStatus(row.money);
    if (st.kind === "pending") {
      return (
        <>
          <span className="num" style={{ fontSize: 14, fontWeight: 700, color: "var(--bad)" }}>{rupees(st.amount)}</span>
          <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx(ST.pendingToday)}</span>
        </>
      );
    }
    if (st.kind === "track") {
      return (
        <>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{tx(ST.onTrack)}</span>
          <span className="num" style={{ fontSize: 11, color: "var(--mut)" }}>{tx(ST.later(rupees(st.amount)))}</span>
        </>
      );
    }
    return (
      <>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ok)" }}>{tx(ST.paidUp)}</span>
        <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx(ST.yearClear)}</span>
      </>
    );
  };

  const selectedRows = props.rows.filter((row) => picked.has(row.id));
  const chips = fees ? (
    <>
      {SEGS.map((s) => {
        const on = props.seg === s.key;
        const count = props.counts?.[s.key];
        return (
          <Link key={s.key} href={hrefFor({ q: props.q, classId: props.classId, view: "fees", seg: s.key })} className={`tap chip${on ? " on" : ""}`} aria-current={on ? "true" : undefined}>
            {tx(T[s.label] as { en: string; hi?: string })}
            {count != null ? <span className="num" style={{ opacity: 0.7 }}>{count}</span> : null}
          </Link>
        );
      })}
    </>
  ) : null;
  const classChip =
    props.classId && props.classLabel ? (
      <Link href={hrefFor({ q: props.q, view: viewParam, seg: props.seg })} className="tap chip on" aria-label={tx(ST.clearClass(props.classLabel))}>
        {props.classLabel}
        <Ic n="x" size={14} />
      </Link>
    ) : null;
  const hidden = (
    <>
      {props.classId ? <input type="hidden" name="class" value={props.classId} /> : null}
      {viewParam ? <input type="hidden" name="view" value={viewParam} /> : null}
      {props.seg !== "all" ? <input type="hidden" name="seg" value={props.seg} /> : null}
      {serverSort ? <input type="hidden" name="sort" value={serverSort.key} /> : null}
    </>
  );
  const noRows = (
    <div className="stu-empty">
      {filtered ? tx(ST.noMatchDesign) : tx(T.noStudents)}
      {filtered ? (
        <div style={{ marginTop: 12 }}>
          <Btn href={studentsHref({ view: viewParam })}>{tx(T.clear)}</Btn>
        </div>
      ) : null}
    </div>
  );
  const pager =
    props.window.pages > 1 ? (
      <nav aria-label={tx(T.students)} className="stu-pager">
        {props.window.page > 1 ? (
          <Btn icon="chevLeft" href={hrefFor({ q: props.q, classId: props.classId, view: viewParam, seg: props.seg, page: props.window.page - 1 })}>{tx(T.previous)}</Btn>
        ) : null}
        <span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.rangeOf(props.window.firstRow, props.window.lastRow, props.total))}</span>
        {props.window.page < props.window.pages ? (
          <Btn href={hrefFor({ q: props.q, classId: props.classId, view: viewParam, seg: props.seg, page: props.window.page + 1 })}>
            {tx(T.next)} <Ic n="chevRight" size={18} />
          </Btn>
        ) : null}
      </nav>
    ) : null;
  const viewSwitch = props.seesMoney ? (
    <Seg<StudentView>
      label={tx(ST.views)}
      value={props.view}
      onChange={pickView}
      options={[
        { value: "fees", label: tx(ST.viewFees) },
        { value: "school", label: tx(ST.viewSchool) },
      ]}
      style={{ width: 180 }}
    />
  ) : null;

  return (
    <>
      <div className="only-d" style={{ display: "contents" }}>
        <TopBar
          crumb={tx(T.studentsCrumb(props.session))}
          title={tx(T.students)}
          actions={
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <SearchTrigger />
              {props.quick?.length ? <NewMenu keys={props.quick} /> : null}
            </span>
          }
        />
      </div>
      <div className="vx-pmain stu">
        {/* Phone: the design's own header, not a top bar (F05). */}
        <header className="only-m glass stu-mhead">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <h1 className="serif" style={{ margin: 0, fontSize: 30, fontWeight: 600 }}>{tx(T.students)}</h1>
            <span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{props.total > rows.length ? tx(ST.showingOf(rows.length, props.total)) : tx(ST.showing(rows.length))}</span>
          </div>
          <form action="/students" method="get" role="search" className="stu-msearch">
            <Ic n="search" />
            <label className="sr" htmlFor="stu-q-m">{tx(ST.searchLabel)}</label>
            <input id="stu-q-m" type="search" name="q" value={q} onChange={(e) => typeQuery(e.target.value)} placeholder={tx(ST.searchPhone)} enterKeyHint="search" />
            {hidden}
          </form>
          {chips || classChip ? (
            <div className="hs stu-mchips" role="group" aria-label={tx(T.students)}>
              {classChip}
              {chips}
            </div>
          ) : null}
        </header>

        <div className="stu-wrap">
          <div className="only-d stu-tools">
            <form action="/students" method="get" role="search" className="stu-dsearch">
              <Ic n="search" />
              <label className="sr" htmlFor="stu-q-d">{tx(ST.searchLabel)}</label>
              <input id="stu-q-d" type="search" name="q" value={q} onChange={(e) => typeQuery(e.target.value)} placeholder={tx(ST.search)} />
              {hidden}
            </form>
            <div className="hs" role="group" aria-label={tx(T.students)} style={{ display: "flex", gap: 6, flex: 1, minWidth: 0 }}>
              {classChip}
              {chips}
            </div>
            <Btn icon="download" onClick={() => exportRows(rows)} disabled={rows.length === 0}>{tx(T.export)}</Btn>
            {props.canAdmit ? <Btn variant="pri" icon="userPlus" href="/admissions/new">{tx(T.addStudent)}</Btn> : null}
          </div>

          {props.failed ? <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--warnfg)" }}>{tx(T.couldNotRead)}</p> : null}

          {/* Row clicks are delegated here; the keyboard path is each row's name link. */}
          <div className="only-d card stu-card" onClick={onListClick}>
            <div style={{ overflowX: "auto" }}>
              <div role="table" aria-label={tx(T.students)} style={{ minWidth: 900 }}>
                <div role="row" className="stu-head" style={{ gridTemplateColumns: tracks }}>
                  <span role="columnheader" style={{ display: "flex", justifyContent: "center" }}>
                    <Tick on={allOn} some={someOn} label={tx(T.selectAll)} onToggle={() => setPicked(allOn ? new Set() : new Set(rows.map((row) => row.id)))} />
                  </span>
                  {cols.map(headCell)}
                </div>
                {rows.length === 0
                  ? noRows
                  : rows.map((row, i) => (
                      <div key={row.id} role="row" className={`stu-row${picked.has(row.id) ? " sel" : ""}`} style={{ gridTemplateColumns: tracks, borderTop: i === 0 ? 0 : undefined, animationDelay: `${Math.min(i * 30, 400)}ms` }}>
                        <span role="cell" style={{ display: "flex", justifyContent: "center" }}>
                          <Tick on={picked.has(row.id)} label={tx(T.selectRow(row.name))} onToggle={() => toggle(row.id)} />
                        </span>
                        {nameCell(row, i)}
                        <span role="cell" className="stu-td">{row.classLabel}{row.rollNo ? ` · ${tx(T.colRoll)} ${row.rollNo}` : ""}</span>
                        {fees && row.money ? (
                          <>
                            <span role="cell" className="stu-td" style={{ color: row.route ? "var(--fg)" : "var(--sub)" }}>{row.route ?? "—"}</span>
                            <span role="cell" className="stu-td num" style={{ fontSize: 14, fontWeight: 700, textAlign: "right", color: row.money.pendingToday > 0 ? "var(--bad)" : "var(--sub)" }}>
                              {row.money.pendingToday > 0 ? rupees(row.money.pendingToday) : "—"}
                            </span>
                            <span role="cell" className="stu-td num" style={{ textAlign: "right", color: "var(--mut)" }}>{row.money.notDueYet > 0 ? rupees(row.money.notDueYet) : "—"}</span>
                            <span role="cell" style={{ padding: "0 8px 0 16px", display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--s3)", overflow: "hidden", display: "block" }}>
                                <span className="stu-bar" style={{ width: `${row.money.percent}%`, background: row.money.percent >= 100 ? "var(--ok)" : row.money.pendingToday > 0 ? "var(--warn)" : "var(--acc)", animationDelay: `${Math.min(i * 30, 400)}ms` }} />
                              </span>
                              <span className="num" style={{ width: 36, fontSize: 12, fontWeight: 700, textAlign: "right" }}>{row.money.percent}%</span>
                            </span>
                          </>
                        ) : fees ? (
                          <>
                            <span role="cell" className="stu-td" style={{ color: "var(--sub)" }}>{row.route ?? "—"}</span>
                            <span role="cell" className="stu-td" style={{ textAlign: "right", color: "var(--sub)" }}>—</span>
                            <span role="cell" className="stu-td" style={{ textAlign: "right", color: "var(--sub)" }}>—</span>
                            <span role="cell" className="stu-td" style={{ color: "var(--sub)" }}>—</span>
                          </>
                        ) : (
                          <>
                            <span role="cell" className="stu-td">{attendanceCell(row)}</span>
                            <span role="cell" className="stu-td">{badgesFor(row)}</span>
                          </>
                        )}
                        {actions(row, true)}
                      </div>
                    ))}
              </div>
            </div>
          </div>

          {/* Phone: cards that swipe left for Call · WhatsApp · Collect (F05). */}
          <div className="only-m stu-cards" onClick={onListClick}>
            {rows.length === 0
              ? <div className="card">{noRows}</div>
              : rows.map((row, i) => {
                  const [bg, fg] = TONES[i % TONES.length];
                  const meta = [row.classLabel, row.sr ? `SR ${row.sr}` : null, fees ? row.route : null].filter(Boolean).join(" · ");
                  return (
                    <div key={row.id} className="hs stu-swipe rise" style={{ animationDelay: `${Math.min(i * 30, 400)}ms` }}>
                      <IntentLink href={studentProfileHref(row.id, returnTo)} data-row-link="" aria-label={row.name} className="tap card stu-mcard">
                        <span className="stu-ava" style={{ width: 46, height: 46, borderRadius: 23, fontSize: 15, background: bg, color: fg }} aria-hidden="true">{initials(row.name)}</span>
                        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span className="clip" style={{ fontSize: 15, fontWeight: 600 }}>{row.name}</span>
                          <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{meta}</span>
                        </span>
                        <span style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>{moneyLine(row)}</span>
                      </IntentLink>
                      {actions(row, false)}
                    </div>
                  );
                })}
            {rows.length > 0 && (props.canCollect || rows.some((r) => mobileOf(r.phone))) ? (
              <p style={{ margin: "6px 0 0", textAlign: "center", fontSize: 12, color: "var(--sub)" }}>{tx(props.canCollect ? ST.swipeHint : ST.swipeHintNoCollect)}</p>
            ) : null}
            {/* The phone has no ticks (F05); the list's export stays reachable under it. */}
            {rows.length > 0 ? (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <Btn variant="ghost" icon="download" onClick={() => exportRows(rows)}>{tx(ST.exportList(rows.length))}</Btn>
              </div>
            ) : null}
          </div>

          <div className="stu-foot">
            {rows.length > 0 ? <span className="only-d" style={{ fontSize: 12, color: "var(--sub)" }}>{tx(ST.footer(props.window.firstRow, props.window.lastRow, props.total))}</span> : <span />}
            {pager}
            {viewSwitch}
          </div>
          <p className="only-d" style={{ margin: 0, fontSize: 12, color: "var(--sub)" }}>{tx(T.sourceNote)}</p>
        </div>
      </div>

      {selectedRows.length > 0 ? (
        <div className="only-d stu-bulkwrap">
          <div role="toolbar" aria-label={tx(T.selected(selectedRows.length))} className="stu-bulk">
            <span className="num" style={{ fontSize: 14, fontWeight: 700, marginRight: 10, whiteSpace: "nowrap" }}>{tx(T.selected(selectedRows.length))}</span>
            {props.canRemind ? (
              <Link href={`/reminders?students=${selectedRows.map((row) => row.id).join(",")}`} className="tap btn" style={{ height: 36, background: "var(--tacs)", color: "var(--tacc)" }}>
                <Ic n="message" /> {tx(T.sendReminder)}
              </Link>
            ) : null}
            <button type="button" className="tap btn" style={{ height: 36, background: "transparent", color: "var(--tfg)" }} onClick={() => exportRows(selectedRows)}>
              <Ic n="download" /> {tx(T.export)}
            </button>
            <button type="button" className="tap btn" aria-label={tx(T.clearSelection)} style={{ height: 36, width: 36, padding: 0, background: "transparent", color: "var(--tfg)" }} onClick={() => setPicked(new Set())}>
              <Ic n="x" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
