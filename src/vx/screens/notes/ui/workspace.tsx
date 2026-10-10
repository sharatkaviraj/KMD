"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Ic } from "@/vx/icons";
import { Bi, useVx } from "@/vx/i18n";
import { dayMonth } from "@/vx/format";
import { p } from "@/vx/text";
import { Chip, ChipRow, Select } from "@/vx/ui/controls";
import { Section, Split, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, EmptyState } from "@/vx/ui/primitives";

import type { ChildChoice, NoteReply, SupportPlan } from "../data";
import { boardKpis, filterBoard, myCounts, NOTE_TAGS, TAG_COLOR, TAG_TEXT, tagMix, type BoardNote, type BoardTab, type NoteTag } from "../domain/notes";
import { AddNoteSheet, NewPlan, NoteCard, NoteDetail, PlanView, replaceParams, StudentTimeline, type AddStep, type ClientViewer } from "./parts";

/**
 * What the detail pane shows, decided on the server from the URL:
 * `?note=` a note, `?note=&view=plan` a new plan for it, `?plan=` a plan,
 * `?student=` one child's timeline.
 */
export type NotesFocus =
  | { kind: "note"; note: BoardNote; replies: NoteReply[] }
  | { kind: "new-plan"; note: BoardNote }
  | { kind: "plan"; plan: SupportPlan }
  | { kind: "student"; studentId: string; name: string; classLabel: string; notes: BoardNote[]; plans: SupportPlan[] }
  | null;

export type NotesProps = {
  notes: BoardNote[];
  plans: SupportPlan[];
  kids: ChildChoice[];
  viewer: ClientViewer;
  today: string;
  school: string;
  focus: NotesFocus;
  initialSheet: "add" | null;
  initialStep: AddStep;
  initialStudent: string | null;
};

function Detail({ focus, viewer, today, school, base }: { focus: NonNullable<NotesFocus>; viewer: ClientViewer; today: string; school: string; base: string }) {
  const router = useRouter();
  const close = () => router.push(base, { scroll: false });
  const body =
    focus.kind === "note" ? (
      <NoteDetail note={focus.note} replies={focus.replies} viewer={viewer} today={today} school={school} base={base} onClose={close} />
    ) : focus.kind === "new-plan" ? (
      <NewPlan note={focus.note} school={school} base={base} />
    ) : focus.kind === "plan" ? (
      <PlanView plan={focus.plan} viewer={viewer} school={school} base={base} />
    ) : (
      <StudentTimeline name={focus.name} classLabel={focus.classLabel} notes={focus.notes} plans={focus.plans} today={today} base={base} />
    );
  return <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>{body}</div>;
}

function focusTitle(focus: NonNullable<NotesFocus>) {
  if (focus.kind === "note") return p("Note", "नोट");
  if (focus.kind === "new-plan") return p("Make a support plan", "सहायता योजना बनाएँ");
  if (focus.kind === "plan") return p("Support plan", "सहायता योजना");
  return p("Child's notes", "बच्चे के नोट्स");
}

function Shell({ title, crumb, base, back, props, children, add }: { title: { en: string; hi: string }; crumb: string; base: string; back: string | undefined; props: NotesProps; children: ReactNode; add: ReactNode }) {
  const { tx } = useVx();
  const [sheet, setSheet] = useState<"add" | null>(props.initialSheet);
  const focus = props.focus;
  const openAdd = () => {
    setSheet("add");
    replaceParams({ sheet: "add" });
  };
  const closeAdd = () => {
    setSheet(null);
    replaceParams({ sheet: null, step: null });
  };
  const ftitle = focus ? focusTitle(focus) : null;
  return (
    <VxPage label={title.en}>
      <TopBar
        crumb={crumb}
        title={<Bi en={title.en} hi={title.hi} block={false} />}
        mTitle={ftitle ? tx(ftitle) : tx(title)}
        mBack={focus ? base : back}
        actions={props.viewer.canWrite ? <Btn variant="pri" icon="plus" onClick={openAdd}>{tx(p("Add a note", "नोट जोड़ें"))}</Btn> : undefined}
      />
      <Split
        detailWidth={460}
        list={
          <div className={focus ? "only-d" : undefined}>
            <Section>{children}</Section>
          </div>
        }
        detail={focus ? <Detail focus={focus} viewer={props.viewer} today={props.today} school={props.school} base={base} /> : undefined}
      />
      {props.viewer.canWrite && !focus ? (
        <button type="button" className="tap n-fab only-m" onClick={openAdd}>
          <Ic n="plus" size={22} /> {tx(p("Add a note", "नोट जोड़ें"))}
        </button>
      ) : null}
      {add}
      {props.viewer.canWrite ? (
        <AddNoteSheet
          open={sheet === "add"}
          onClose={closeAdd}
          kids={props.kids}
          initialStudent={props.initialStudent}
          initialStep={props.initialStep}
          today={props.today}
          school={props.school}
          author={props.viewer.name}
        />
      ) : null}
    </VxPage>
  );
}

/* --------------------------------------------------------- teacher: mine */

type MineFilter = "open" | "due" | "done" | "all";

/** TchNotes: the notes I wrote or must follow up, newest first. */
export function TeachNotes(props: NotesProps) {
  const { tx } = useVx();
  const [filter, setFilter] = useState<MineFilter>("open");
  const base = "/teach/notes";
  const mine = props.notes.filter((n) => n.writtenBy === props.viewer.id || n.followUpStaffId === props.viewer.id);
  const counts = myCounts(mine, props.today);
  const soon = filterBoard(mine, { tab: "followups" }, props.today);
  const shown = (filter === "due" ? soon : mine).filter((n) => (filter === "open" ? n.status !== "done" : filter === "done" ? n.status === "done" : true));
  const selectedId = props.focus?.kind === "note" ? props.focus.note.id : null;

  return (
    <Shell title={p("My notes", "मेरे नोट्स")} crumb={tx(p("Teaching", "शिक्षण"))} base={base} back="/teach" props={props} add={null}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
        {[
          { k: "due" as const, n: counts.dueSoon, t: p("Due soon", "जल्द बाकी"), c: "var(--bad)" },
          { k: "open" as const, n: counts.open, t: p("Open", "खुले"), c: "var(--warn)" },
          { k: "done" as const, n: counts.done, t: p("Done", "पूरे"), c: "var(--ok)" },
        ].map((x) => (
          <button key={x.k} type="button" className="tap t-count" onClick={() => setFilter(x.k)} style={{ textAlign: "left", font: "inherit", color: "var(--fg)", borderColor: filter === x.k ? "var(--acc)" : undefined }}>
            <b className="num" style={{ color: x.c }}>{x.n}</b>
            <Bi en={x.t.en} hi={x.t.hi} />
          </button>
        ))}
      </div>
      <ChipRow label="Filter">
        {(["open", "due", "done", "all"] as MineFilter[]).map((f) => (
          <Chip key={f} on={filter === f} onClick={() => setFilter(f)}>
            {tx({ open: p("Open", "खुले"), due: p("Follow-ups", "फ़ॉलो-अप"), done: p("Done", "पूरे"), all: p("All", "सब") }[f])}
          </Chip>
        ))}
      </ChipRow>
      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon="note"
            title={tx(p("No notes here", "यहाँ कोई नोट नहीं"))}
            body={tx(p("Write a line when you notice something about a child — good or worrying.", "बच्चे के बारे में कुछ दिखे — अच्छा या चिंता का — तो एक पंक्ति लिखें।"))}
          />
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((n) => (
            <NoteCard key={n.id} note={n} today={props.today} href={`${base}?note=${n.id}`} selected={n.id === selectedId} />
          ))}
        </div>
      )}
      {props.plans.length ? (
        <Card>
          <strong><Bi en="Support plans" hi="सहायता योजनाएँ" /></strong>
          <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {props.plans.map((pl) => (
              <li key={pl.id}>
                <Link href={`${base}?plan=${pl.id}`} scroll={false}>{pl.studentName} · {pl.goal}</Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Shell>
  );
}

/* --------------------------------------------------------- the notes board */

/** Notes board (coordinator / admin): what needs action, follow-ups, plans, everything. */
export function NotesBoard(props: NotesProps & { tab: BoardTab; classes: { id: string; label: string }[]; teachers: { id: string; name: string }[] }) {
  const { tx } = useVx();
  const base = "/notes";
  const [tab, setTabState] = useState<BoardTab>(props.tab);
  const [classId, setClassId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [tag, setTag] = useState<NoteTag | null>(null);
  const setTab = (t: BoardTab) => {
    setTabState(t);
    replaceParams({ tab: t === "action" ? null : t });
  };
  const running = props.plans.filter((pl) => pl.status === "active" || pl.status === "draft");
  const kpis = boardKpis(props.notes, running.length, props.today);
  const mix = tagMix(props.notes);
  const mixTotal = mix.reduce((s, m) => s + m.count, 0);
  const shown = filterBoard(props.notes, { tab, classId: classId || null, teacherId: teacherId || null, tag }, props.today);
  const selectedId = props.focus?.kind === "note" ? props.focus.note.id : null;

  return (
    <Shell title={p("Notes", "नोट्स")} crumb={tx(p("Children", "बच्चे"))} base={base} back={undefined} props={props} add={null}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
        {[
          { k: "action" as BoardTab, n: kpis.needsAction, t: p("Need action", "कार्रवाई चाहिए"), c: "var(--bad)" },
          { k: "followups" as BoardTab, n: kpis.dueThisWeek, t: p("Follow-ups this week", "इस हफ़्ते फ़ॉलो-अप"), c: "var(--warn)" },
          { k: "plans" as BoardTab, n: kpis.plansRunning, t: p("Plans running", "चल रही योजनाएँ"), c: "var(--acc)" },
          { k: "all" as BoardTab, n: kpis.thisMonth, t: p("Notes this month", "इस महीने के नोट्स"), c: "var(--fg)" },
        ].map((x) => (
          <button key={x.k} type="button" className="tap t-count" onClick={() => setTab(x.k)} style={{ textAlign: "left", font: "inherit", color: "var(--fg)", borderColor: tab === x.k ? "var(--acc)" : undefined }}>
            <b className="num" style={{ color: x.c }}>{x.n}</b>
            <Bi en={x.t.en} hi={x.t.hi} />
          </button>
        ))}
      </div>

      {mixTotal ? (
        <Card>
          <span style={{ fontSize: 13, color: "var(--mut)" }}><Bi en="What the notes are about" hi="नोट्स किस बारे में हैं" /></span>
          <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", margin: "10px 0" }} aria-hidden="true">
            {mix.map((m) => <span key={m.tag} style={{ width: `${(m.count / mixTotal) * 100}%`, background: TAG_COLOR[m.tag] }} />)}
          </div>
          <ChipRow label="Tag">
            {mix.map((m) => (
              <Chip key={m.tag} on={tag === m.tag} onClick={() => setTag(tag === m.tag ? null : m.tag)}>
                <span className="t-dot" style={{ background: TAG_COLOR[m.tag], marginRight: 6 }} />
                {tx(TAG_TEXT[m.tag])} · {m.count}
              </Chip>
            ))}
          </ChipRow>
        </Card>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Select aria-label="Class" value={classId} onChange={(e) => setClassId(e.target.value)} style={{ width: 150 }}>
          <option value="">{tx(p("Every class", "सब कक्षाएँ"))}</option>
          {props.classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
        <Select aria-label="Teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} style={{ width: 190 }}>
          <option value="">{tx(p("Every teacher", "सब शिक्षक"))}</option>
          {props.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        {!mixTotal ? (
          <Select aria-label="Tag" value={tag ?? ""} onChange={(e) => setTag((e.target.value || null) as NoteTag | null)} style={{ width: 150 }}>
            <option value="">{tx(p("Every tag", "सब टैग"))}</option>
            {NOTE_TAGS.map((t) => <option key={t} value={t}>{tx(TAG_TEXT[t])}</option>)}
          </Select>
        ) : null}
      </div>

      {tab === "plans" ? (
        running.length === 0 && props.plans.length === 0 ? (
          <Card><EmptyState icon="clipboard" title={tx(p("No support plans yet", "अभी कोई सहायता योजना नहीं"))} /></Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {props.plans
              .filter((pl) => (classId ? pl.classId === classId : true))
              .map((pl) => {
                const done = pl.steps.filter((s) => s.done).length;
                return (
                  <Link key={pl.id} href={`${base}?plan=${pl.id}`} scroll={false} className="tap n-card">
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong>{pl.studentName} · {pl.classLabel}</strong>
                      <span style={{ fontSize: 13, color: "var(--mut)" }}>{done}/{pl.steps.length}</span>
                    </span>
                    <span>{pl.goal}</span>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{pl.createdByName} · {dayMonth(pl.createdAt)}</span>
                  </Link>
                );
              })}
          </div>
        )
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState icon="smile" title={tab === "action" ? tx(p("Nothing needs action", "कुछ भी बाकी नहीं")) : tx(p("No notes match", "कोई नोट नहीं मिला"))} />
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((n) => (
            <NoteCard key={n.id} note={n} today={props.today} href={`${base}?note=${n.id}`} selected={n.id === selectedId} />
          ))}
        </div>
      )}
    </Shell>
  );
}
