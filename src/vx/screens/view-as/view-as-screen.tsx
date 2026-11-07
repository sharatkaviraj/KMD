"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";

import type { StaffRole } from "@/platform/auth/permissions";
import type { Language } from "@/platform/i18n/language";
import { cue } from "@/ui/feedback/cue";
import Link from "@/ui/link";
import { initials } from "@/vx/format";
import { Ic, type IconName } from "@/vx/icons";
import { Bi, useVx } from "@/vx/i18n";
import { ROLE_SUB } from "@/vx/shell/role-line";
import { endViewAsPersonAction, startViewAsPersonAction } from "@/vx/shell/view-as-actions";
import { p, type Pair } from "@/vx/text";
import { Chip, ChipRow, SearchBox } from "@/vx/ui/controls";
import { ListenButton } from "@/vx/ui/listen";
import { Banner, TopBar } from "@/vx/ui/page";
import { Avatar, EmptyState } from "@/vx/ui/primitives";

import { inGroup, matchesSearch, seeAsLabel, type PersonGroup } from "./logic";
import type { ViewAsPerson, ViewAsRecentShown } from "./types";
import "./view-as.css";

export type ViewAsScreenProps = {
  people: ViewAsPerson[];
  recent: ViewAsRecentShown[];
  /** The person this browser is seeing One as right now, if anybody. */
  current: { id: string; name: string; role: StaffRole; photo: string | null } | null;
  /** Opened from a staff profile: that person is shown first and lit. */
  focus: string | null;
};

const W = {
  title: p("See One as a person", "किसी की नज़र से One देखें"),
  intro: p("Choose a person. One opens exactly as they see it.", "किसी व्यक्ति को चुनें। One ठीक वैसा खुलेगा जैसा उन्हें दिखता है।"),
  real: p("Their menu, their classes, their tasks and notes, with their real data.", "उनका मेनू, उनकी कक्षाएँ, उनके काम और नोट्स, उनके असली डेटा के साथ।"),
  safe: p("Look only: nothing you tap is saved or sent while you look.", "सिर्फ़ देखना: देखते समय आप जो भी दबाएँ, कुछ सहेजा या भेजा नहीं जाता।"),
  ends: p("It ends by itself after 2 hours, and every look is written down.", "यह 2 घंटे बाद अपने-आप बंद हो जाता है, और हर बार देखना दर्ज होता है।"),
  how: p("Find the person below, then tap their big button.", "नीचे व्यक्ति को खोजें, फिर उनका बड़ा बटन दबाएँ।"),
  now: p("You are seeing One as", "आप One को इनकी नज़र से देख रहे हैं"),
  goOn: p("Go on looking", "देखना जारी रखें"),
  back: p("Back to my view", "अपने व्यू पर लौटें"),
  backing: p("Going back…", "लौट रहे हैं…"),
  recent: p("Seen recently", "हाल में देखा"),
  again: p("See again", "फिर देखें"),
  stillOpen: p("still open", "अभी चालू"),
  people: p("Staff", "स्टाफ़"),
  find: p("Find by name or class", "नाम या कक्षा से खोजें"),
  show: p("Show", "दिखाएँ"),
  none: p("Nobody matches", "कोई नहीं मिला"),
  noneSub: p("Try another name, or show everyone.", "कोई और नाम लिखें, या सबको दिखाएँ।"),
  showAll: p("Show everyone", "सबको दिखाएँ"),
  empty: p("There is nobody to see One as yet", "अभी किसी की नज़र से One देखने के लिए कोई नहीं है"),
  emptySub: p("Staff who are not administrators appear here once they are added in Staff & roles.", "जो स्टाफ़ प्रशासक नहीं हैं, वे ‘स्टाफ़ और भूमिकाएँ’ में जोड़े जाने के बाद यहाँ दिखेंगे।"),
  noSignIn: p("Not signed in to One yet", "अभी One में लॉगिन नहीं किया"),
  practice: p("Practice account · TEST data only", "अभ्यास अकाउंट · केवल TEST डेटा"),
  seeingNow: p("Seeing now", "अभी देख रहे हैं"),
  openSub: p("Look only. Nothing will be saved.", "सिर्फ़ देखना। कुछ सहेजा नहीं जाएगा।"),
};

const READS: Record<Language, Pair> = {
  en: p("Reads One in English", "One अंग्रेज़ी में पढ़ते हैं"),
  hi: p("Reads One in Hindi", "One हिंदी में पढ़ते हैं"),
  both: p("Reads One in both languages", "One दोनों भाषाओं में पढ़ते हैं"),
};

function openingLine(name: string): Pair {
  return p(`Opening One as ${name}…`, `${name} की नज़र से One खुल रहा है…`);
}

function classLine(classes: string[]): Pair {
  const list = classes.join(", ");
  return p(`Class teacher of ${list}`, `${list} के कक्षा अध्यापक`);
}

function lasted(minutes: number): Pair {
  return p(`looked for ${minutes} min`, `${minutes} मिनट देखा`);
}

type Group = { key: PersonGroup; label: Pair; icon: IconName };

/** The chips over the list. */
const GROUPS: Group[] = [
  { key: "all", label: p("Everyone", "सभी"), icon: "users" },
  { key: "teachers", label: p("Teachers", "अध्यापक"), icon: "grad" },
  { key: "coordinators", label: p("Coordinators", "समन्वयक"), icon: "chart" },
  { key: "accounts", label: p("Fees & accounts", "फ़ीस और लेखा"), icon: "rupee" },
  { key: "office", label: p("Office", "कार्यालय"), icon: "building" },
  { key: "practice", label: p("Practice accounts", "अभ्यास अकाउंट"), icon: "flask" },
];

function reduceMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

const noSubscribe = () => () => {};

function useLayer(): HTMLElement | null {
  return useSyncExternalStore(
    noSubscribe,
    () => document.getElementById("vx-layer"),
    () => null,
  );
}

/** While One is being opened as somebody: their face, and what is about to happen. */
function Opening({ person }: { person: { name: string; photo: string | null } }) {
  const { tx } = useVx();
  const layer = useLayer();
  if (!layer) return null;
  return createPortal(
    <div className="vxa-open" role="status" aria-live="polite">
      <div className="vxa-open-box">
        <span className="vxa-open-av">
          <Avatar text={initials(person.name)} seed={person.name} photo={person.photo} size={96} />
        </span>
        <b>{tx(openingLine(person.name))}</b>
        <span className="vxa-open-sub">
          <Ic n="lock" size={16} /> {tx(W.openSub)}
        </span>
        <span className="vxa-dots" aria-hidden="true"><i /><i /><i /></span>
      </div>
    </div>,
    layer,
  );
}

function PersonCard({
  person,
  index,
  lit,
  current,
  busy,
  onSee,
}: {
  person: ViewAsPerson;
  index: number;
  lit: boolean;
  current: boolean;
  busy: boolean;
  onSee: (person: ViewAsPerson) => void;
}) {
  const { tx } = useVx();
  const line = person.classes.length ? `${tx(ROLE_SUB[person.role])} · ${tx(classLine(person.classes))}` : tx(ROLE_SUB[person.role]);
  return (
    <article id={`vxa-p-${person.id}`} className={`vxa-card${lit ? " lit" : ""}${current ? " now" : ""}`} style={{ ["--i" as string]: index }} aria-label={person.name}>
      <div className="vxa-who">
        <Avatar text={initials(person.name)} seed={person.name} photo={person.photo} size={56} />
        <span className="vxa-who-t">
          <b>{person.name}</b>
          <span>{line}</span>
        </span>
      </div>
      <div className="vxa-tags">
        {current ? (
          <span className="vxa-tag now">
            <Ic n="eye" size={14} /> {tx(W.seeingNow)}
          </span>
        ) : null}
        <span className="vxa-tag">
          <Ic n="globe" size={14} /> {tx(READS[person.language])}
        </span>
        {person.practice ? (
          <span className="vxa-tag test">
            <Ic n="flask" size={14} /> {tx(W.practice)}
          </span>
        ) : null}
        {!person.hasSignIn ? (
          <span className="vxa-tag quiet">
            <Ic n="info" size={14} /> {tx(W.noSignIn)}
          </span>
        ) : null}
      </div>
      {current ? (
        <Link href="/" className="tap btn soft big vxa-see">
          <Ic n="eye" size={20} /> {tx(W.goOn)}
        </Link>
      ) : (
        <button type="button" className="tap btn pri big vxa-see" disabled={busy} onClick={() => onSee(person)}>
          <Ic n="eye" size={20} /> {tx(seeAsLabel(person.name))}
        </button>
      )}
    </article>
  );
}

/**
 * See One as a person (D-544): the administrator chooses a member of staff
 * and One opens as that person sees it, with their real data, look-only.
 *
 * 1. What it does, in three lines, with Listen.
 * 2. Who is being looked at now, with Back to my view.
 * 3. The last few people looked at, one tap to look again.
 * 4. Everybody else: search, role chips, and a card per person with their
 *    photo, role, class and language, and one big button.
 *
 * Tapping the button shows their face and "Opening One as…" until their
 * home screen is drawn.
 */
export function ViewAsScreen({ people, recent, current, focus }: ViewAsScreenProps) {
  const { tx } = useVx();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<PersonGroup>("all");
  const [opening, setOpening] = useState<ViewAsPerson | null>(null);
  const [problem, setProblem] = useState<Pair | null>(null);
  const [pending, start] = useTransition();
  const [leaving, leave] = useTransition();

  useEffect(() => {
    if (!focus) return;
    document.getElementById(`vxa-p-${focus}`)?.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
  }, [focus]);

  const found = people.filter((x) => matchesSearch(x, query));
  const groups = GROUPS.map((g) => ({ ...g, count: found.filter((x) => inGroup(g.key, x)).length })).filter((g) => g.key === "all" || g.count > 0);
  const chosen = groups.find((g) => g.key === group) ?? groups[0];
  const shown = found.filter((x) => inGroup(chosen.key, x));
  // A person opened from their staff profile is drawn first, so the button is right there.
  const list = focus ? [...shown.filter((x) => x.id === focus), ...shown.filter((x) => x.id !== focus)] : shown;
  const byId = new Map(people.map((x) => [x.id, x]));
  const busy = pending || leaving;

  const see = (person: ViewAsPerson) => {
    if (busy) return;
    cue("tap");
    setProblem(null);
    setOpening(person);
    start(async () => {
      const result = await startViewAsPersonAction(person.id).catch(() => null);
      if (result?.ok) {
        cue("ready");
        router.push(result.href);
        router.refresh();
        return;
      }
      cue("error");
      setOpening(null);
      setProblem(result ? result.message : p("Could not open One as that person. Check the connection and try again.", "उस व्यक्ति की तरह One नहीं खुल सका। कनेक्शन देखकर फिर कोशिश करें।"));
    });
  };

  const goBack = () => {
    if (busy) return;
    cue("tap");
    leave(async () => {
      const href = await endViewAsPersonAction();
      cue("done");
      router.push(href);
      router.refresh();
    });
  };

  const lines = [W.intro, W.real, W.safe, W.ends, W.how].map((x) => tx(x));

  return (
    <>
      <TopBar title={tx(W.title)} mBack="/menu" actions={<ListenButton lines={lines} className="tap btn soft" style={{ height: 40, borderRadius: 20, padding: "0 16px" }} />} />
      <main>
        <div className="vxa">
          <div className="vxa-head only-m">
            <h1 className="serif">{tx(W.title)}</h1>
            <ListenButton lines={lines} className="tap btn soft" style={{ height: 44, borderRadius: 22, padding: "0 16px" }} />
          </div>

          <section className="card vxa-intro" aria-label={tx(W.title)}>
            <p>{tx(W.intro)}</p>
            <div className="vxa-line">
              <span aria-hidden="true"><Ic n="users" size={19} /></span>
              <span>{tx(W.real)}</span>
            </div>
            <div className="vxa-line safe">
              <span aria-hidden="true"><Ic n="lock" size={19} /></span>
              <span>{tx(W.safe)}</span>
            </div>
            <div className="vxa-line ends">
              <span aria-hidden="true"><Ic n="history" size={19} /></span>
              <span>{tx(W.ends)}</span>
            </div>
          </section>

          {current ? (
            <section className="vxa-now" aria-label={tx(W.now)}>
              <div className="vxa-now-who">
                <Avatar text={initials(current.name)} seed={current.name} photo={current.photo} size={48} />
                <span>
                  <span className="vxa-now-k">{tx(W.now)}</span>
                  <b>{current.name}</b>
                  <span className="vxa-now-r">{tx(ROLE_SUB[current.role])}</span>
                </span>
              </div>
              <div className="vxa-now-act">
                <Link href="/" className="tap btn sec big">
                  <Ic n="eye" size={20} /> {tx(W.goOn)}
                </Link>
                <button type="button" className="tap btn pri big" disabled={busy} onClick={goBack}>
                  <Ic n={leaving ? "refresh" : "undo"} size={20} className={leaving ? "spin" : undefined} /> {tx(leaving ? W.backing : W.back)}
                </button>
              </div>
            </section>
          ) : null}

          {problem ? <Banner tone="bad">{tx(problem)}</Banner> : null}

          {recent.length ? (
            <section className="vxa-recent" aria-labelledby="vxa-recent-h">
              <h2 id="vxa-recent-h" className="vxa-h">
                <Ic n="history" size={18} /> <Bi en={W.recent.en} hi={W.recent.hi} block={false} />
              </h2>
              <div className="vxa-rec">
                {recent.map((r) => {
                  const person = byId.get(r.subjectId);
                  const isNow = current?.id === r.subjectId;
                  return (
                    <div key={r.subjectId} className="vxa-rec-i">
                      <Avatar text={initials(r.name)} seed={r.name} photo={person?.photo ?? null} size={40} />
                      <span className="vxa-rec-t">
                        <b>{r.name}</b>
                        <span>
                          {tx(r.when)} · {r.minutes === null ? tx(W.stillOpen) : tx(lasted(r.minutes))}
                        </span>
                      </span>
                      {person && !isNow ? (
                        <button type="button" className="tap btn soft vxa-again" disabled={busy} onClick={() => see(person)} aria-label={`${tx(W.again)}: ${r.name}`}>
                          <Ic n="eye" size={17} /> {tx(W.again)}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="vxa-people" aria-labelledby="vxa-people-h">
            <h2 id="vxa-people-h" className="vxa-h">
              <Ic n="users" size={18} /> <Bi en={W.people.en} hi={W.people.hi} block={false} />
            </h2>
            {people.length ? (
              <>
                <SearchBox value={query} onChange={setQuery} placeholder={tx(W.find)} style={{ height: 50, borderRadius: 25 }} />
                <ChipRow label={tx(W.show)}>
                  {groups.map((g) => (
                    <Chip
                      key={g.key}
                      on={chosen.key === g.key}
                      icon={g.icon}
                      count={g.count}
                      onClick={() => {
                        cue("select");
                        setGroup(g.key);
                      }}
                    >
                      {tx(g.label)}
                    </Chip>
                  ))}
                </ChipRow>
                {list.length ? (
                  <div className="vxa-grid">
                    {list.map((person, i) => (
                      <PersonCard key={person.id} person={person} index={i} lit={person.id === focus} current={current?.id === person.id} busy={busy} onSee={see} />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon="search"
                    title={tx(W.none)}
                    body={tx(W.noneSub)}
                    action={
                      <button
                        type="button"
                        className="tap btn sec"
                        onClick={() => {
                          setQuery("");
                          setGroup("all");
                        }}
                      >
                        {tx(W.showAll)}
                      </button>
                    }
                  />
                )}
              </>
            ) : (
              <EmptyState icon="users" title={tx(W.empty)} body={tx(W.emptySub)} />
            )}
          </section>
        </div>
      </main>
      {opening ? <Opening person={opening} /> : null}
    </>
  );
}
