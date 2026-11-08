"use client";

import { useMemo, useState } from "react";

import { dateLabelP, initials, pct, rupees } from "@/vx/format";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { ChildAvatar } from "@/vx/ui/child-avatar";
import { LiveFromFees } from "@/vx/ui/live-fees";
import { useToast } from "@/vx/ui/overlays";
import { Banner, Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, CardHead, EmptyState, Pill, Progress, SecHead } from "@/vx/ui/primitives";

import { FamilyLinkSheet, FamilyUnlinkSheet, type SheetKid } from "./change-sheet";
import { collectChild, maskedPhone, mobile, toFamilyCard, type FamiliesData, type FamilyCard, type FamilyKid } from "./logic";
import { W } from "./words";
import "./families.css";

/*
 * One family (owner, 8 Nov 2026): the parents with Call and WhatsApp, the
 * year's fees for all the children together, and each child with their own
 * fees, next due and the two next steps: open the child, or collect the fee.
 * The late fee is always its own line, never inside fees.
 */

type Props = FamiliesData & { groupId: string };

export function FamilyScreen(props: Props) {
  const { tx } = useVx();
  const group = props.families.find((g) => g.groupId === props.groupId) ?? null;
  const f = useMemo(() => (group ? toFamilyCard(group) : null), [group]);
  // Each open mounts a fresh sheet (`n`), so it starts at its first step.
  const [adding, setAdding] = useState({ open: false, n: 0 });
  const [taking, setTaking] = useState<{ open: boolean; n: number; kid: SheetKid | null }>({ open: false, n: 0, kid: null });
  const live = props.asOf !== null;
  // The family as it was when a change on this page started saving. Taking
  // out the second-last child deletes the family, and adding a child can fold
  // it into an older one; the save re-renders this page without it, and the
  // open sheet must still be here to say what happened (8 Nov 2026: it said
  // "not found" instead of "This family has ended").
  const [held, setHeld] = useState<{ card: FamilyCard; kind: "link" | "unlink" } | null>(null);
  const shown = f ?? held?.card ?? null;

  if (!f && held && !adding.open && !taking.open) {
    const ended = held.kind === "unlink";
    return (
      <VxPage label={tx(W.title)}>
        <TopBar crumb={tx(W.crumb)} title={tx(W.title)} mBack="/families" />
        <Section>
          <EmptyState
            icon={ended ? "checkCircle" : "users"}
            title={tx(ended ? W.ended : W.joined)}
            body={tx(ended ? W.endedBody : W.joinedBody)}
            action={<Btn variant="pri" big icon="chevLeft" href="/families">{tx(W.back)}</Btn>}
          />
        </Section>
      </VxPage>
    );
  }

  if (!shown || shown.kids.length === 0) {
    return (
      <VxPage label={tx(W.title)}>
        <TopBar crumb={tx(W.crumb)} title={tx(W.title)} mBack="/families" />
        <Section>
          <EmptyState icon="search" title={tx(W.notFound)} body={tx(W.notFoundBody)} action={<Btn variant="pri" big icon="chevLeft" href="/families">{tx(W.back)}</Btn>} />
        </Section>
      </VxPage>
    );
  }

  return (
    <VxPage label={shown.name}>
      <TopBar
        crumb={tx(W.crumb)}
        title={shown.name}
        actions={<Btn icon="chevLeft" href="/families">{tx(W.back)}</Btn>}
        mBack="/families"
        mSub={tx(W.kids(shown.kids.length))}
      />
      {/* vx-pmain: room under the last child's "Take out of this family" for the phone's tab bar. */}
      <div className="vx-pmain">
        <Section>
          {props.asOf ? <LiveFromFees asOf={props.asOf} notYet={props.canChange ? undefined : W.notYet} /> : null}
          {props.test ? <Banner tone="warn">{tx(W.testYear(props.sessionLabel))}</Banner> : null}
          <div className="fam-page">
            <div className="fam-col">
              <Hero f={shown} canCollect={props.canCollect} />
              <MoneyCard f={shown} />
              {props.canChange ? (
                <Btn variant="soft" big full icon="userPlus" ariaLabel={tx(W.addKidSub)} onClick={() => setAdding((a) => ({ open: true, n: a.n + 1 }))}>
                  {tx(W.addKid)}
                </Btn>
              ) : null}
              <HelpCard canCollect={props.canCollect} canOpen={props.canOpenChildren} canChange={props.canChange} />
            </div>
            <div className="fam-col">
              <SecHead>{tx(W.children(shown.kids.length))}</SecHead>
              {shown.kids.map((k, i) => (
                <ChildCard
                  key={k.id}
                  k={k}
                  delay={i * 40}
                  canCollect={props.canCollect}
                  canOpen={props.canOpenChildren}
                  onTakeOut={props.canChange ? () => setTaking((t) => ({ open: true, n: t.n + 1, kid: k })) : null}
                />
              ))}
            </div>
          </div>
        </Section>
      </div>
      {props.canChange ? (
        <FamilyLinkSheet
          key={`add-${adding.n}`}
          open={adding.open}
          onClose={() => setAdding((a) => ({ ...a, open: false }))}
          sessionLabel={props.sessionLabel}
          live={live}
          family={{ groupId: shown.id, kids: shown.kids }}
          onSaving={() => setHeld({ card: shown, kind: "link" })}
        />
      ) : null}
      {props.canChange && taking.kid ? (
        <FamilyUnlinkSheet
          key={`out-${taking.n}`}
          open={taking.open}
          onClose={() => setTaking((t) => ({ ...t, open: false }))}
          sessionLabel={props.sessionLabel}
          live={live}
          groupId={shown.id}
          kid={taking.kid}
          onSaving={() => setHeld({ card: shown, kind: "unlink" })}
        />
      ) : null}
    </VxPage>
  );
}

function Hero({ f, canCollect }: { f: FamilyCard; canCollect: boolean }) {
  const { tx } = useVx();
  const toast = useToast();
  const number = mobile(f.phone);
  const masked = maskedPhone(f.phone);
  const collectFor = collectChild(f);
  const parents: [string, string][] = [];
  if (f.father) parents.push([tx(W.father), f.father]);
  if (f.mother) parents.push([tx(W.mother), f.mother]);
  if (!parents.length && f.name) parents.push([tx(W.parent), f.name]);
  const contact = f.father ?? f.mother ?? f.name;
  return (
    <Card className="rise fam-hero">
      <span className="fam-hero-faces">
        {f.kids.map((k) => (
          <ChildAvatar key={k.id} text={initials(k.name)} seed={k.id} size={60} student={k.id} photo={k.hasPhoto ? undefined : null} zoom={k.name} zoomSub={k.classLabel} />
        ))}
      </span>
      <h2 className="serif fam-hero-name">{f.name}</h2>
      <dl className="fam-facts">
        {parents.map(([role, name]) => (
          <div key={role}>
            <dt>{role}</dt>
            <dd>{name}</dd>
          </div>
        ))}
        {f.village ? (
          <div>
            <dt>{tx(W.village)}</dt>
            <dd>{f.village}</dd>
          </div>
        ) : null}
      </dl>
      <div className="fam-actions">
        {number ? (
          <>
            <a href={`tel:${number}`} className="tap btn sec big" aria-label={tx(W.callWho(contact))} onClick={() => toast.show({ tone: "info", text: tx(W.opening.call(contact)), cue: "tap" })}>
              <Ic n="phone" size={20} />
              {tx(W.call)}
              {masked ? <span className="num fam-masked">{masked}</span> : null}
            </a>
            <a href={`https://wa.me/91${number}`} target="_blank" rel="noreferrer" className="tap btn sec big fam-wa" aria-label={tx(W.whatsappWho(contact))} onClick={() => toast.show({ tone: "info", text: tx(W.opening.whatsapp), cue: "tap" })}>
              <Ic n="message" size={20} />
              {tx(W.whatsapp)}
            </a>
          </>
        ) : (
          <span className="fam-nophone">
            <Ic n="phone" size={16} />
            {tx(W.noPhone)}
          </span>
        )}
        {canCollect && collectFor ? (
          <Btn
            variant="pri"
            big
            icon="rupee"
            href={`/payments?student=${collectFor}`}
          >
            {tx(W.collect)}
          </Btn>
        ) : null}
      </div>
    </Card>
  );
}

function MoneyCard({ f }: { f: FamilyCard }) {
  const { tx } = useVx();
  const read = f.feesPending !== null && f.paid !== null && f.yearFees !== null;
  return (
    <Card className="rise fam-moneycard" style={{ animationDelay: "60ms" }}>
      <CardHead title={tx(W.money.title)} />
      {read ? (
        <>
          <div className="fam-figures">
            <Figure label={tx(W.money.yearFees)} value={rupees(f.yearFees)} />
            <Figure label={tx(W.money.paid)} value={rupees(f.paid)} tone="var(--ok)" />
            <Figure label={tx(W.money.left)} value={rupees(f.feesPending)} tone={(f.feesPending ?? 0) > 0 ? "var(--warnfg)" : "var(--ok)"} />
          </div>
          {(f.yearFees ?? 0) > 0 ? (
            <Progress value={Math.min(f.paid ?? 0, f.yearFees ?? 0)} max={f.yearFees ?? 0} tone="var(--ok)" height={10} label={tx(W.money.paidPart(pct(f.paid ?? 0, f.yearFees ?? 0)))} />
          ) : null}
          {f.feesPending === 0 ? <Pill tone="ok" icon="checkCircle">{tx(W.money.allPaid)}</Pill> : null}
        </>
      ) : (
        <p className="fam-note">
          <Ic n="info" size={18} />
          {tx(W.money.notRead)}
        </p>
      )}
      {f.lateFee ? (
        <p className="fam-late">
          <Ic n="clock" size={18} />
          {tx(W.money.late(rupees(f.lateFee)))}
        </p>
      ) : null}
    </Card>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="fam-figure">
      <span className="fam-k">{label}</span>
      <span className="num fam-v" style={{ color: tone }}>{value}</span>
    </span>
  );
}

function ChildCard({ k, delay, canCollect, canOpen, onTakeOut }: { k: FamilyKid; delay: number; canCollect: boolean; canOpen: boolean; onTakeOut: (() => void) | null }) {
  const { tx } = useVx();
  const m = k.money;
  const status = k.status === "active" ? null : k.status === "left" ? W.child.left : W.child.inactive;
  return (
    <Card className="rise fam-child" style={{ animationDelay: `${delay}ms` }}>
      <div className="fam-child-head">
        <ChildAvatar text={initials(k.name)} seed={k.id} size={56} student={k.id} photo={k.hasPhoto ? undefined : null} zoom={k.name} zoomSub={k.classLabel} />
        <span className="fam-child-id">
          <strong className="clip">{k.name}</strong>
          <span className="fam-who">
            {k.classLabel || "—"}
            {k.sr ? ` · ${tx(W.child.sr(k.sr))}` : ""}
          </span>
          <span className="fam-tags">
            {status ? <Pill tone="mut">{tx(status)}</Pill> : null}
            {k.thirdChild ? <Pill tone="info" icon="users">{tx(W.child.thirdChild)}</Pill> : null}
            {m?.discountLabels.map((d) => (
              <Pill key={d} tone="acc" icon="tag">{d}</Pill>
            ))}
            {m?.overdue ? <Pill tone="bad" icon="alert">{tx(W.card.overdue)}</Pill> : null}
          </span>
        </span>
      </div>
      {m ? (
        <dl className="fam-rows">
          <Row icon="rupee" label={tx(W.child.feesLeft)} value={rupees(m.feesPending)} tone={m.feesPending > 0 ? "var(--warnfg)" : "var(--ok)"} />
          <Row icon="checkCircle" label={tx(W.child.paid)} value={rupees(m.paid)} tone="var(--ok)" />
          {m.lateFeePending > 0 ? <Row icon="clock" label={tx(W.child.late)} value={rupees(m.lateFeePending)} tone="var(--warnfg)" /> : null}
          {m.discount > 0 ? <Row icon="percent" label={tx(W.child.discount)} value={rupees(m.discount)} /> : null}
          {m.feesPending > 0 && m.nextDueDate && m.nextDueAmount ? (
            <Row icon="calendar" label={tx(W.child.nextDue)} value={tx(W.child.nextDueOn(rupees(m.nextDueAmount), tx(dateLabelP(m.nextDueDate))))} />
          ) : null}
          {m.feesPending === 0 ? (
            <div className="fam-allpaid">
              <Pill tone="ok" icon="check">{tx(W.child.allPaid)}</Pill>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="fam-note">
          <Ic n="info" size={18} />
          {tx(W.child.notRead)}
        </p>
      )}
      {canOpen || canCollect ? (
        <div className="fam-child-actions">
          {canOpen ? (
            <Btn icon="user" href={`/students/${k.id}`} ariaLabel={tx(W.child.openWho(k.name))}>
              {tx(W.child.open)}
            </Btn>
          ) : null}
          {canCollect ? (
            <Btn variant={m && m.feesPending > 0 ? "pri" : "soft"} icon="rupee" href={`/payments?student=${k.id}`} ariaLabel={tx(W.collectFor(k.name))}>
              {tx(W.collect)}
            </Btn>
          ) : null}
        </div>
      ) : null}
      {onTakeOut ? (
        <button type="button" className="tap fam-takeout" onClick={onTakeOut} aria-label={tx(W.takeOutWho(k.name))}>
          <Ic n="x" size={16} />
          {tx(W.takeOut)}
        </button>
      ) : null}
    </Card>
  );
}

function Row({ icon, label, value, tone }: { icon: IconName; label: string; value: string; tone?: string }) {
  return (
    <div className="fam-row">
      <dt>
        <Ic n={icon} size={16} />
        {label}
      </dt>
      <dd className="num" style={{ color: tone }}>{value}</dd>
    </div>
  );
}

function HelpCard({ canCollect, canOpen, canChange }: { canCollect: boolean; canOpen: boolean; canChange: boolean }) {
  const { tx } = useVx();
  const steps: [IconName, string][] = [];
  if (canCollect) steps.push(["rupee", tx(W.help.collect)]);
  if (canOpen) steps.push(["user", tx(W.help.open)]);
  if (canChange) steps.push(["userPlus", tx(W.help.change)]);
  steps.push(["clock", tx(W.help.late)]);
  return (
    <Card className="fam-help">
      <CardHead title={<><Ic n="help" size={18} />{tx(W.help.title)}</>} />
      <ol>
        {steps.map(([icon, text]) => (
          <li key={icon}>
            <span className="fam-help-ic"><Ic n={icon} size={16} /></span>
            {text}
          </li>
        ))}
      </ol>
    </Card>
  );
}
