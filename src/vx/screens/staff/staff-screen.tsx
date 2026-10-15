"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type CSSProperties, type ReactNode } from "react";

import type { StaffPermission, StaffRole } from "@/platform/auth/permissions";
import {
  addStaffAction,
  changeRoleAction,
  createLoginAction,
  resetPasswordAction,
  saveMatrixAction,
  setLoginActiveAction,
  type StaffActionResult,
} from "@/app/(app)/staff/vx-actions";
import { agoP, initials, shortDay } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Chip, ChipRow, Field, Input, Seg, Switch } from "@/vx/ui/controls";
import { HelpButton, Sheet, useToast } from "@/vx/ui/overlays";
import { TopBar, VxPage } from "@/vx/ui/page";
import { Btn } from "@/vx/ui/primitives";

import {
  cellLock,
  describeChange,
  diffMatrix,
  has,
  matrixGroups,
  MATRIX_ROLES,
  ROLE_LABELS,
  toggle,
  type Matrix,
} from "./domain/matrix";
import {
  countStaff,
  DISABLE_REASONS,
  LOGIN_FILTER_LABELS,
  LOGIN_LABELS,
  loginState,
  maskPhone,
  matchesLogin,
  matchesQuery,
  matchesRole,
  pronouns,
  ROLE_FILTER_LABELS,
  rolePills,
  shortName,
  sortRows,
  titleLine,
  worksOn,
  type LoginFilter,
  type LoginState,
  type RoleFilter,
  type StaffRow,
} from "./domain/people";
import type { StaffEvent } from "./data";

/*
 * Staff & roles (design `Staff`): the staff list with its profile panel, the
 * roles × permissions matrix, and the login sheets. Every write is a server
 * action in `app/(app)/staff/vx-actions.ts`, which checks the permission, the
 * admin rule and the last-admin guard again; the screen only offers what the
 * reader may do.
 */

type SheetKind = "invite" | "created" | "reset" | "deactivate" | "add" | "role" | null;

const ROLE_FILTERS: RoleFilter[] = ["all", "office", "class_teachers", "subject_teachers", "coordinators"];
const LOGIN_FILTERS: LoginFilter[] = ["all", "never", "disabled", "no_login"];
const DAYS = ["M", "T", "W", "T", "F", "S"];

const AVATAR_TONES: [string, string][] = [
  ["var(--accs)", "var(--accfg)"],
  ["var(--infos)", "var(--info)"],
  ["var(--oks)", "var(--ok)"],
  ["var(--warns)", "var(--warnfg)"],
  ["var(--s3)", "var(--fg)"],
];

function avatarTone(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

const LOGIN_TONE: Record<LoginState, [string, string]> = {
  active: ["var(--oks)", "var(--ok)"],
  never: ["var(--warns)", "var(--warnfg)"],
  disabled: ["var(--bads)", "var(--bad)"],
  none: ["var(--s3)", "var(--mut)"],
};

export const ROLE_HELP: Record<StaffRole, Pair> = {
  admin: p("Everything, always", "सब कुछ, हमेशा"),
  accountant: p("Money and reports", "फीस और रिपोर्ट"),
  teacher: p("Their class: attendance, marks, notes", "अपनी कक्षा: हाज़िरी, अंक, नोट्स"),
  exam_coordinator: p("Opens marks entry and publishes results", "अंक प्रविष्टि खोलें, परिणाम जारी करें"),
  academic_coordinator: p("Marks, progress and attendance across classes", "सभी कक्षाओं के अंक, प्रगति व हाज़िरी"),
  office: p("Front office: students, attendance, staff", "कार्यालय: विद्यार्थी, हाज़िरी, स्टाफ़"),
  fee_collector: p("Takes fees at the counter", "काउंटर पर फीस लेते हैं"),
  view_only: p("Can look, can’t change anything", "देख सकते हैं, बदल नहीं सकते"),
};

const people = (n: number) => p(`${n} ${n === 1 ? "person" : "people"}`, `${n} ${n === 1 ? "व्यक्ति" : "लोग"}`);

const S = {
  col: { display: "flex", flexDirection: "column" } as CSSProperties,
  row: { display: "flex", alignItems: "center" } as CSSProperties,
  sub: { fontSize: 12, color: "var(--mut)" } as CSSProperties,
  note: { display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 14, fontSize: 13, textAlign: "left", lineHeight: 1.45 } as CSSProperties,
};

function Av({ name, seed, size = 38, font = 12, serif }: { name: string; seed: string; size?: number; font?: number; serif?: boolean }) {
  const [bg, fg] = avatarTone(seed);
  return (
    <span aria-hidden="true" className={serif ? "serif" : undefined} style={{ flex: "none", width: size, height: size, borderRadius: size / 2, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: font, fontWeight: 700, animation: serif ? "xPopIn .4s var(--spring) both" : undefined }}>
      {initials(name)}
    </span>
  );
}

function Pill({ bg, fg, children, dot }: { bg: string; fg: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className="pill" style={{ background: bg, color: fg, transition: "background-color .3s ease" }}>
      {dot ? <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} /> : null}
      {children}
    </span>
  );
}

/** A sheet's footer, as the design draws it: the way out, then the main action a little wider. */
function Foot({ sec, onSec, label, icon, variant = "pri", onGo, disabled }: { sec: string; onSec: () => void; label: string; icon: IconName; variant?: "pri" | "danger"; onGo: () => void; disabled?: boolean }) {
  return (
    <>
      <Btn style={{ flex: 1 }} onClick={onSec}>{sec}</Btn>
      <Btn variant={variant} icon={icon} style={{ flex: 1.4 }} disabled={disabled} onClick={onGo}>{label}</Btn>
    </>
  );
}

function Opt({ on, onPick, children, role = "radio" }: { on: boolean; onPick: () => void; children: ReactNode; role?: "radio" | "checkbox" }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      onClick={onPick}
      className="tap"
      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 14px", borderRadius: 14, border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)", color: "var(--fg)", textAlign: "left" }}
    >
      <span aria-hidden="true" style={{ flex: "none", width: 20, height: 20, borderRadius: 10, border: `2px solid ${on ? "var(--acc)" : "var(--bds)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--acc)", transform: `scale(${on ? 1 : 0})`, transition: "transform .25s var(--spring)" }} />
      </span>
      {children}
    </button>
  );
}

function SearchField({ value, onChange, placeholder, phone }: { value: string; onChange: (v: string) => void; placeholder: string; phone?: boolean }) {
  return (
    <label style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, height: phone ? 46 : 40, padding: "0 12px", borderRadius: phone ? 23 : 12, border: `1px solid ${phone ? "var(--bds)" : "var(--bd)"}`, background: "var(--card)", color: "var(--mut)", width: phone ? undefined : 280 }}>
      <Ic n="search" />
      <span className="sr">{placeholder}</span>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" style={{ flex: 1, minWidth: 0, height: 36, border: 0, outline: "none", background: "transparent", fontSize: phone ? 16 : 14, color: "var(--fg)" }} />
    </label>
  );
}

function monthYear(value: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+05:30`) : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", month: "long", year: "numeric" }).format(d);
}

export function StaffScreen({
  rows,
  load,
  matrix: savedMatrix,
  roleCounts,
  events,
  sessionLabel,
  mayManage,
  isAdmin,
  mayEditMatrix,
  meId = null,
  initialView,
  initialId,
  initialSheet,
}: {
  rows: StaffRow[];
  load: Record<string, number[]>;
  matrix: Matrix;
  roleCounts: Record<StaffRole, number>;
  events: StaffEvent[];
  sessionLabel: string | null;
  mayManage: boolean;
  isAdmin: boolean;
  mayEditMatrix: boolean;
  meId?: string | null;
  initialView: "people" | "roles";
  initialId: string | null;
  initialSheet: SheetKind;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useState<"people" | "roles">(initialView);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [loginFilter, setLoginFilter] = useState<LoginFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [targetId, setTargetId] = useState<string | null>(initialId);
  const [sheet, setSheet] = useState<SheetKind>(initialSheet);
  const [edited, setEdited] = useState<Matrix>(savedMatrix);
  const [baseline, setBaseline] = useState<Matrix>(savedMatrix);
  const [created, setCreated] = useState<Created | null>(null);
  const [pending, start] = useTransition();

  // A row link (`/staff?id=`) re-renders the page with a new id: follow it.
  const [seenId, setSeenId] = useState<string | null>(initialId);
  if (initialId !== seenId) {
    setSeenId(initialId);
    setSelectedId(initialId);
    if (initialId) setTargetId(initialId);
  }

  // A new matrix from the server (after save) becomes the baseline.
  if (savedMatrix !== baseline) {
    setBaseline(savedMatrix);
    setEdited(savedMatrix);
  }

  const counts = useMemo(() => countStaff(rows), [rows]);
  const visible = useMemo(() => sortRows(rows.filter((r) => matchesRole(r, roleFilter) && matchesLogin(r, loginFilter) && matchesQuery(r, query))), [rows, roleFilter, loginFilter, query]);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const target = rows.find((r) => r.id === targetId) ?? selected;
  const changes = useMemo(() => diffMatrix(savedMatrix, edited), [savedMatrix, edited]);

  const go = (next: { view?: "people" | "roles"; id?: string | null }) => {
    const v = next.view ?? view;
    const id = next.id === undefined ? selectedId : next.id;
    if (next.view) setView(next.view);
    if (next.id !== undefined) {
      setSelectedId(next.id);
      if (next.id) setTargetId(next.id);
    }
    const qs = new URLSearchParams();
    if (v === "roles") qs.set("view", "roles");
    if (id && v === "people") qs.set("id", id);
    router.replace(`/staff${qs.size ? `?${qs}` : ""}`, { scroll: false });
  };

  const done = (result: StaffActionResult, after?: () => void) => {
    toast.show({ text: tx(result.message), tone: result.ok ? "ok" : "bad" });
    if (result.ok) {
      after?.();
      router.refresh();
    }
  };

  const openFor = (kind: SheetKind, id: string) => {
    setTargetId(id);
    setSheet(kind);
  };

  const enable = (row: StaffRow) => start(async () => done(await setLoginActiveAction({ staffId: row.id, active: true })));

  const isList = view === "people";
  const narrow = Boolean(selected);

  const header = (
    <TopBar
      crumb={isList ? `${tx(p("People", "लोग"))} · ${sessionLabel ? `${tx(p("Session", "सत्र"))} ${sessionLabel}` : tx(p("Staff", "स्टाफ़"))}` : `${tx(p("People", "लोग"))} · ${tx(p("Staff & roles", "स्टाफ़ व भूमिकाएँ"))}`}
      title={isList ? tx(p("Staff & roles", "स्टाफ़ व भूमिकाएँ")) : tx(p("Roles & permissions", "भूमिकाएँ व अनुमतियाँ"))}
      mTitle={isList && selected ? selected.name : undefined}
      mSub={
        isList
          ? selected
            ? tx(titleLine(selected))
            : `${counts.total} ${tx(p("staff", "स्टाफ़"))} · ${counts.withLogin} ${tx(p("with login", "लॉगिन वाले"))}`
          : `${MATRIX_ROLES.length} ${tx(p("roles", "भूमिकाएँ"))} · ${matrixGroups().reduce((n, g) => n + g.items.length, 0)} ${tx(p("permissions", "अनुमतियाँ"))}`
      }
      mBack={isList && selected ? "/staff" : "/menu"}
      actions={
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {isList ? <SearchField value={query} onChange={setQuery} placeholder={tx(p("Name, class or subject", "नाम, कक्षा या विषय"))} /> : null}
          {mayManage ? <Btn icon="plus" variant="sec" onClick={() => setSheet("add")}>{tx(p("Add staff", "स्टाफ़ जोड़ें"))}</Btn> : null}
          {isAdmin ? <Btn icon="userPlus" variant="pri" onClick={() => openFor("invite", rows.find((r) => r.isActive && !r.hasLogin)?.id ?? "")}>{tx(p("Create login", "लॉगिन बनाएँ"))}</Btn> : null}
          <HelpButton title={tx(p("Staff & roles", "स्टाफ़ व भूमिकाएँ"))} steps={[
            { icon: "users", title: tx(p("Find a person", "व्यक्ति खोजें")), body: tx(p("Search by name, class or subject. Tap a row to see their profile, timetable load and login.", "नाम, कक्षा या विषय से खोजें। प्रोफ़ाइल, पीरियड और लॉगिन देखने के लिए पंक्ति दबाएँ।")) },
            { icon: "key", title: tx(p("Logins", "लॉगिन")), body: tx(p("Create a login, reset a password or turn a login off. Records always stay.", "लॉगिन बनाएँ, पासवर्ड बदलें या लॉगिन बंद करें। रिकॉर्ड हमेशा रहते हैं।")) },
            { icon: "shield", title: tx(p("Roles", "भूमिकाएँ")), body: tx(p("Roles & permissions decides who can do what. Admin always has everything; teachers never see money.", "भूमिकाएँ तय करती हैं कि कौन क्या कर सकता है। प्रशासक के पास सब कुछ; अध्यापक फीस नहीं देखते।")) },
          ]} />
        </span>
      }
      mAction={
        isAdmin && !(isList && selected) ? (
          <Btn variant="soft" icon="userPlus" style={{ height: 40, padding: "0 12px", fontSize: 13 }} onClick={() => openFor("invite", rows.find((r) => r.isActive && !r.hasLogin)?.id ?? "")}>
            {tx(p("Add login", "लॉगिन जोड़ें"))}
          </Btn>
        ) : undefined
      }
    />
  );

  const tabs = (
    <Seg
      label={tx(p("Staff view", "स्टाफ़ दृश्य"))}
      value={view}
      onChange={(v) => go({ view: v, id: null })}
      options={[
        { value: "people", label: tx(p("People", "लोग")) },
        { value: "roles", label: tx(p("Roles & permissions", "भूमिकाएँ व अनुमतियाँ")) },
      ]}
      style={{ width: 380, maxWidth: "100%" }}
    />
  );

  const kpis: { key: LoginFilter; label: Pair; value: number; sub: string; tone: string }[] = [
    { key: "all", label: p("Staff", "स्टाफ़"), value: counts.total, sub: `${counts.teachers} ${tx(p("teachers", "अध्यापक"))} · ${counts.office} ${tx(p("office", "कार्यालय"))}`, tone: "var(--fg)" },
    { key: "with_login", label: p("With login", "लॉगिन वाले"), value: counts.withLogin, sub: `${counts.active} ${tx(p("active", "सक्रिय"))}`, tone: "var(--fg)" },
    { key: "never", label: p("Never signed in", "कभी लॉगिन नहीं"), value: counts.never, sub: tx(p("Send the login again", "लॉगिन फिर दें")), tone: "var(--warnfg)" },
    { key: "disabled", label: p("Disabled", "बंद"), value: counts.disabled, sub: tx(p("Records are kept", "रिकॉर्ड रहते हैं")), tone: "var(--bad)" },
  ];

  const loginSub = (r: StaffRow): string => {
    const state = loginState(r);
    if (state === "active") return r.lastSignInAt ? `${tx(p("Last seen", "आख़िरी बार"))} ${tx(agoP(r.lastSignInAt))}` : tx(p("Active", "चालू"));
    if (state === "never") return tx(p("Made, not used yet", "बना, अभी उपयोग नहीं"));
    if (state === "disabled") {
      const off = events.find((e) => e.staffId === r.id && e.kind === "disabled");
      return off ? `${tx(p("Since", "से"))} ${shortDay(off.at)}` : tx(p("Records are kept", "रिकॉर्ड रहते हैं"));
    }
    return tx(p("Not set up", "नहीं बना"));
  };

  const rowActions = (r: StaffRow) => {
    if (!isAdmin) return null;
    const state = loginState(r);
    if (state === "disabled")
      return <Btn variant="soft" icon="refresh" style={{ height: 34, padding: "0 12px", fontSize: 13 }} onClick={() => enable(r)} disabled={pending} ariaLabel={`${tx(p("Turn the login back on for", "लॉगिन फिर चालू करें:"))} ${r.name}`}>{tx(p("Enable", "चालू"))}</Btn>;
    if (state === "none")
      return <Btn variant="soft" icon="userPlus" style={{ height: 34, padding: "0 12px", fontSize: 13 }} onClick={() => openFor("invite", r.id)} ariaLabel={`${tx(p("Create a login for", "लॉगिन बनाएँ:"))} ${r.name}`}>{tx(p("Create login", "लॉगिन बनाएँ"))}</Btn>;
    return <Btn variant="ghost" icon="key" style={{ height: 34, padding: "0 10px", fontSize: 13 }} onClick={() => openFor("reset", r.id)} ariaLabel={`${tx(p("Reset password for", "पासवर्ड बदलें:"))} ${r.name}`} />;
  };

  const tracks = narrow ? "minmax(0,1fr) 156px" : "minmax(200px,1.5fr) minmax(150px,1.1fr) minmax(140px,1.1fr) 168px 104px";

  const personCell = (r: StaffRow, phone: boolean) => (
    <Link href={`/staff?id=${r.id}`} scroll={false} onClick={(e) => { e.preventDefault(); go({ id: r.id }); }} className="tap" style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, minHeight: 44, color: "var(--fg)" }} aria-current={r.id === selectedId ? "true" : undefined}>
      <Av name={r.name} seed={r.id} />
      <span style={{ ...S.col, minWidth: 0 }}>
        <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</span>
        <span className="clip num" style={S.sub}>{phone ? rolePills(r).map((x) => tx(x.label)).join(" · ") : maskPhone(r.phone)}</span>
      </span>
    </Link>
  );

  const loginPill = (r: StaffRow) => {
    const state = loginState(r);
    const [bg, fg] = LOGIN_TONE[state];
    return <Pill bg={bg} fg={fg} dot>{tx(LOGIN_LABELS[state])}</Pill>;
  };

  const peopleList = (
    <section className={`pad${narrow ? " hide-m" : ""}`} style={{ padding: "20px 28px 40px", ...S.col, gap: 14, minWidth: 0 }}>
      {tabs}
      <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12 }}>
        {kpis.map((k, i) => {
          const on = loginFilter === k.key;
          return (
            <button key={k.key} type="button" aria-pressed={on} onClick={() => setLoginFilter(k.key)} className="tap card rise" style={{ ...S.col, padding: "14px 16px", gap: 2, textAlign: "left", color: "var(--fg)", borderColor: on && k.key !== "all" ? "var(--acc)" : "var(--bd)", animationDelay: `${i * 26}ms` }}>
              <span style={{ ...S.sub, fontWeight: 600 }}>{tx(k.label)}</span>
              <span className="num" style={{ fontSize: 24, fontWeight: 700, color: k.tone }}>{k.value}</span>
              <span style={S.sub}>{k.sub}</span>
            </button>
          );
        })}
      </div>
      <div className="only-m">
        <SearchField value={query} onChange={setQuery} placeholder={tx(p("Name, class or subject", "नाम, कक्षा या विषय"))} phone />
      </div>
      <div className="hs" role="group" aria-label={tx(p("Filter staff", "स्टाफ़ छाँटें"))} style={{ display: "flex", gap: 6 }}>
        {ROLE_FILTERS.map((f) => (
          <button key={f} type="button" className={`tap chip${roleFilter === f ? " on" : ""}`} aria-pressed={roleFilter === f} onClick={() => setRoleFilter(f)}>
            {tx(ROLE_FILTER_LABELS[f])}
            <span className="num" style={{ opacity: 0.65 }}>{rows.filter((r) => matchesRole(r, f)).length}</span>
          </button>
        ))}
        <span aria-hidden="true" style={{ flex: "none", width: 1, background: "var(--bd)", margin: "4px 2px" }} />
        {LOGIN_FILTERS.map((f) => (
          <button key={f} type="button" className={`tap chip${loginFilter === f ? " on" : ""}`} aria-pressed={loginFilter === f} onClick={() => setLoginFilter(f)}>
            {tx(LOGIN_FILTER_LABELS[f])}
            <span className="num" style={{ opacity: 0.65 }}>{rows.filter((r) => matchesLogin(r, f)).length}</span>
          </button>
        ))}
      </div>
      {visible.length ? (
        <div className="card" style={{ overflow: "hidden" }} role="table" aria-label={tx(p("Staff", "स्टाफ़"))}>
          <div role="row" className="only-d" style={{ display: "grid", gridTemplateColumns: tracks, gap: 10, alignItems: "center", minHeight: 42, padding: "8px 16px", background: "var(--s2)", borderBottom: "1px solid var(--bd)" }}>
            <span role="columnheader" className="sech">{tx(p("Person", "व्यक्ति"))}</span>
            {narrow ? null : <span role="columnheader" className="sech">{tx(p("Roles", "भूमिकाएँ"))}</span>}
            {narrow ? null : <span role="columnheader" className="sech">{tx(p("Classes · subjects", "कक्षाएँ · विषय"))}</span>}
            <span role="columnheader" className="sech">{tx(p("Login", "लॉगिन"))}</span>
            {narrow ? null : <span role="columnheader" className="sech" style={{ textAlign: "right" }}>{tx(p("Actions", "काम"))}</span>}
          </div>
          {visible.map((r, i) => (
            <div key={r.id} role="row" className={`row${r.id === selectedId ? " sel" : ""}`} style={{ borderTop: i ? "1px solid var(--bd)" : 0, animation: `xIn .32s var(--ease) ${Math.min(i, 14) * 26}ms both` }}>
              <div className="only-d" style={{ display: "grid", gridTemplateColumns: tracks, gap: 10, alignItems: "center", minHeight: 62, padding: "8px 16px" }}>
                <span role="cell" style={{ minWidth: 0 }}>{personCell(r, false)}</span>
                {narrow ? null : (
                  <span role="cell" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {rolePills(r).map((x) => <Pill key={x.key} bg={x.bg} fg={x.fg}>{tx(x.label)}</Pill>)}
                  </span>
                )}
                {narrow ? null : <span role="cell" className="clip" style={{ fontSize: 13 }}>{tx(worksOn(r))}</span>}
                <span role="cell" style={{ ...S.col, gap: 2, alignItems: "flex-start" }}>
                  {loginPill(r)}
                  <span style={S.sub}>{loginSub(r)}</span>
                </span>
                {narrow ? null : <span role="cell" style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>{rowActions(r)}</span>}
              </div>
              <div className="only-m" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center", padding: "10px 14px" }}>
                {personCell(r, true)}
                {loginPill(r)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card fadein" style={{ ...S.col, padding: "40px 24px", alignItems: "center", gap: 10, textAlign: "center" }}>
          <span style={{ width: 56, height: 56, borderRadius: 28, background: "var(--s2)", color: "var(--mut)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ic n="users" size={26} />
          </span>
          <strong style={{ fontSize: 16 }}>{tx(p("No one matches", "कोई नहीं मिला"))}</strong>
          <span style={{ color: "var(--mut)", fontSize: 13 }}>{tx(p("Try another name, or clear the filters.", "दूसरा नाम आज़माएँ, या छँटाई हटाएँ।"))}</span>
          <Btn onClick={() => { setQuery(""); setRoleFilter("all"); setLoginFilter("all"); }}>{tx(p("Show all staff", "सारा स्टाफ़ दिखाएँ"))}</Btn>
        </div>
      )}
    </section>
  );

  return (
    <VxPage>
      {header}
      <div className="vx-pmain">
        {isList ? (
          <div className="stack" style={{ display: "grid", gridTemplateColumns: selected ? "minmax(0,1fr) 440px" : "minmax(0,1fr)", alignItems: "start", minHeight: "100%" }}>
            {peopleList}
            {selected ? (
              <aside className="unstick" style={{ position: "sticky", top: 64, height: "calc(100dvh - 64px)", overflowY: "auto", borderLeft: "1px solid var(--bd)", background: "var(--bg)", animation: "xPush .36s var(--ease) both" }}>
                <ProfilePanel
                  row={selected}
                  load={load[selected.id] ?? [0, 0, 0, 0, 0, 0]}
                  events={events.filter((e) => e.staffId === selected.id)}
                  isAdmin={isAdmin}
                  isMe={selected.id === meId}
                  onClose={() => go({ id: null })}
                  onReset={() => openFor("reset", selected.id)}
                  onDisable={() => openFor("deactivate", selected.id)}
                  onRole={() => openFor("role", selected.id)}
                  onInvite={() => openFor("invite", selected.id)}
                  onEnable={() => enable(selected)}
                  onSelf={() => toast.show({ text: tx(p("You can’t disable your own login", "अपना लॉगिन बंद नहीं कर सकते")), tone: "info" })}
                  pending={pending}
                />
              </aside>
            ) : null}
          </div>
        ) : (
          <RolesView
            tabs={tabs}
            saved={savedMatrix}
            edited={edited}
            roleCounts={roleCounts}
            events={events}
            editable={mayEditMatrix}
            onToggle={(role, perm) => setEdited((m) => toggle(m, role, perm))}
            onLocked={(text) => toast.show({ text, tone: "info" })}
            changes={changes.map(describeChange)}
            changeCount={changes.length}
            pending={pending}
            onDiscard={() => {
              setEdited(savedMatrix);
              toast.show({ text: tx(p("Changes discarded", "बदलाव हटाए")), tone: "info" });
            }}
            onSave={() => start(async () => done(await saveMatrixAction(changes)))}
          />
        )}
      </div>

      <InviteSheet
        open={sheet === "invite"}
        onClose={() => setSheet(null)}
        rows={rows}
        preselect={target && !target.hasLogin ? target.id : null}
        pending={pending}
        onSubmit={(input) =>
          start(async () => {
            const result = await createLoginAction(input);
            if (result.ok) {
              const person = rows.find((r) => r.id === input.staffId);
              setCreated({ kind: "login", name: person?.name ?? "", username: result.username, password: result.password, role: input.role as StaffRole, staffId: result.staffId });
              setSheet("created");
              router.refresh();
            } else done(result);
          })
        }
      />
      <CreatedSheet
        open={sheet === "created"}
        onClose={() => setSheet(null)}
        created={created}
        onOpen={() => {
          setSheet(null);
          if (created?.staffId) go({ view: "people", id: created.staffId });
        }}
      />
      {target ? (
        <>
          <ResetSheet
            open={sheet === "reset"}
            onClose={() => setSheet(null)}
            row={target}
            pending={pending}
            onConfirm={() =>
              start(async () => {
                const result = await resetPasswordAction(target.id);
                if (result.ok) {
                  setCreated({ kind: "reset", name: target.name, username: result.username, password: result.password, role: target.role, staffId: target.id });
                  setSheet("created");
                } else done(result);
              })
            }
          />
          <DisableSheet
            open={sheet === "deactivate"}
            onClose={() => setSheet(null)}
            row={target}
            pending={pending}
            onConfirm={(reason) => start(async () => done(await setLoginActiveAction({ staffId: target.id, active: false, reason }), () => setSheet(null)))}
          />
          <RoleSheet
            open={sheet === "role"}
            onClose={() => setSheet(null)}
            row={target}
            matrix={savedMatrix}
            pending={pending}
            onConfirm={(role) => start(async () => done(await changeRoleAction({ staffId: target.id, role }), () => setSheet(null)))}
          />
        </>
      ) : null}
      <AddStaffSheet
        open={sheet === "add"}
        onClose={() => setSheet(null)}
        isAdmin={isAdmin}
        pending={pending}
        onSubmit={(input) =>
          start(async () => {
            const result = await addStaffAction(input);
            done(result, () => {
              setSheet(null);
              if (result.ok && result.staffId) go({ view: "people", id: result.staffId });
            });
          })
        }
      />
    </VxPage>
  );
}

/* ------------------------------------------------------------- profile */

function ProfilePanel({
  row,
  load,
  events,
  isAdmin,
  isMe,
  onClose,
  onReset,
  onDisable,
  onRole,
  onInvite,
  onEnable,
  onSelf,
  pending,
}: {
  row: StaffRow;
  load: number[];
  events: StaffEvent[];
  isAdmin: boolean;
  isMe: boolean;
  onClose: () => void;
  onReset: () => void;
  onDisable: () => void;
  onRole: () => void;
  onInvite: () => void;
  onEnable: () => void;
  onSelf: () => void;
  pending: boolean;
}) {
  const { tx } = useVx();
  const state = loginState(row);
  const [lbg, lfg] = LOGIN_TONE[state];
  const total = load.reduce((a, b) => a + b, 0);
  const top = Math.max(8, ...load);
  const who = shortName(row.name);
  const pr = pronouns(row.name);
  const off = events.find((e) => e.kind === "disabled");
  const notes: Partial<Record<LoginState, [Pair, string, string]>> = {
    never: [p(`${who} has never signed in. Reset the password to make a fresh one to hand over.`, `${who} ने कभी लॉगिन नहीं किया। नया पासवर्ड बनाकर दें।`), "var(--warns)", "var(--warnfg)"],
    disabled: [
      p(
        `Disabled${off?.actor ? ` by ${off.actor}` : ""}${off ? ` · ${tx(off.text).replace(/^Login disabled( · )?/, "") || "no reason given"}` : ""}. ${pr.they} can’t sign in; ${pr.their} records stay.`,
        `लॉगिन बंद${off?.actor ? ` · ${off.actor}` : ""}। लॉगिन नहीं कर सकते; रिकॉर्ड रहते हैं।`,
      ),
      "var(--bads)",
      "var(--bad)",
    ],
    none: [p(`No login yet, so ${who} can’t open VPPS One.`, `अभी लॉगिन नहीं है, इसलिए ${who} VPPS One नहीं खोल सकते।`), "var(--infos)", "var(--info)"],
  };
  const note = notes[state];
  const facts: { icon: IconName; k: Pair; v: string }[] = [
    { icon: "phone", k: p("Phone", "फ़ोन"), v: maskPhone(row.phone) },
    { icon: "book", k: p("Works on", "काम"), v: tx(worksOn(row)) },
    { icon: "calendar", k: p("Joined", "जुड़े"), v: monthYear(row.joinedAt) },
  ];
  const log: { key: string; text: string; time: string; dot: string }[] = [
    ...events.slice(0, 6).map((e) => ({
      key: e.id,
      text: `${tx(e.text)}${e.actor ? ` · ${tx(p("by", "द्वारा"))} ${e.actor.split(" ")[0]}` : ""}`,
      time: shortDay(e.at),
      dot: e.kind === "disabled" ? "var(--bad)" : e.kind === "enabled" ? "var(--ok)" : "var(--warn)",
    })),
    { key: "joined", text: tx(p("Added to the staff list", "स्टाफ़ सूची में जोड़े गए")), time: shortDay(row.joinedAt), dot: "var(--acc)" },
  ];

  return (
    <div style={{ padding: "18px 22px 28px", ...S.col, gap: 14 }}>
      <div className="only-d" style={{ ...S.row, justifyContent: "space-between" }}>
        <span className="sech">{tx(p("Staff profile", "स्टाफ़ प्रोफ़ाइल"))}</span>
        <button type="button" className="tap btn ghost" aria-label={tx(p("Close profile", "प्रोफ़ाइल बंद करें"))} onClick={onClose} style={{ width: 40, height: 40, padding: 0 }}>
          <Ic n="x" />
        </button>
      </div>
      <div style={{ ...S.row, gap: 14 }}>
        <Av name={row.name} seed={row.id} size={60} font={20} serif />
        <span style={{ ...S.col, flex: 1, minWidth: 0, gap: 4 }}>
          <span className="serif" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.15 }}>{row.name}</span>
          <span style={S.sub}>{tx(titleLine(row))}</span>
          <span style={{ ...S.row, flexWrap: "wrap", gap: 4 }}>
            {rolePills(row).map((x) => <Pill key={x.key} bg={x.bg} fg={x.fg}>{tx(x.label)}</Pill>)}
          </span>
        </span>
      </div>
      <div className="card" style={{ ...S.col, padding: "2px 16px" }}>
        {facts.map((f, i) => (
          <div key={f.icon} style={{ ...S.row, gap: 10, padding: "10px 0", borderTop: i ? "1px solid var(--bd)" : 0 }}>
            <Ic n={f.icon} style={{ color: "var(--mut)" }} />
            <span style={{ ...S.sub, width: 92, flex: "none" }}>{tx(f.k)}</span>
            <span className="num clip" style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>{f.v}</span>
          </div>
        ))}
      </div>
      {row.isTeaching ? (
        <div className="card" style={{ ...S.col, padding: "14px 16px", gap: 10 }}>
          <div style={{ ...S.row, justifyContent: "space-between" }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(p("Timetable load", "पीरियड भार"))}</span>
            <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>{total} {tx(p("of 48 periods", "/ 48 पीरियड"))}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 8, alignItems: "end", height: 64 }}>
            {load.map((n, i) => (
              <div key={i} title={`${n}`} style={{ ...S.col, height: "100%", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
                <span style={{ width: "100%", maxWidth: 28, height: `${Math.round((n / top) * 100)}%`, minHeight: n ? 4 : 0, borderRadius: "6px 6px 2px 2px", background: "var(--c2)", transformOrigin: "bottom", animation: `xGrowY .5s var(--ease) ${i * 50}ms both` }} />
                <span style={{ fontSize: 11, color: "var(--mut)" }}>{DAYS[i]}</span>
              </div>
            ))}
          </div>
          <Link href={`/timetable?view=teacher&teacher=${row.id}`} style={{ ...S.row, gap: 6, paddingTop: 10, borderTop: "1px solid var(--bd)", color: "var(--acc)", fontWeight: 600, fontSize: 13 }}>
            {tx(p("Open their timetable", "उनकी समय सारणी खोलें"))} <Ic n="chevRight" size={14} />
          </Link>
        </div>
      ) : null}
      <div className="card" style={{ ...S.col, padding: "14px 16px", gap: 10 }}>
        <div style={{ ...S.row, gap: 10 }}>
          <span style={{ flex: "none", width: 38, height: 38, borderRadius: 12, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ic n="key" />
          </span>
          <span style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>{tx(p("Login", "लॉगिन"))}</span>
          <Pill bg={lbg} fg={lfg}>{tx(LOGIN_LABELS[state])}</Pill>
        </div>
        {row.hasLogin ? (
          <>
            <div style={{ ...S.row, justifyContent: "space-between", gap: 10, fontSize: 13 }}>
              <span style={{ color: "var(--mut)" }}>{tx(p("Username", "यूज़रनेम"))}</span>
              <span className="num clip" style={{ fontWeight: 600, textAlign: "right" }}>{row.email ?? "—"}</span>
            </div>
            <div style={{ ...S.row, justifyContent: "space-between", gap: 10, fontSize: 13 }}>
              <span style={{ color: "var(--mut)" }}>{tx(p("Last sign-in", "आख़िरी लॉगिन"))}</span>
              <span className="num" style={{ fontWeight: 600, textAlign: "right" }}>{row.lastSignInAt ? tx(agoP(row.lastSignInAt)) : tx(p("Never", "कभी नहीं"))}</span>
            </div>
          </>
        ) : null}
        {note ? (
          <div style={{ ...S.note, background: note[1], color: note[2] }}>
            <Ic n="info" style={{ marginTop: 1 }} />
            <span>{tx(note[0])}</span>
          </div>
        ) : null}
        {isAdmin ? (
          <div style={{ ...S.row, flexWrap: "wrap", gap: 8 }}>
            {state === "none" ? <Btn icon="userPlus" variant="pri" style={{ flex: "1 1 auto" }} onClick={onInvite}>{tx(p("Create login", "लॉगिन बनाएँ"))}</Btn> : null}
            {state === "disabled" ? <Btn icon="refresh" variant="pri" style={{ flex: "1 1 auto" }} onClick={onEnable} disabled={pending}>{tx(p("Enable login", "लॉगिन चालू करें"))}</Btn> : null}
            {state === "active" || state === "never" ? <Btn icon="key" style={{ flex: "1 1 auto" }} onClick={onReset}>{tx(p("Reset password", "पासवर्ड बदलें"))}</Btn> : null}
            <Btn icon="shield" style={{ flex: "1 1 auto" }} onClick={onRole}>{tx(p("Change role", "भूमिका बदलें"))}</Btn>
            {state === "active" || state === "never" ? (
              <Btn icon="lock" variant="ghost" style={{ flex: "1 1 auto" }} onClick={isMe ? onSelf : onDisable}>{tx(p("Disable login", "लॉगिन बंद करें"))}</Btn>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="card" style={{ ...S.col, padding: "14px 16px" }}>
        <span className="sech" style={{ marginBottom: 6 }}>{tx(p("Activity", "गतिविधि"))}</span>
        {log.map((l, i) => (
          <div key={l.key} className="fadein" style={{ display: "grid", gridTemplateColumns: "12px minmax(0,1fr) auto", gap: 10, padding: "7px 0", animationDelay: `${i * 50}ms` }}>
            <span style={{ width: 10, height: 10, marginTop: 4, borderRadius: 5, background: l.dot }} />
            <span style={{ fontSize: 13 }}>{l.text}</span>
            <span className="num" style={S.sub}>{l.time}</span>
          </div>
        ))}
      </div>
      <Link href={`/staff/${row.id}`} style={{ color: "var(--acc)", fontWeight: 600, fontSize: 13, display: "inline-flex", gap: 6, alignItems: "center" }}>
        {tx(p("Full profile, cover policy & edit", "पूरी प्रोफ़ाइल, सब्स्टिट्यूट नियम व सुधार"))} <Ic n="chevRight" size={14} />
      </Link>
    </div>
  );
}

/* --------------------------------------------------------------- roles */

function RolesView({
  tabs,
  saved,
  edited,
  roleCounts,
  events,
  editable,
  onToggle,
  onLocked,
  changes,
  changeCount,
  pending,
  onDiscard,
  onSave,
}: {
  tabs: ReactNode;
  saved: Matrix;
  edited: Matrix;
  roleCounts: Record<StaffRole, number>;
  events: StaffEvent[];
  editable: boolean;
  onToggle: (role: StaffRole, permission: StaffPermission) => void;
  onLocked: (text: string) => void;
  changes: Pair[];
  changeCount: number;
  pending: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const { tx } = useVx();
  const [open, setOpen] = useState<string | null>(null);
  const [mrole, setMrole] = useState<StaffRole>("teacher");
  const groups = matrixGroups();
  const cols = `minmax(210px,1.8fr) repeat(${MATRIX_ROLES.length}, minmax(64px,1fr))`;

  const cell = (role: StaffRole, permission: StaffPermission, label: Pair) => {
    const lock = cellLock(role, permission);
    const on = lock === "admin" ? true : has(edited, role, permission);
    const changed = on !== (lock === "admin" ? true : has(saved, role, permission));
    const why = lock === "admin" ? p("Admin always has every permission", "प्रशासक के पास हर अनुमति रहती है") : lock === "teacher_money" ? p("Teachers never see fee amounts", "अध्यापक फीस की रक़म नहीं देखते") : null;
    const flip = () => {
      if (why) return onLocked(tx(why));
      if (!editable) return onLocked(tx(p("Only an administrator can change this.", "इसे केवल प्रशासक बदल सकते हैं।")));
      onToggle(role, permission);
    };
    return { on, changed, lock: Boolean(why), tip: why ? tx(why) : `${tx(label)} · ${tx(ROLE_LABELS[role])}`, aria: `${tx(label)} for ${tx(ROLE_LABELS[role])}`, flip };
  };

  const recent = events.slice(0, 4);

  return (
    <div style={{ ...S.col, minHeight: "100%" }}>
      <div className="pad" style={{ flex: 1, padding: "20px 28px 28px", ...S.col, gap: 14 }}>
        {tabs}
        <div style={{ ...S.note, background: "var(--infos)", color: "var(--info)" }}>
          <Ic n="shield" style={{ marginTop: 1 }} />
          <span>
            <b>{tx(p("Who can do what.", "कौन क्या कर सकता है।"))}</b>{" "}
            {tx(p("Admin always has everything. Teachers never see fee amounts, so the Money rows stay off for them. Tap a permission name to see what it means.", "प्रशासक के पास सब कुछ रहता है। अध्यापक फीस की रक़म नहीं देखते, इसलिए फीस की पंक्तियाँ उनके लिए बंद रहती हैं। मतलब देखने के लिए अनुमति का नाम दबाएँ।"))}
            {editable ? "" : ` ${tx(p("Only an administrator can change this.", "इसे केवल प्रशासक बदल सकते हैं।"))}`}
          </span>
        </div>

        <div className="only-d card" style={{ overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 4, alignItems: "center", padding: "4px 12px 4px 16px", minHeight: 58, background: "var(--s2)", borderBottom: "1px solid var(--bd)" }}>
            <span className="sech">{tx(p("Permission", "अनुमति"))}</span>
            {MATRIX_ROLES.map((role) => (
              <span key={role} style={{ ...S.col, alignItems: "center", textAlign: "center", lineHeight: 1.2 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{tx(ROLE_LABELS[role])}</span>
                <span className="num" style={{ fontSize: 11, color: "var(--mut)" }}>{tx(people(roleCounts[role] ?? 0))}</span>
              </span>
            ))}
          </div>
          {groups.map((group, gi) => (
            <div key={group.key}>
              <div style={{ ...S.row, gap: 8, padding: "12px 16px 6px", borderTop: gi ? "1px solid var(--bd)" : 0 }}>
                <span className="sech" style={{ color: "var(--fg)" }}>{tx(group.title)}</span>
                {group.note ? <span style={S.sub}>{tx(group.note)}</span> : null}
              </div>
              {group.items.map((item) => (
                <div key={item.key} className="row" style={{ display: "grid", gridTemplateColumns: cols, gap: 4, alignItems: "center", padding: "4px 12px 4px 16px" }}>
                  <button type="button" className="tap" aria-expanded={open === item.key} title={tx(item.help)} onClick={() => setOpen(open === item.key ? null : item.key)} style={{ ...S.col, border: 0, background: "transparent", color: "var(--fg)", textAlign: "left", padding: "6px 0" }}>
                    <span style={{ ...S.row, gap: 6, fontSize: 14, fontWeight: 600 }}>
                      {tx(item.label)}
                      <Ic n="help" size={14} style={{ color: "var(--sub)" }} />
                    </span>
                    {open === item.key ? <span className="fadein" style={S.sub}>{tx(item.help)}</span> : null}
                  </button>
                  {MATRIX_ROLES.map((role) => {
                    const c = cell(role, item.key, item.label);
                    return (
                      <button key={role} type="button" role="switch" aria-checked={c.on} aria-disabled={c.lock || !editable} aria-label={c.aria} title={c.tip} onClick={c.flip} className="tap" style={{ height: 42, border: 0, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: c.changed ? "var(--warns)" : "transparent", boxShadow: c.changed ? "inset 0 0 0 2px var(--warn)" : "none", transition: "background-color .25s ease, box-shadow .25s ease" }}>
                        <span className={`sw${c.on ? " on" : ""}`} style={{ opacity: c.lock ? 0.4 : 1 }}>
                          <span />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="only-m" style={{ ...S.col, gap: 12 }}>
          <div className="hs" style={{ display: "flex", gap: 6 }}>
            {MATRIX_ROLES.map((role) => (
              <button key={role} type="button" className={`tap chip${mrole === role ? " on" : ""}`} aria-pressed={mrole === role} onClick={() => setMrole(role)}>
                {tx(ROLE_LABELS[role])}
              </button>
            ))}
          </div>
          <span style={S.sub}>
            {tx(ROLE_LABELS[mrole])} · {tx(people(roleCounts[mrole] ?? 0))} · {tx(ROLE_HELP[mrole])}
          </span>
          {groups.map((group) => (
            <div key={group.key} style={{ ...S.col, gap: 12 }}>
              <span className="sech" style={{ marginTop: 4 }}>{tx(group.title)}</span>
              <div className="card" style={{ overflow: "hidden" }}>
                {group.items.map((item, i) => {
                  const c = cell(mrole, item.key, item.label);
                  return (
                    <button key={item.key} type="button" role="switch" aria-checked={c.on} aria-disabled={c.lock || !editable} aria-label={c.aria} onClick={c.flip} className="tap" style={{ ...S.row, width: "100%", gap: 12, padding: "12px 14px", border: 0, borderTop: i ? "1px solid var(--bd)" : 0, background: c.changed ? "var(--warns)" : "transparent", color: "var(--fg)", textAlign: "left", transition: "background-color .25s ease" }}>
                      <span style={{ ...S.col, flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(item.label)}</span>
                        <span style={S.sub}>{tx(item.help)}</span>
                      </span>
                      <span className={`sw${c.on ? " on" : ""}`} style={{ opacity: c.lock ? 0.4 : 1 }}>
                        <span />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="card" style={{ ...S.col, padding: "14px 16px" }}>
          <div style={{ ...S.row, gap: 8, marginBottom: 6 }}>
            <span className="sech" style={{ flex: 1 }}>{tx(p("Recent changes", "हाल के बदलाव"))}</span>
            <span style={S.sub}>{tx(p("Only Admin can change permissions", "अनुमतियाँ केवल प्रशासक बदलते हैं"))}</span>
          </div>
          {recent.length === 0 ? <span style={{ ...S.sub, padding: "7px 0" }}>{tx(p("No role or login changes yet.", "अभी कोई बदलाव नहीं।"))}</span> : null}
          {recent.map((e, i) => (
            <div key={e.id} className="fadein" style={{ display: "grid", gridTemplateColumns: "12px minmax(0,1fr) auto", gap: 10, padding: "7px 0", animationDelay: `${i * 50}ms` }}>
              <span style={{ width: 10, height: 10, marginTop: 4, borderRadius: 5, background: e.kind === "disabled" ? "var(--bad)" : e.kind === "enabled" ? "var(--ok)" : "var(--acc)" }} />
              <span style={{ fontSize: 13 }}>{e.actor ? `${e.actor.split(" ")[0]} · ` : ""}{tx(e.text)}</span>
              <span className="num" style={S.sub}>{shortDay(e.at)}</span>
            </div>
          ))}
        </div>
      </div>
      {changeCount > 0 ? (
        <>
          <SaveBar className="only-d" bottom="0px" pad="12px 28px" count={changeCount} summary={changes.slice(0, 3).map((c) => tx(c)).join(" · ")} pending={pending} onDiscard={onDiscard} onSave={onSave} />
          <SaveBar className="only-m" bottom="var(--vx-bottom-h)" pad="12px 16px" count={changeCount} summary={changes.slice(0, 3).map((c) => tx(c)).join(" · ")} pending={pending} onDiscard={onDiscard} onSave={onSave} />
        </>
      ) : null}
    </div>
  );
}

function SaveBar({ className, bottom, pad, count, summary, pending, onDiscard, onSave }: { className: string; bottom: string; pad: string; count: number; summary: string; pending: boolean; onDiscard: () => void; onSave: () => void }) {
  const { tx } = useVx();
  return (
    <div className={`glass fadein ${className}`} role="status" style={{ position: "sticky", bottom, zIndex: 4, display: "flex", alignItems: "center", gap: 10, padding: pad, borderTop: "1px solid var(--bd)" }}>
      <span className="num" style={{ flex: "none", width: 32, height: 32, borderRadius: 16, background: "var(--warn)", color: "var(--onsolid)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, animation: "xPopIn .4s var(--spring) both" }}>{count}</span>
      <span style={{ ...S.col, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{count} {count === 1 ? tx(p("change", "बदलाव")) : tx(p("changes", "बदलाव"))}</span>
        <span className="clip" style={S.sub}>{tx(p("Not saved yet", "अभी सहेजा नहीं"))} · {summary}</span>
      </span>
      <Btn variant="ghost" onClick={onDiscard}>{tx(p("Discard", "हटाएँ"))}</Btn>
      <Btn variant="pri" icon="check" style={{ padding: "0 20px" }} onClick={onSave} disabled={pending}>{tx(p("Save", "सहेजें"))}</Btn>
    </div>
  );
}

/* -------------------------------------------------------------- sheets */

function TargetCard({ row }: { row: StaffRow }) {
  const { tx } = useVx();
  return (
    <div style={{ ...S.row, gap: 12, padding: "10px 14px", borderRadius: 14, background: "var(--s2)" }}>
      <Av name={row.name} seed={row.id} />
      <span style={{ ...S.col, flex: 1, minWidth: 0 }}>
        <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{row.name}</span>
        <span className="clip num" style={S.sub}>{tx(titleLine(row))} · {maskPhone(row.phone)}</span>
      </span>
    </div>
  );
}

/** The one-time password, before it exists: it is made on the server when the button is pressed. */
function PasswordSlot({ note }: { note: string }) {
  const { tx } = useVx();
  return (
    <>
      <span className="sech">{tx(p("Temporary password", "अस्थायी पासवर्ड"))}</span>
      <div style={{ ...S.row, gap: 4, minHeight: 56, padding: "8px 8px 8px 16px", borderRadius: 14, border: "1.5px dashed var(--bds)", background: "var(--card)" }}>
        <span className="num" style={{ flex: 1, fontSize: 20, fontWeight: 700, letterSpacing: ".06em" }}>••••-••••</span>
        <Ic n="lock" style={{ color: "var(--sub)", marginRight: 10 }} />
      </div>
      <span style={S.sub}>{note}</span>
    </>
  );
}

function InviteSheet({
  open,
  onClose,
  rows,
  preselect,
  pending,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  rows: StaffRow[];
  preselect: string | null;
  pending: boolean;
  onSubmit: (input: { staffId: string; email: string; role: string }) => void;
}) {
  const { tx } = useVx();
  const candidates = sortRows(rows.filter((r) => r.isActive && !r.hasLogin));
  const [staffId, setStaffId] = useState<string>("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("");
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const first = preselect ?? candidates[0]?.id ?? "";
      setStaffId(first);
      setRole(rows.find((r) => r.id === first)?.role ?? "teacher");
      setEmail("");
    }
  }
  const person = rows.find((r) => r.id === staffId);
  const pr = pronouns(person?.name ?? "");
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(p("Create a login", "लॉगिन बनाएँ"))}
      sub={tx(p("For staff who don’t have one yet", "जिनका अभी लॉगिन नहीं है"))}
      footer={<Foot sec={tx(p("Cancel", "रद्द करें"))} onSec={onClose} label={tx(p("Create login", "लॉगिन बनाएँ"))} icon="userPlus" disabled={pending || !staffId || !email} onGo={() => onSubmit({ staffId, email, role })} />}
    >
      {candidates.length === 0 ? (
        <div style={{ ...S.col, alignItems: "center", gap: 10, textAlign: "center", padding: "24px 0" }}>
          <Ic n="checkCircle" size={30} style={{ color: "var(--ok)" }} />
          <strong>{tx(p("Everyone has a login", "सबका लॉगिन है"))}</strong>
          <span style={{ color: "var(--mut)" }}>{tx(p("Add a staff member first, then create their login.", "पहले स्टाफ़ जोड़ें, फिर लॉगिन बनाएँ।"))}</span>
        </div>
      ) : (
        <div style={{ ...S.col, gap: 12, paddingTop: 4 }}>
          <span className="sech">{tx(p("Who gets the login", "लॉगिन किसे"))}</span>
          <div role="radiogroup" aria-label={tx(p("Who gets the login", "लॉगिन किसे"))} style={{ ...S.col, gap: 8 }}>
            {candidates.map((r) => (
              <Opt key={r.id} on={r.id === staffId} onPick={() => { setStaffId(r.id); setRole(r.role); }}>
                <span aria-hidden="true" style={{ flex: "none", width: 34, height: 34, borderRadius: 17, background: "var(--s3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{initials(r.name)}</span>
                <span style={{ ...S.col, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</span>
                  <span style={S.sub}>{tx(titleLine(r))}</span>
                </span>
              </Opt>
            ))}
          </div>
          <label style={{ ...S.row, gap: 12, padding: "10px 14px", borderRadius: 14, background: "var(--s2)" }}>
            <Ic n="mail" style={{ color: "var(--mut)" }} />
            <span style={{ ...S.col, flex: 1, minWidth: 0 }}>
              <span style={S.sub}>{tx(p("Username · their email", "यूज़रनेम · उनका ईमेल"))}</span>
              <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" style={{ height: 26, border: 0, outline: "none", background: "transparent", fontSize: 15, fontWeight: 700, color: "var(--fg)", padding: 0 }} />
            </span>
          </label>
          <span className="sech">{tx(p("Role", "भूमिका"))}</span>
          <div role="radiogroup" aria-label={tx(p("Role", "भूमिका"))} style={{ ...S.row, flexWrap: "wrap", gap: 6 }}>
            {MATRIX_ROLES.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={role === r} className={`tap chip${role === r ? " on" : ""}`} onClick={() => setRole(r)}>{tx(ROLE_LABELS[r])}</button>
            ))}
          </div>
          <PasswordSlot note={tx(p(`Made when you press Create login, and shown once. ${pr.they} must set a new password at first sign-in.`, "लॉगिन बनाएँ दबाने पर बनेगा और एक बार दिखेगा। पहले लॉगिन पर नया पासवर्ड बनाना होगा।"))} />
          <div style={{ ...S.note, background: "var(--s2)", color: "var(--fg)" }}>
            <Ic n="lock" style={{ marginTop: 1, color: "var(--mut)" }} />
            <span>{tx(p(`Hand it to ${person ? shortName(person.name) : "them"} in person. It is never sent on WhatsApp or stored.`, "पासवर्ड ख़ुद हाथ में दें। यह WhatsApp पर नहीं भेजा जाता और सहेजा नहीं जाता।"))}</span>
          </div>
        </div>
      )}
    </Sheet>
  );
}

type Created = { kind: "login" | "reset"; name: string; username?: string; password?: string; role: StaffRole; staffId?: string };

export function CreatedSheet({ open, onClose, created, onOpen }: { open: boolean; onClose: () => void; created: Created | null; onOpen: () => void }) {
  const { tx } = useVx();
  const [copied, setCopied] = useState(false);
  const who = created ? shortName(created.name) : "";
  const pr = pronouns(created?.name ?? "");
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={created?.kind === "reset" ? tx(p("Password reset", "पासवर्ड बदला")) : tx(p("Login created", "लॉगिन बना"))}
      sub={shortDay(new Date())}
      footer={<Foot sec={tx(p("Open profile", "प्रोफ़ाइल खोलें"))} onSec={onOpen} label={tx(p("Done", "हो गया"))} icon="check" onGo={onClose} />}
    >
      {created ? (
        <div style={{ ...S.col, gap: 12, paddingTop: 4 }}>
          <div style={{ ...S.col, alignItems: "center", gap: 10, textAlign: "center", padding: "8px 0 4px" }}>
            <svg width="88" height="88" viewBox="0 0 96 96" aria-hidden="true" style={{ animation: "xPopIn .5s var(--spring) both" }}>
              <circle cx="48" cy="48" r="44" style={{ fill: "var(--oks)" }} />
              <circle cx="48" cy="48" r="44" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 4, ["--len" as string]: "276.5", strokeDasharray: 276.5, animation: "xDraw .7s .1s var(--ease) both" }} />
              <path d="M30 49l12 12 24-26" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: "60", strokeDasharray: 60, animation: "xDraw .45s .5s var(--ease) both" }} />
            </svg>
            <span className="serif" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.2 }}>{tx(p(`${who} can sign in now`, `${who} अब लॉगिन कर सकते हैं`))}</span>
            <span style={{ color: "var(--mut)", fontSize: 14 }}>{tx(p(`${pr.they}’ll set ${pr.their} own password on first sign-in.`, "पहले लॉगिन पर अपना पासवर्ड बनाएँगे।"))}</span>
          </div>
          <div className="card" style={{ ...S.col, padding: "2px 16px", boxShadow: "none" }}>
            {[
              [tx(p("Username", "यूज़रनेम")), created.username ?? "—"],
              [tx(p("Role", "भूमिका")), tx(ROLE_LABELS[created.role])],
            ].map(([k, v], i) => (
              <div key={k} style={{ ...S.row, justifyContent: "space-between", gap: 10, padding: "10px 0", borderTop: i ? "1px solid var(--bd)" : 0, fontSize: 13 }}>
                <span style={{ color: "var(--mut)" }}>{k}</span>
                <span className="num clip" style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
              </div>
            ))}
            <div style={{ ...S.row, justifyContent: "space-between", gap: 10, padding: "6px 0", borderTop: "1px solid var(--bd)", fontSize: 13 }}>
              <span style={{ color: "var(--mut)" }}>{tx(p("Password", "पासवर्ड"))}</span>
              <span style={{ ...S.row, gap: 4 }}>
                <span className="num" style={{ fontSize: 15, fontWeight: 700, letterSpacing: ".04em", whiteSpace: "nowrap" }}>{created.password}</span>
                <button
                  type="button"
                  className="tap btn ghost"
                  style={{ width: 36, height: 36, padding: 0 }}
                  aria-label={tx(p("Copy password", "पासवर्ड कॉपी करें"))}
                  onClick={() => {
                    void navigator.clipboard?.writeText(created.password ?? "");
                    setCopied(true);
                  }}
                >
                  <Ic n={copied ? "check" : "copy"} size={16} />
                </button>
              </span>
            </div>
          </div>
          <span style={{ ...S.sub, textAlign: "center" }}>{tx(p("Shown once. Hand it over in person; it is never sent on WhatsApp.", "यह एक बार दिखेगा। ख़ुद हाथ में दें; WhatsApp पर नहीं जाता।"))}</span>
        </div>
      ) : null}
    </Sheet>
  );
}

function ResetSheet({ open, onClose, row, pending, onConfirm }: { open: boolean; onClose: () => void; row: StaffRow; pending: boolean; onConfirm: () => void }) {
  const { tx } = useVx();
  const pr = pronouns(row.name);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(p("Reset password", "पासवर्ड बदलें"))}
      sub={tx(p("The old password stops working right away", "पुराना पासवर्ड तुरंत बंद हो जाएगा"))}
      footer={<Foot sec={tx(p("Cancel", "रद्द करें"))} onSec={onClose} label={tx(p("Reset password", "पासवर्ड बदलें"))} icon="key" disabled={pending} onGo={onConfirm} />}
    >
      <div style={{ ...S.col, gap: 12, paddingTop: 4 }}>
        <TargetCard row={row} />
        <PasswordSlot note={tx(p(`Made when you press Reset password, and shown once. Works once — ${pr.they.toLowerCase()} must set a new password at first sign-in.`, "बदलें दबाने पर बनेगा और एक बार दिखेगा। पहले लॉगिन पर नया पासवर्ड बनाना होगा।"))} />
        <div style={{ ...S.note, background: "var(--s2)", color: "var(--fg)" }}>
          <Ic n="shield" style={{ marginTop: 1, color: "var(--mut)" }} />
          <span>{tx(p(`${pr.their.charAt(0).toUpperCase()}${pr.their.slice(1)} records, marks and attendance are not touched. Hand the new password over in person; it is never sent on WhatsApp.`, "रिकॉर्ड, अंक और हाज़िरी नहीं बदलते। नया पासवर्ड ख़ुद हाथ में दें; यह WhatsApp पर नहीं जाता।"))}</span>
        </div>
      </div>
    </Sheet>
  );
}

function DisableSheet({ open, onClose, row, pending, onConfirm }: { open: boolean; onClose: () => void; row: StaffRow; pending: boolean; onConfirm: (reason: string) => void }) {
  const { tx } = useVx();
  const [reason, setReason] = useState("long_leave");
  const pr = pronouns(row.name);
  const who = shortName(row.name);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(p(`Disable ${who}’s login?`, `${who} का लॉगिन बंद करें?`))}
      sub={tx(p("You can turn it back on any time", "इसे कभी भी फिर चालू कर सकते हैं"))}
      footer={<Foot sec={tx(p("Keep login", "लॉगिन रहने दें"))} onSec={onClose} label={tx(p("Disable login", "लॉगिन बंद करें"))} icon="lock" variant="danger" disabled={pending} onGo={() => onConfirm(reason)} />}
    >
      <div style={{ ...S.col, gap: 12, paddingTop: 4 }}>
        <TargetCard row={row} />
        <div style={{ ...S.note, background: "var(--warns)", color: "var(--warnfg)" }}>
          <Ic n="alert" style={{ marginTop: 1 }} />
          <span>
            <b>{tx(p(`${pr.they} can’t sign in.`, "लॉगिन नहीं कर पाएँगे।"))}</b>{" "}
            {tx(p(`${pr.their.charAt(0).toUpperCase()}${pr.their.slice(1)} marks and attendance records stay. You can turn the login back on any time.`, "अंक और हाज़िरी के रिकॉर्ड रहते हैं। लॉगिन कभी भी फिर चालू कर सकते हैं।"))}
          </span>
        </div>
        <span className="sech">{tx(p("Why?", "क्यों?"))}</span>
        <div role="radiogroup" aria-label={tx(p("Why?", "क्यों?"))} style={{ ...S.col, gap: 8 }}>
          {DISABLE_REASONS.map((r) => (
            <Opt key={r.key} on={reason === r.key} onPick={() => setReason(r.key)}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(r.label)}</span>
            </Opt>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function RoleSheet({ open, onClose, row, matrix, pending, onConfirm }: { open: boolean; onClose: () => void; row: StaffRow; matrix: Matrix; pending: boolean; onConfirm: (role: string) => void }) {
  const { tx } = useVx();
  const [role, setRole] = useState<StaffRole>(row.role);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setRole(row.role);
  }
  const who = shortName(row.name);
  const can = matrixGroups().flatMap((g) => g.items.filter((i) => role === "admin" || has(matrix, role, i.key)).map((i) => tx(i.label)));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(p("Change role", "भूमिका बदलें"))}
      sub={tx(p(`Roles decide what ${who} can see and do`, `भूमिका तय करती है कि ${who} क्या देख और कर सकते हैं`))}
      footer={<Foot sec={tx(p("Cancel", "रद्द करें"))} onSec={onClose} label={tx(p("Save role", "भूमिका सहेजें"))} icon="check" disabled={pending || role === row.role} onGo={() => onConfirm(role)} />}
    >
      <div style={{ ...S.col, gap: 12, paddingTop: 4 }}>
        <TargetCard row={row} />
        <div role="radiogroup" aria-label={tx(p("Role", "भूमिका"))} style={{ ...S.col, gap: 8 }}>
          {MATRIX_ROLES.map((r) => (
            <Opt key={r} on={role === r} onPick={() => setRole(r)}>
              <span style={{ ...S.col, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(ROLE_LABELS[r])}</span>
                <span style={S.sub}>{tx(ROLE_HELP[r])}</span>
              </span>
            </Opt>
          ))}
        </div>
        <div style={{ ...S.note, background: "var(--s2)", color: "var(--fg)" }}>
          <Ic n="shield" style={{ marginTop: 1 }} />
          <span>{tx(p(`${who} will be able to: ${can.join(", ") || "nothing yet"}.`, `${who} कर सकेंगे: ${can.join(", ") || "अभी कुछ नहीं"}।`))}</span>
        </div>
      </div>
    </Sheet>
  );
}

function AddStaffSheet({ open, onClose, isAdmin, pending, onSubmit }: { open: boolean; onClose: () => void; isAdmin: boolean; pending: boolean; onSubmit: (input: { displayName: string; shortName: string; role: string; phone: string; isTeaching: boolean }) => void }) {
  const { tx } = useVx();
  const [name, setName] = useState("");
  const [short, setShort] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("teacher");
  const [teaching, setTeaching] = useState(true);
  const roles: StaffRole[] = isAdmin ? [...MATRIX_ROLES] : ["teacher", "view_only"];
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(p("Add staff", "स्टाफ़ जोड़ें"))}
      sub={tx(p("A profile first; a login only if they need one", "पहले प्रोफ़ाइल; लॉगिन सिर्फ़ ज़रूरत पर"))}
      footer={<Foot sec={tx(p("Cancel", "रद्द करें"))} onSec={onClose} label={tx(p("Add", "जोड़ें"))} icon="check" disabled={pending || name.trim().length < 2 || short.trim().length < 2} onGo={() => onSubmit({ displayName: name, shortName: short, role, phone, isTeaching: teaching })} />}
    >
      <div style={{ ...S.col, gap: 14, paddingTop: 4 }}>
        <Field label={tx(p("Full name", "पूरा नाम"))}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={tx(p("For example: Ms. Kiran Regar", "जैसे: Ms. Kiran Regar"))} /></Field>
        <Field label={tx(p("Short name", "संक्षिप्त नाम"))} hint={tx(p("2–8 letters, as the timetable writes it. It can't be changed later.", "2–8 अक्षर, जैसे समय सारणी में। बाद में नहीं बदलेगा।"))}>
          <Input value={short} onChange={(e) => setShort(e.target.value.toUpperCase())} placeholder="KIRAN" maxLength={8} />
        </Field>
        <Field label={tx(p("Phone (WhatsApp)", "फ़ोन (WhatsApp)"))}><Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={tx(p("10-digit number", "10 अंकों का नंबर"))} /></Field>
        <div className="field">
          <span>{tx(p("Role", "भूमिका"))}</span>
          <ChipRow label={tx(p("Role", "भूमिका"))}>
            {roles.map((r) => (
              <Chip key={r} on={role === r} onClick={() => setRole(r)}>{tx(ROLE_LABELS[r])}</Chip>
            ))}
          </ChipRow>
        </div>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontWeight: 600 }}>{tx(p("Teaches classes", "कक्षाएँ पढ़ाते हैं"))}</span>
          <Switch on={teaching} onChange={setTeaching} label={tx(p("Teaches classes", "कक्षाएँ पढ़ाते हैं"))} />
        </label>
      </div>
    </Sheet>
  );
}
