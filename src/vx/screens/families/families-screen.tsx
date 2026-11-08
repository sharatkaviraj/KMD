"use client";

import { useDeferredValue, useMemo, useState } from "react";

import { cue } from "@/ui/feedback/cue";
import { useVoiceSearch } from "@/ui/hooks/use-voice-search";
import { initials, rupees } from "@/vx/format";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { ChildAvatar } from "@/vx/ui/child-avatar";
import { Chip, ChipRow, SearchBox, Seg } from "@/vx/ui/controls";
import { IntentLink } from "@/vx/ui/intent-link";
import { LiveFromFees } from "@/vx/ui/live-fees";
import { useToast } from "@/vx/ui/overlays";
import { Banner, Grid, Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, EmptyState, Kpi, Pill } from "@/vx/ui/primitives";

import { FamilyLinkSheet } from "./change-sheet";
import {
  FAMILY_FILTERS,
  familyCounts,
  firstName,
  searchFamilies,
  toFamilyCards,
  type FamiliesData,
  type FamilyCard,
  type FamilyFilter,
  type FamilySort,
} from "./logic";
import { W } from "./words";
import "./families.css";

/*
 * Families (owner, 8 Nov 2026): every family with two or more children in
 * the school, their fees together, and one search box for a child, a parent,
 * a phone or an SR. A family opens its own page (`/families/[groupId]`).
 * "Link brothers and sisters" (admins) opens the linking sheet: through Fees
 * on a real year, One's copy on a TEST year.
 */

const PAGE = 30;

export function FamiliesScreen(props: FamiliesData) {
  const { tx } = useVx();
  const toast = useToast();
  const cards = useMemo(() => toFamilyCards(props.families), [props.families]);
  const counts = useMemo(() => familyCounts(cards), [cards]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FamilyFilter>("all");
  const [sort, setSort] = useState<FamilySort>("name");
  const [limit, setLimit] = useState(PAGE);
  const typed = useDeferredValue(query);
  const found = useMemo(() => searchFamilies(cards, typed, filter, sort), [cards, typed, filter, sort]);
  const shown = found.slice(0, limit);
  const voice = useVoiceSearch((heard) => {
    setQuery(heard);
    setLimit(PAGE);
    toast.show({ tone: "info", text: tx(W.heard(heard)), cue: "ready" });
  });

  const pick = (next: FamilyFilter) => {
    if (next !== filter) cue("select");
    setFilter(next);
    setLimit(PAGE);
  };
  const type = (next: string) => {
    setQuery(next);
    setLimit(PAGE);
  };
  // Each open mounts a fresh sheet (`n`), so it starts at its first step.
  const [linking, setLinking] = useState({ open: false, n: 0 });
  const openLinking = () => setLinking((l) => ({ open: true, n: l.n + 1 }));
  const change = props.canChange ? (
    <Btn variant="pri" icon="userPlus" ariaLabel={tx(W.changeSub)} onClick={openLinking}>
      {tx(W.change)}
    </Btn>
  ) : null;

  return (
    <VxPage label={tx(W.title)}>
      <TopBar
        crumb={tx(W.crumb)}
        title={tx(W.title)}
        actions={change}
        mBack="/menu"
        mSub={tx(W.summary(counts.all, counts.children))}
      />
      {/* vx-pmain: room under the last family for the phone's tab bar. */}
      <div className="vx-pmain">
        <Section>
          <p className="fam-lead">{tx(W.lead)}</p>
          {props.asOf ? <LiveFromFees asOf={props.asOf} notYet={props.canChange ? undefined : W.notYet} /> : null}
          {props.test ? <Banner tone="warn">{tx(W.testYear(props.sessionLabel))}</Banner> : null}
          {/* The top bar's button is desk-only; a phone gets the same as a big button here. */}
          {props.canChange && cards.length > 0 ? (
            <div className="only-m">
              <Btn variant="soft" big full icon="userPlus" ariaLabel={tx(W.changeSub)} onClick={openLinking}>
                {tx(W.change)}
              </Btn>
            </div>
          ) : null}

          {cards.length === 0 ? (
            <EmptyState icon="home" title={tx(W.empty.none)} body={tx(W.empty.noneBody)} action={change} />
          ) : (
            <>
              <Grid cols={4}>
                <Kpi icon="home" label={tx(W.kpi.families)} value={counts.all} sub={tx(W.kpi.familiesSub)} />
                <Kpi icon="users" label={tx(W.kpi.children)} value={counts.children} sub={tx(W.kpi.childrenSub(counts.three))} delay={40} />
                <Kpi
                  icon="rupee"
                  label={tx(W.kpi.feesLeft)}
                  value={rupees(counts.feesPending)}
                  tone={counts.feesPending > 0 ? "var(--warnfg)" : "var(--ok)"}
                  sub={tx(counts.unread ? W.kpi.unreadSub(counts.unread) : W.kpi.feesLeftSub(counts.owing))}
                  delay={80}
                />
                <Kpi icon="clock" label={tx(W.kpi.late)} value={rupees(counts.lateFee)} sub={tx(W.kpi.lateSub)} delay={120} />
              </Grid>

              <div className="fam-tools">
                <div className="fam-search">
                  <SearchBox value={query} onChange={type} placeholder={tx(W.search)} style={{ flex: 1, height: 50 }} />
                  {voice.supported ? (
                    <button
                      type="button"
                      className={`tap fam-mic${voice.listening ? " on" : ""}`}
                      aria-pressed={voice.listening}
                      aria-label={tx(voice.listening ? W.listening : W.speak)}
                      onClick={() => {
                        cue("listen");
                        voice.start();
                      }}
                    >
                      <Ic n="mic" size={20} />
                      <span className="hide-m">{tx(voice.listening ? W.listening : W.speak)}</span>
                    </button>
                  ) : null}
                </div>
                <ChipRow label={tx(W.filtersLabel)}>
                  {FAMILY_FILTERS.map((key) => (
                    <Chip key={key} on={filter === key} count={counts[key]} onClick={() => pick(key)}>
                      {tx(W.filters[key])}
                    </Chip>
                  ))}
                </ChipRow>
                <div className="fam-order">
                  <span className="fam-count">{tx(W.showing(shown.length, found.length))}</span>
                  <Seg
                    label={tx(W.sortLabel)}
                    value={sort}
                    onChange={setSort}
                    options={[
                      { value: "name", label: tx(W.sort.name) },
                      { value: "owing", label: tx(W.sort.owing) },
                    ]}
                    style={{ width: 280, maxWidth: "100%" }}
                  />
                </div>
              </div>

              {found.length === 0 ? (
                <EmptyState
                  icon="search"
                  title={tx(W.empty.noMatch)}
                  body={tx(W.empty.noMatchBody)}
                  action={
                    <Btn
                      icon="x"
                      onClick={() => {
                        cue("tap");
                        setQuery("");
                        setFilter("all");
                      }}
                    >
                      {tx(W.empty.clear)}
                    </Btn>
                  }
                />
              ) : (
                <div className="fam-list">
                  {shown.map((f, i) => (
                    <FamilyRow key={f.id} f={f} delay={i < 8 ? i * 30 : 0} />
                  ))}
                </div>
              )}
              {found.length > shown.length ? (
                <Btn
                  big
                  full
                  icon="chevDown"
                  onClick={() => {
                    cue("tap");
                    setLimit((n) => n + PAGE);
                  }}
                >
                  {tx(W.more(Math.min(PAGE, found.length - shown.length)))}
                </Btn>
              ) : null}
            </>
          )}
        </Section>
      </div>
      {props.canChange ? (
        <FamilyLinkSheet
          key={`link-${linking.n}`}
          open={linking.open}
          onClose={() => setLinking((l) => ({ ...l, open: false }))}
          sessionLabel={props.sessionLabel}
          live={props.asOf !== null}
          family={null}
        />
      ) : null}
    </VxPage>
  );
}

/** One family in the list: the children's faces, the parent, each child's class, and the money in words. */
function FamilyRow({ f, delay }: { f: FamilyCard; delay: number }) {
  const { tx } = useVx();
  const faces = f.kids.slice(0, 4);
  const extra = f.kids.length - faces.length;
  const who = [f.father && f.father !== f.name ? tx(W.card.father(f.father)) : null, f.village].filter(Boolean).join(" · ");
  return (
    <IntentLink feedback href={`/families/${f.id}`} className="card tap lift rise fam-card" style={{ animationDelay: `${delay}ms` }}>
      <span className="fam-faces" aria-hidden="true">
        {faces.map((k) => (
          <ChildAvatar key={k.id} text={initials(k.name)} seed={k.id} size={44} student={k.id} photo={k.hasPhoto ? undefined : null} />
        ))}
        {extra > 0 ? <span className="fam-extra num">+{extra}</span> : null}
      </span>
      <span className="fam-main">
        <span className="fam-name clip">{f.name}</span>
        {who ? <span className="fam-who clip">{who}</span> : null}
        <span className="fam-kids">
          {f.kids.map((k) => (
            <span key={k.id} className="fam-kid">
              {firstName(k.name)} · {k.classLabel || "—"}
            </span>
          ))}
        </span>
        <span className="fam-money">
          <FamilyMoney f={f} />
        </span>
      </span>
      <Ic n="chevRight" size={20} className="fam-chev" />
    </IntentLink>
  );
}

function FamilyMoney({ f }: { f: FamilyCard }) {
  const { tx } = useVx();
  return (
    <>
      {f.feesPending === null ? (
        <Pill tone="mut" icon="info">{tx(W.card.notRead)}</Pill>
      ) : f.feesPending > 0 ? (
        <Pill tone={f.overdue ? "bad" : "warn"} icon={f.overdue ? "alert" : "rupee"}>{tx(W.card.feesLeft(rupees(f.feesPending)))}</Pill>
      ) : (
        <Pill tone="ok" icon="check">{tx(W.card.feesPaid)}</Pill>
      )}
      {f.lateFee ? <Pill tone="warn" icon="clock">{tx(W.card.late(rupees(f.lateFee)))}</Pill> : null}
      {f.allLeft ? <Pill tone="mut">{tx(W.card.allLeft)}</Pill> : null}
    </>
  );
}
