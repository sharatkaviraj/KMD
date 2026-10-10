"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type { StaffRole } from "@/platform/auth/permissions";
import {
  addStaffAction,
  changeRoleAction,
  createLoginAction,
  resetPasswordAction,
  saveMatrixAction,
  setLoginActiveAction,
  type StaffActionResult,
} from "@/app/(app)/staff/vx-actions";
import { ago, dateLabel, initials, shortDay } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Chip, ChipRow, Field, Input, RadioCard, Seg, SearchBox, Select, Switch } from "@/vx/ui/controls";
import { HelpButton, Sheet, useToast } from "@/vx/ui/overlays";
import { DataList, Grid, Section, Split, TopBar, VxPage, type Column } from "@/vx/ui/page";
import { Avatar, Btn, Card, CardHead, EmptyState, Kpi, Pill, SecHead, SuccessTick } from "@/vx/ui/primitives";

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
  FILTER_LABELS,
  LOGIN_LABELS,
  loginState,
  maskPhone,
  matchesFilter,
  matchesQuery,
  sortRows,
  worksOn,
  type StaffFilter,
  type StaffRow,
} from "./domain/people";
import type { StaffEvent } from "./data";

type SheetKind = "invite" | "created" | "reset" | "deactivate" | "add" | "role" | null;

const FILTERS: StaffFilter[] = ["all", "office", "class_teachers", "subject_teachers", "coordinators", "fee_desk", "never", "no_login", "disabled"];
const DAYS = ["M", "T", "W", "T", "F", "S"];

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
  initialView: "people" | "roles";
  initialId: string | null;
  initialSheet: SheetKind;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useState<"people" | "roles">(initialView);
  const [filter, setFilter] = useState<StaffFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [sheet, setSheet] = useState<SheetKind>(initialSheet);
  const [edited, setEdited] = useState<Matrix>(savedMatrix);
  const [baseline, setBaseline] = useState<Matrix>(savedMatrix);
  const [created, setCreated] = useState<{ name: string; username?: string; password?: string; role: StaffRole; staffId?: string } | null>(null);
  const [pending, start] = useTransition();

  // A row link (`/staff?id=`) re-renders the page with a new id: follow it.
  const [seenId, setSeenId] = useState<string | null>(initialId);
  if (initialId !== seenId) {
    setSeenId(initialId);
    setSelectedId(initialId);
  }

  // A new matrix from the server (after save) becomes the baseline.
  if (savedMatrix !== baseline) {
    setBaseline(savedMatrix);
    setEdited(savedMatrix);
  }

  const counts = useMemo(() => countStaff(rows), [rows]);
  const visible = useMemo(() => sortRows(rows.filter((r) => matchesFilter(r, filter) && matchesQuery(r, query))), [rows, filter, query]);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const changes = useMemo(() => diffMatrix(savedMatrix, edited), [savedMatrix, edited]);

  const go = (next: { view?: "people" | "roles"; id?: string | null }) => {
    const v = next.view ?? view;
    const id = next.id === undefined ? selectedId : next.id;
    if (next.view) setView(next.view);
    if (next.id !== undefined) setSelectedId(next.id);
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

  const columns: Column<StaffRow>[] = [
    {
      key: "person",
      label: "Person",
      width: "minmax(0,1.6fr)",
      cell: (r) => (
        <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <Avatar text={initials(r.name)} seed={r.name} size={36} />
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span className="clip" style={{ fontWeight: 600 }}>{r.name}</span>
            <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{maskPhone(r.phone)}</span>
          </span>
        </span>
      ),
    },
    {
      key: "roles",
      label: "Roles",
      width: "minmax(0,1.2fr)",
      cell: (r) => (
        <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <Pill tone={r.role === "admin" ? "info" : r.role === "accountant" || r.role === "fee_collector" ? "info" : "acc"}>{tx(ROLE_LABELS[r.role])}</Pill>
          {r.classTeacherOf.length ? <Pill tone="ok">{tx(p("Class teacher", "कक्षा अध्यापक"))}</Pill> : null}
        </span>
      ),
    },
    { key: "works", label: "Classes · subjects", width: "minmax(0,1.4fr)", cell: (r) => <span className="clip" style={{ display: "block" }}>{tx(worksOn(r))}</span> },
    {
      key: "login",
      label: "Login",
      width: "180px",
      cell: (r) => {
        const state = loginState(r);
        const tone = state === "active" ? "ok" : state === "never" ? "warn" : state === "disabled" ? "bad" : "mut";
        return (
          <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
            <Pill tone={tone}>{tx(LOGIN_LABELS[state])}</Pill>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              {state === "active" && r.lastSignInAt ? `Last seen ${ago(r.lastSignInAt)}` : state === "never" ? "Sent, not used yet" : state === "none" ? "Create one when needed" : "Records are kept"}
            </span>
          </span>
        );
      },
    },
  ];

  const header = (
    <TopBar
      crumb={`People · ${sessionLabel ? `Session ${sessionLabel}` : "Staff"}`}
      title={view === "roles" ? tx(p("Roles & permissions", "भूमिकाएँ व अनुमतियाँ")) : tx(p("Staff & roles", "स्टाफ़ व भूमिकाएँ"))}
      mSub={`${counts.total} staff · ${counts.withLogin} with login`}
      mBack="/menu"
      actions={
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {view === "people" ? <SearchBox value={query} onChange={setQuery} placeholder="Name, class or subject" style={{ width: 280 }} /> : null}
          {mayManage ? <Btn icon="plus" variant="sec" onClick={() => setSheet("add")}>Add staff</Btn> : null}
          {isAdmin ? <Btn icon="userPlus" variant="pri" onClick={() => setSheet("invite")}>Create login</Btn> : null}
          <HelpButton title="Staff & roles" steps={[
            { icon: "users", title: "Find a person", body: "Search by name, class or subject. Tap a row to see their profile, timetable load and login." },
            { icon: "key", title: "Logins", body: "Create a login, reset a password or turn a login off. Records always stay." },
            { icon: "shield", title: "Roles", body: "Roles & permissions decides who can do what. Admin always has everything; teachers never see money." },
          ]} />
        </span>
      }
      mAction={isAdmin ? <Btn variant="soft" icon="userPlus" onClick={() => setSheet("invite")}>Add login</Btn> : undefined}
    />
  );

  const tabs = (
    <Seg
      label="Staff view"
      value={view}
      onChange={(v) => go({ view: v, id: null })}
      options={[
        { value: "people", label: tx(p("People", "लोग")) },
        { value: "roles", label: tx(p("Roles & permissions", "भूमिकाएँ")) },
      ]}
      style={{ maxWidth: 380 }}
    />
  );

  const peopleList = (
    <Section>
      {tabs}
      <div className="only-m">
        <SearchBox value={query} onChange={setQuery} placeholder="Name, class or subject" />
      </div>
      <Grid cols={4}>
        <Kpi label="Staff" value={counts.total} sub={`${counts.teachers} teaching`} />
        <Kpi label="With login" value={counts.withLogin} sub={`${counts.active} active`} />
        <Kpi label="Never signed in" value={counts.never} tone="var(--warn)" sub="Send the login again" />
        <Kpi label="Disabled" value={counts.disabled} tone="var(--bad)" sub="Records are kept" />
      </Grid>
      <ChipRow label="Filter staff">
        {FILTERS.map((f) => (
          <Chip key={f} on={filter === f} onClick={() => setFilter(f)} count={rows.filter((r) => matchesFilter(r, f)).length}>
            {tx(FILTER_LABELS[f])}
          </Chip>
        ))}
      </ChipRow>
      <Card pad={false} style={{ overflow: "hidden" }}>
        <DataList
          rows={visible}
          columns={columns}
          rowKey={(r) => r.id}
          href={(r) => `/staff?id=${r.id}`}
          selected={(r) => r.id === selectedId}
          caption="Staff"
          empty={<EmptyState icon="users" title="Nobody matches" body="Try another name or filter." />}
        />
      </Card>
    </Section>
  );

  const profile = selected ? (
    <ProfilePanel
      row={selected}
      load={load[selected.id] ?? [0, 0, 0, 0, 0, 0]}
      events={events.filter((e) => e.staffId === selected.id)}
      isAdmin={isAdmin}
      onClose={() => go({ id: null })}
      onReset={() => setSheet("reset")}
      onDisable={() => setSheet("deactivate")}
      onRole={() => setSheet("role")}
      onInvite={() => setSheet("invite")}
      onEnable={() =>
        start(async () => done(await setLoginActiveAction({ staffId: selected.id, active: true })))
      }
      pending={pending}
    />
  ) : null;

  return (
    <VxPage>
      {header}
      <main>
        {view === "people" ? (
          <Split list={peopleList} detail={profile} />
        ) : (
          <RolesView
            tabs={tabs}
            saved={savedMatrix}
            edited={edited}
            roleCounts={roleCounts}
            editable={mayEditMatrix}
            onToggle={(role, perm) => setEdited((m) => toggle(m, role, perm))}
            changes={changes.map(describeChange)}
            changeCount={changes.length}
            pending={pending}
            onDiscard={() => setEdited(savedMatrix)}
            onSave={() =>
              start(async () => {
                const result = await saveMatrixAction(changes);
                done(result);
              })
            }
          />
        )}
      </main>

      <InviteSheet
        open={sheet === "invite"}
        onClose={() => setSheet(null)}
        rows={rows}
        preselect={selected && !selected.hasLogin ? selected.id : null}
        pending={pending}
        onSubmit={(input) =>
          start(async () => {
            const result = await createLoginAction(input);
            if (result.ok) {
              const person = rows.find((r) => r.id === input.staffId);
              setCreated({ name: person?.name ?? "", username: result.username, password: result.password, role: input.role as StaffRole, staffId: result.staffId });
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
      {selected ? (
        <>
          <ResetSheet
            open={sheet === "reset"}
            onClose={() => setSheet(null)}
            row={selected}
            pending={pending}
            onConfirm={() =>
              start(async () => {
                const result = await resetPasswordAction(selected.id);
                if (result.ok) {
                  setCreated({ name: selected.name, username: result.username, password: result.password, role: selected.role, staffId: selected.id });
                  setSheet("created");
                } else done(result);
              })
            }
          />
          <DisableSheet
            open={sheet === "deactivate"}
            onClose={() => setSheet(null)}
            row={selected}
            pending={pending}
            onConfirm={(reason) => start(async () => done(await setLoginActiveAction({ staffId: selected.id, active: false, reason }), () => setSheet(null)))}
          />
          <RoleSheet
            open={sheet === "role"}
            onClose={() => setSheet(null)}
            row={selected}
            pending={pending}
            onConfirm={(role) => start(async () => done(await changeRoleAction({ staffId: selected.id, role }), () => setSheet(null)))}
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
  onClose,
  onReset,
  onDisable,
  onRole,
  onInvite,
  onEnable,
  pending,
}: {
  row: StaffRow;
  load: number[];
  events: StaffEvent[];
  isAdmin: boolean;
  onClose: () => void;
  onReset: () => void;
  onDisable: () => void;
  onRole: () => void;
  onInvite: () => void;
  onEnable: () => void;
  pending: boolean;
}) {
  const { tx } = useVx();
  const state = loginState(row);
  const max = Math.max(...load, 1);
  const total = load.reduce((a, b) => a + b, 0);
  return (
    <div style={{ padding: "18px 20px 28px", display: "flex", flexDirection: "column", gap: 16 }} className="fadein">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="sech">Staff profile</span>
        <button type="button" className="tap icon-btn" aria-label="Close profile" onClick={onClose}>
          <Ic n="x" size={18} />
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Avatar text={initials(row.name)} seed={row.name} size={56} />
        <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span className="serif clip" style={{ fontSize: 24, fontWeight: 600 }}>{row.name}</span>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Pill tone="acc">{tx(ROLE_LABELS[row.role])}</Pill>
            {row.classTeacherOf.length ? <Pill tone="ok">Class teacher · {row.classTeacherOf.join(", ")}</Pill> : null}
          </span>
        </span>
      </div>
      <Card pad={false}>
        {[
          { icon: "phone" as const, k: "Phone", v: maskPhone(row.phone) },
          { icon: "book" as const, k: "Works on", v: tx(worksOn(row)) },
          { icon: "calendar" as const, k: "Joined", v: dateLabel(row.joinedAt) },
        ].map((line, i) => (
          <div key={line.k} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
            <Ic n={line.icon} size={18} style={{ color: "var(--mut)" }} />
            <span style={{ width: 90, color: "var(--mut)", fontSize: 13 }}>{line.k}</span>
            <span style={{ flex: 1, fontWeight: 600, minWidth: 0 }} className="clip">{line.v}</span>
          </div>
        ))}
      </Card>
      {row.isTeaching ? (
        <Card>
          <CardHead title="Timetable load" action={<span className="num" style={{ fontWeight: 700 }}>{total} of 48 periods</span>} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10, alignItems: "end", height: 70, marginTop: 12 }}>
            {load.map((n, i) => (
              <span key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <span title={`${n} periods`} style={{ width: 28, height: Math.max(4, (n / max) * 44), background: "var(--acc)", borderRadius: 6, transformOrigin: "bottom", animation: `xGrowY .5s var(--ease) ${i * 40}ms both` }} />
                <span style={{ fontSize: 11, color: "var(--mut)" }}>{DAYS[i]}</span>
              </span>
            ))}
          </div>
          <Link href={`/timetable?view=teacher&teacher=${row.id}`} style={{ display: "inline-flex", gap: 6, marginTop: 10, color: "var(--acc)", fontWeight: 600, fontSize: 13 }}>
            Open their timetable <Ic n="chevRight" size={14} />
          </Link>
        </Card>
      ) : null}
      <Card>
        <CardHead
          title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ic n="key" size={18} /> Login</span>}
          action={<Pill tone={state === "active" ? "ok" : state === "never" ? "warn" : state === "disabled" ? "bad" : "mut"}>{tx(LOGIN_LABELS[state])}</Pill>}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, fontSize: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ color: "var(--mut)" }}>Username</span>
            <span className="clip" style={{ fontWeight: 600 }}>{row.email ?? (row.hasLogin ? "—" : "No login yet")}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--mut)" }}>Last sign-in</span>
            <span style={{ fontWeight: 600 }}>{row.lastSignInAt ? ago(row.lastSignInAt) : "Never"}</span>
          </div>
        </div>
        {isAdmin ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            {row.hasLogin && row.isActive ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <Btn icon="key" onClick={onReset}>Reset password</Btn>
                <Btn icon="shield" onClick={onRole}>Change role</Btn>
              </div>
            ) : null}
            {!row.hasLogin && row.isActive ? <Btn icon="userPlus" variant="pri" onClick={onInvite}>Create login</Btn> : null}
            {!row.hasLogin && row.isActive ? <Btn icon="shield" onClick={onRole}>Change role</Btn> : null}
            {row.isActive ? (
              <Btn icon="lock" variant="ghost" onClick={onDisable} style={{ color: "var(--bad)" }}>Disable login</Btn>
            ) : (
              <Btn icon="refresh" variant="soft" onClick={onEnable} disabled={pending}>Turn login back on</Btn>
            )}
          </div>
        ) : null}
      </Card>
      <Card>
        <SecHead>Activity</SecHead>
        {events.length === 0 ? (
          <p style={{ margin: "8px 0 0", color: "var(--mut)", fontSize: 13 }}>No role or login changes yet.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {events.slice(0, 6).map((e) => (
              <li key={e.id} style={{ fontSize: 13 }}>
                <strong>{e.text}</strong>
                <span style={{ color: "var(--mut)" }}> · {shortDay(e.at)}{e.actor ? ` · by ${e.actor}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Link href={`/staff/${row.id}`} style={{ color: "var(--acc)", fontWeight: 600, fontSize: 13, display: "inline-flex", gap: 6, alignItems: "center" }}>
        Full profile, cover policy & edit <Ic n="chevRight" size={14} />
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
  editable,
  onToggle,
  changes,
  changeCount,
  pending,
  onDiscard,
  onSave,
}: {
  tabs: React.ReactNode;
  saved: Matrix;
  edited: Matrix;
  roleCounts: Record<StaffRole, number>;
  editable: boolean;
  onToggle: (role: StaffRole, permission: Parameters<typeof toggle>[2]) => void;
  changes: Pair[];
  changeCount: number;
  pending: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const { tx } = useVx();
  const [open, setOpen] = useState<string | null>(null);
  const groups = matrixGroups();
  const cols = `minmax(220px,1.6fr) repeat(${MATRIX_ROLES.length}, minmax(84px,1fr))`;
  return (
    <Section style={{ paddingBottom: changeCount ? 120 : 40 }}>
      {tabs}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 16px", borderRadius: 14, background: "var(--infos)", color: "var(--info)", fontSize: 14 }}>
        <Ic n="shield" size={18} />
        <span>
          <strong>Who can do what.</strong> Admin always has everything. Teachers never see fee amounts, so the Money rows stay off for them. Tap a permission name to see what it means.
          {editable ? "" : " Only an administrator can change this."}
        </span>
      </div>
      <Card pad={false} style={{ overflowX: "auto" }} className="hs">
        <div style={{ minWidth: 980 }}>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 0, padding: "12px 16px", borderBottom: "1px solid var(--bd)", position: "sticky", top: 0, background: "var(--card)", zIndex: 1 }}>
            <span className="sech" style={{ alignSelf: "center" }}>Permission</span>
            {MATRIX_ROLES.map((role) => (
              <span key={role} style={{ textAlign: "center", fontSize: 13, fontWeight: 700, display: "flex", flexDirection: "column" }}>
                <Bi en={ROLE_LABELS[role].en} hi={ROLE_LABELS[role].hi} />
                <span style={{ fontWeight: 500, fontSize: 11, color: "var(--mut)" }}>{roleCounts[role]} {roleCounts[role] === 1 ? "person" : "people"}</span>
              </span>
            ))}
          </div>
          {groups.map((group) => (
            <div key={group.key} style={{ borderBottom: "1px solid var(--bd)" }}>
              <div style={{ padding: "12px 16px 4px", display: "flex", gap: 10, alignItems: "baseline" }}>
                <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase" }}>{tx(group.title)}</span>
                {group.note ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(group.note)}</span> : null}
              </div>
              {group.items.map((item) => (
                <div key={item.key}>
                  <div style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", padding: "6px 16px", minHeight: 50 }}>
                    <button type="button" className="tap" onClick={() => setOpen(open === item.key ? null : item.key)} style={{ textAlign: "left", background: "none", border: 0, padding: 0, color: "var(--fg)", fontWeight: 600, fontSize: 14, display: "inline-flex", gap: 6, alignItems: "center" }} aria-expanded={open === item.key}>
                      {tx(item.label)} <Ic n="help" size={14} style={{ color: "var(--sub)" }} />
                    </button>
                    {MATRIX_ROLES.map((role) => {
                      const lock = cellLock(role, item.key);
                      const on = has(edited, role, item.key);
                      const changed = on !== has(saved, role, item.key);
                      return (
                        <span key={role} style={{ display: "flex", justifyContent: "center" }}>
                          <span style={{ padding: 6, borderRadius: 12, border: changed ? "1.5px solid var(--warn)" : "1.5px solid transparent", background: changed ? "var(--warns)" : undefined, opacity: lock ? 0.45 : 1 }} title={lock === "admin" ? "Admin always has everything" : lock === "teacher_money" ? "Teachers never see fee amounts" : undefined}>
                            <Switch on={on} onChange={() => onToggle(role, item.key)} label={`${tx(item.label)} for ${tx(ROLE_LABELS[role])}`} disabled={!editable || Boolean(lock)} />
                          </span>
                        </span>
                      );
                    })}
                  </div>
                  {open === item.key ? <p style={{ margin: "0 16px 10px", fontSize: 13, color: "var(--mut)" }}>{tx(item.help)}</p> : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
      {changeCount > 0 ? (
        <div className="glass" style={{ position: "sticky", bottom: 12, display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderRadius: 18, border: "1px solid var(--bd)", boxShadow: "var(--shl)", animation: "xUp .35s var(--ease) both" }} role="status">
          <span className="num" style={{ width: 32, height: 32, borderRadius: 16, background: "var(--warn)", color: "var(--onsolid)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{changeCount}</span>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <strong>{changeCount} {changeCount === 1 ? "change" : "changes"}</strong>
            <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>Not saved yet · {changes.map((c) => tx(c)).join(" · ")}</span>
          </span>
          <Btn variant="ghost" onClick={onDiscard}>Discard</Btn>
          <Btn variant="pri" icon="check" onClick={onSave} disabled={pending}>Save</Btn>
        </div>
      ) : null}
    </Section>
  );
}

/* -------------------------------------------------------------- sheets */

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
  const candidates = rows.filter((r) => r.isActive && !r.hasLogin);
  const [staffId, setStaffId] = useState<string>("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("");
  const [wasOpen, setWasOpen] = useState(open);
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
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Create a login"
      sub="For staff who don’t have one yet"
      icon="userPlus"
      footer={
        <>
          <Btn style={{ flex: 1 }} onClick={onClose}>Cancel</Btn>
          <Btn variant="pri" icon="userPlus" style={{ flex: 1 }} disabled={pending || !staffId || !email} onClick={() => onSubmit({ staffId, email, role })}>Create login</Btn>
        </>
      }
    >
      {candidates.length === 0 ? (
        <EmptyState icon="checkCircle" title="Everyone has a login" body="Add a staff member first, then create their login." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Who gets the login">
            <Select value={staffId} onChange={(e) => { setStaffId(e.target.value); setRole(rows.find((r) => r.id === e.target.value)?.role ?? "teacher"); }}>
              {candidates.map((r) => (
                <option key={r.id} value={r.id}>{r.name} · {tx(ROLE_LABELS[r.role])}</option>
              ))}
            </Select>
          </Field>
          <Field label="Username · their email" hint="They sign in with this email and the one-time password below.">
            <Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" lead={<Ic n="mail" size={16} />} />
          </Field>
          <div className="field">
            <span>Role</span>
            <ChipRow label="Role">
              {MATRIX_ROLES.map((r) => (
                <Chip key={r} on={role === r} onClick={() => setRole(r)}>{tx(ROLE_LABELS[r])}</Chip>
              ))}
            </ChipRow>
          </div>
          <div style={{ padding: 14, borderRadius: 14, border: "1.5px dashed var(--bds)", fontSize: 13, color: "var(--mut)", display: "flex", gap: 10 }}>
            <Ic n="lock" size={18} />
            <span>A one-time password is made when you press Create. You will see it once, to hand to {person?.name ?? "them"} in person. It is never sent on WhatsApp or stored.</span>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function CreatedSheet({ open, onClose, created, onOpen }: { open: boolean; onClose: () => void; created: { name: string; username?: string; password?: string; role: StaffRole } | null; onOpen: () => void }) {
  const { tx } = useVx();
  const [copied, setCopied] = useState(false);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Login ready"
      sub={shortDay(new Date())}
      footer={
        <>
          <Btn style={{ flex: 1 }} onClick={onOpen}>Open profile</Btn>
          <Btn variant="pri" icon="check" style={{ flex: 1 }} onClick={onClose}>Done</Btn>
        </>
      }
    >
      {created ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
          <SuccessTick />
          <h3 className="serif" style={{ margin: 0, fontSize: 24 }}>{created.name} can sign in now</h3>
          <p style={{ margin: 0, color: "var(--mut)" }}>Hand over this one-time password. It will not be shown again.</p>
          <Card pad={false} style={{ width: "100%", textAlign: "left" }}>
            {[
              ["Username", created.username ?? "—"],
              ["Role", tx(ROLE_LABELS[created.role])],
            ].map(([k, v], i) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                <span style={{ color: "var(--mut)" }}>{k}</span>
                <strong className="clip">{v}</strong>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--bd)" }}>
              <span style={{ color: "var(--mut)" }}>Password</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <strong className="num" style={{ letterSpacing: ".08em" }}>{created.password}</strong>
                <button
                  type="button"
                  className="tap icon-btn"
                  aria-label="Copy password"
                  onClick={() => {
                    void navigator.clipboard?.writeText(created.password ?? "");
                    setCopied(true);
                  }}
                >
                  <Ic n={copied ? "check" : "copy"} size={16} />
                </button>
              </span>
            </div>
          </Card>
        </div>
      ) : null}
    </Sheet>
  );
}

function ResetSheet({ open, onClose, row, pending, onConfirm }: { open: boolean; onClose: () => void; row: StaffRow; pending: boolean; onConfirm: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Reset ${row.name}’s password?`}
      sub="Their old password stops working at once"
      icon="key"
      footer={
        <>
          <Btn style={{ flex: 1 }} onClick={onClose}>Cancel</Btn>
          <Btn variant="pri" icon="key" style={{ flex: 1 }} disabled={pending} onClick={onConfirm}>Make a new password</Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <PersonCard row={row} />
        <p style={{ margin: 0, color: "var(--mut)" }}>You will see a new one-time password to hand to them. Their records, marks and attendance are not touched.</p>
      </div>
    </Sheet>
  );
}

function DisableSheet({ open, onClose, row, pending, onConfirm }: { open: boolean; onClose: () => void; row: StaffRow; pending: boolean; onConfirm: (reason: string) => void }) {
  const { tx } = useVx();
  const [reason, setReason] = useState("long_leave");
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Disable ${row.name}’s login?`}
      sub="You can turn it back on any time"
      footer={
        <>
          <Btn style={{ flex: 1 }} onClick={onClose}>Keep login</Btn>
          <Btn variant="danger" icon="lock" style={{ flex: 1 }} disabled={pending} onClick={() => onConfirm(reason)}>Disable login</Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <PersonCard row={row} />
        <div style={{ display: "flex", gap: 10, padding: "12px 14px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)", fontSize: 14 }}>
          <Ic n="alert" size={18} />
          <span><strong>They can’t sign in.</strong> Their marks and attendance records stay. You can turn the login back on any time.</span>
        </div>
        <span className="sech">Why?</span>
        <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {DISABLE_REASONS.map((r) => (
            <RadioCard key={r.key} checked={reason === r.key} onSelect={() => setReason(r.key)} title={tx(r.label)} />
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function RoleSheet({ open, onClose, row, pending, onConfirm }: { open: boolean; onClose: () => void; row: StaffRow; pending: boolean; onConfirm: (role: string) => void }) {
  const { tx } = useVx();
  const [role, setRole] = useState<string>(row.role);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setRole(row.role);
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Change ${row.name}’s role`}
      sub="What they can do changes at their next tap"
      icon="shield"
      footer={
        <>
          <Btn style={{ flex: 1 }} onClick={onClose}>Cancel</Btn>
          <Btn variant="pri" icon="check" style={{ flex: 1 }} disabled={pending || role === row.role} onClick={() => onConfirm(role)}>Save role</Btn>
        </>
      }
    >
      <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {MATRIX_ROLES.map((r) => (
          <RadioCard key={r} checked={role === r} onSelect={() => setRole(r)} title={tx(ROLE_LABELS[r])} />
        ))}
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
      title="Add staff"
      sub="A profile first; a login only if they need one"
      icon="userPlus"
      footer={
        <>
          <Btn style={{ flex: 1 }} onClick={onClose}>Cancel</Btn>
          <Btn variant="pri" icon="check" style={{ flex: 1 }} disabled={pending || name.trim().length < 2 || short.trim().length < 2} onClick={() => onSubmit({ displayName: name, shortName: short, role, phone, isTeaching: teaching })}>Add</Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Ms. Kiran Regar" /></Field>
        <Field label="Short name" hint="2–8 letters, as the timetable writes it. It can't be changed later.">
          <Input value={short} onChange={(e) => setShort(e.target.value.toUpperCase())} placeholder="KIRAN" maxLength={8} />
        </Field>
        <Field label="Phone (WhatsApp)"><Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit number" /></Field>
        <div className="field">
          <span>Role</span>
          <ChipRow label="Role">
            {roles.map((r) => (
              <Chip key={r} on={role === r} onClick={() => setRole(r)}>{tx(ROLE_LABELS[r])}</Chip>
            ))}
          </ChipRow>
        </div>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontWeight: 600 }}>Teaches classes</span>
          <Switch on={teaching} onChange={setTeaching} label="Teaches classes" />
        </label>
      </div>
    </Sheet>
  );
}

function PersonCard({ row }: { row: StaffRow }) {
  const { tx } = useVx();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, background: "var(--s2)" }}>
      <Avatar text={initials(row.name)} seed={row.name} size={40} />
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <strong className="clip">{row.name}</strong>
        <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(ROLE_LABELS[row.role])} · {maskPhone(row.phone)}</span>
      </span>
    </div>
  );
}
