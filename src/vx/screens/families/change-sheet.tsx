"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  findFamilyChildrenAction,
  previewFamilyChangeAction,
  saveFamilyChangeAction,
  type FamilyProblem,
  type FamilySaved,
} from "@/app/(app)/families/actions";
import type { FamilyPreview } from "@/platform/fees-bridge/family-command-contracts";
import { cue } from "@/ui/feedback/cue";
import { useVoiceSearch } from "@/ui/hooks/use-voice-search";
import { initials, rupees } from "@/vx/format";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { ChildAvatar } from "@/vx/ui/child-avatar";
import { SearchBox } from "@/vx/ui/controls";
import { Sheet } from "@/vx/ui/overlays";
import { Btn, Pill } from "@/vx/ui/primitives";

import { firstName, newCommandId, thirdChildNotes, type ThirdChildNote } from "./logic";
import { W } from "./words";

/*
 * Linking brothers and sisters, and taking one out, from One's Families
 * screens (owner, 8 Nov 2026). Two steps a new member of staff can follow:
 * find the children, then see exactly what changes in fees before anything
 * is saved. Every wait shows that something is happening; a saved change
 * says so with a tick and a sound. A lost answer is retried with the same
 * command id, so it can never link twice.
 */

export type SheetKid = { id: string; name: string; classLabel: string; hasPhoto: boolean; sr?: string; father?: string | null };

type Step =
  | { at: "pick" }
  | { at: "check" }
  | { at: "ready"; preview: FamilyPreview }
  | { at: "saving"; preview: FamilyPreview }
  | { at: "saved"; preview: FamilyPreview; saved: FamilySaved }
  | { at: "problem"; problem: FamilyProblem; preview: FamilyPreview | null };

/* ------------------------------------------------------------------ link */

export function FamilyLinkSheet({
  open,
  onClose,
  sessionLabel,
  live,
  family,
  onSaving,
}: {
  open: boolean;
  onClose: () => void;
  sessionLabel: string;
  /** Fees answers (a real year), else One's TEST copy. Only the waiting words differ. */
  live: boolean;
  /** Adding to this family; null links children from scratch. */
  family: { groupId: string; kids: SheetKid[] } | null;
  /** Told before the save goes out: the save can fold this page's family into an older one. */
  onSaving?: () => void;
}) {
  const { tx } = useVx();
  const router = useRouter();
  const base = family?.kids ?? [];
  const [picked, setPicked] = useState<SheetKid[]>([]);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ query: string; kids: SheetKid[] } | null>(null);
  const [step, setStep] = useState<Step>({ at: "pick" });
  const commandId = useRef<string>("");
  const voice = useVoiceSearch((heard) => setQuery(heard));

  const trimmed = query.trim();
  // Search as the person types, a moment after they stop.
  useEffect(() => {
    if (trimmed.length < 2) return undefined;
    let current = true;
    const t = window.setTimeout(() => {
      void findFamilyChildrenAction({ sessionLabel, query: trimmed }).then((r) => {
        if (current) setFound({ query: trimmed, kids: r.ok ? r.children : [] });
      });
    }, 300);
    return () => {
      current = false;
      window.clearTimeout(t);
    };
  }, [trimmed, sessionLabel]);

  const searching = trimmed.length >= 2 && found?.query !== trimmed;
  const results = trimmed.length >= 2 && found?.query === trimmed ? found.kids : [];
  const inFamily = new Set(base.map((k) => k.id));
  const pickedIds = new Set(picked.map((k) => k.id));
  const total = base.length + picked.length;
  const canCheck = picked.length >= 1 && total >= 2;

  function toggle(kid: SheetKid) {
    if (inFamily.has(kid.id)) return;
    cue("select");
    setPicked((now) => (now.some((k) => k.id === kid.id) ? now.filter((k) => k.id !== kid.id) : [...now, kid]));
  }

  function check() {
    cue("tap");
    setStep({ at: "check" });
    commandId.current = newCommandId();
    void previewFamilyChangeAction({ sessionLabel, operation: "link", studentIds: [...base, ...picked].map((k) => k.id) }).then((r) => {
      setStep(r.ok ? { at: "ready", preview: r.preview } : { at: "problem", problem: r.problem, preview: null });
      cue(r.ok ? "ready" : "warn");
    });
  }

  function save(preview: FamilyPreview) {
    cue("tap");
    setStep({ at: "saving", preview });
    onSaving?.();
    void saveFamilyChangeAction({
      kind: "family_link",
      commandId: commandId.current,
      sessionLabel,
      studentIds: preview.studentIds,
      expectedMemberIds: preview.expectedMemberIds,
    }).then((r) => {
      if (r.ok) {
        cue("success");
        setStep({ at: "saved", preview, saved: r });
        router.refresh();
      } else {
        cue("error");
        setStep({ at: "problem", problem: r.problem, preview });
      }
    });
  }

  function openFamily(groupId: string | null) {
    onClose();
    if (groupId && groupId !== family?.groupId) router.push(`/families/${groupId}`);
  }

  const title = family ? tx(W.link.addTitle) : tx(W.link.title);
  const sub = step.at === "pick" ? tx(W.link.step1) : tx(W.link.step2);

  let body: ReactNode;
  let footer: ReactNode;
  if (step.at === "pick") {
    body = (
      <div className="famx">
        <section className="famx-picked" aria-live="polite">
          <span className="famx-label">{tx(W.link.picked)}</span>
          {total === 0 ? <span className="famx-muted">{tx(W.link.pickedNone)}</span> : null}
          <span className="famx-chips">
            {base.map((k) => (
              <span key={k.id} className="famx-chip locked">
                <ChildAvatar text={initials(k.name)} seed={k.id} size={32} student={k.id} photo={k.hasPhoto ? undefined : null} />
                {firstName(k.name)}
                <Ic n="lock" size={14} />
              </span>
            ))}
            {picked.map((k) => (
              <button key={k.id} type="button" className="tap famx-chip" onClick={() => toggle(k)} aria-label={tx(W.link.remove(k.name))}>
                <ChildAvatar text={initials(k.name)} seed={k.id} size={32} student={k.id} photo={k.hasPhoto ? undefined : null} />
                {firstName(k.name)}
                <Ic n="x" size={16} />
              </button>
            ))}
          </span>
        </section>
        <div className="famx-find">
          <SearchBox value={query} onChange={setQuery} placeholder={tx(W.link.find)} autoFocus style={{ flex: 1, height: 52 }} />
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
            </button>
          ) : null}
        </div>
        {trimmed.length < 2 ? <p className="famx-muted">{tx(W.link.findHint)}</p> : null}
        {searching ? (
          <p className="famx-muted famx-busy">
            <Ic n="refresh" size={16} className="spin" />
            {tx(W.link.searching)}
          </p>
        ) : null}
        {!searching && trimmed.length >= 2 && results.length === 0 ? <p className="famx-muted">{tx(W.link.none(trimmed))}</p> : null}
        <div className="famx-results">
          {results.map((k, i) => {
            const locked = inFamily.has(k.id);
            const on = locked || pickedIds.has(k.id);
            return (
              <button
                key={k.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-disabled={locked}
                aria-label={tx(W.link.pick(k.name))}
                className={`tap famx-row${on ? " on" : ""}`}
                style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                onClick={() => toggle(k)}
              >
                <span className="famx-box" aria-hidden="true">{on ? <Ic n="check" size={16} stroke={3} /> : null}</span>
                <ChildAvatar text={initials(k.name)} seed={k.id} size={44} student={k.id} photo={k.hasPhoto ? undefined : null} />
                <span className="famx-who">
                  <strong className="clip">{k.name}</strong>
                  <span className="clip">
                    {[k.classLabel, k.sr ? tx(W.child.sr(k.sr)) : null, k.father ? tx(W.card.father(k.father)) : null].filter(Boolean).join(" · ")}
                  </span>
                  {locked ? <span className="famx-tag">{tx(W.link.already)}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
    footer = (
      <>
        <Btn variant="sec" style={{ flex: 1 }} onClick={onClose}>{tx(W.problem.close)}</Btn>
        <Btn variant="pri" big icon="arrowRight" style={{ flex: 1.6 }} disabled={!canCheck} onClick={check}>
          {canCheck ? tx(W.link.next) : tx(family ? W.link.needOne : W.link.needTwo)}
        </Btn>
      </>
    );
  } else if (step.at === "check") {
    body = <Working text={tx(live ? W.link.checking : W.link.checkingLocal)} />;
    footer = null;
  } else if (step.at === "ready") {
    body = <PreviewView preview={step.preview} />;
    footer = (
      <>
        <Btn variant="sec" icon="chevLeft" style={{ flex: 1 }} onClick={() => setStep({ at: "pick" })}>{tx(W.link.back)}</Btn>
        <Btn variant="pri" big icon="link" style={{ flex: 1.6 }} onClick={() => save(step.preview)}>{tx(W.link.save)}</Btn>
      </>
    );
  } else if (step.at === "saving") {
    body = <Working text={tx(W.link.saving)} />;
    footer = null;
  } else if (step.at === "saved") {
    const n = step.saved.memberIds.length || step.preview.after.family.length;
    body = (
      <Saved text={tx(W.link.saved(n))}>
        {!step.saved.settled ? <p className="famx-warn"><Ic n="info" size={18} />{tx(W.problem.unsettled)}</p> : null}
      </Saved>
    );
    footer = !step.saved.settled ? (
      <Btn variant="pri" big icon="refresh" full onClick={() => save(step.preview)}>{tx(W.problem.finish)}</Btn>
    ) : (
      <>
        {/* On a family page, Done lands on the family the children are now in: this one may be gone. */}
        <Btn variant="sec" style={{ flex: 1 }} onClick={family ? () => openFamily(step.saved.familyGroupId) : onClose}>{tx(W.link.done)}</Btn>
        {step.saved.familyGroupId && step.saved.familyGroupId !== family?.groupId ? (
          <Btn variant="pri" big icon="home" style={{ flex: 1.6 }} onClick={() => openFamily(step.saved.familyGroupId)}>{tx(W.link.openFamily)}</Btn>
        ) : null}
      </>
    );
  } else {
    body = <Problem problem={step.problem} />;
    footer = (
      <ProblemActions
        problem={step.problem}
        onClose={onClose}
        onRetry={() => (step.problem === "uncertain" && step.preview ? save(step.preview) : check())}
        onBack={() => setStep({ at: "pick" })}
      />
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={title} sub={sub} icon="userPlus" footer={footer} wide dismissable={step.at !== "saving"}>
      {body}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- unlink */

export function FamilyUnlinkSheet({
  open,
  onClose,
  sessionLabel,
  live,
  groupId,
  kid,
  onSaving,
}: {
  open: boolean;
  onClose: () => void;
  sessionLabel: string;
  live: boolean;
  groupId: string;
  kid: SheetKid;
  /** Told before the save goes out: taking out the second-last child ends the family. */
  onSaving?: () => void;
}) {
  const { tx } = useVx();
  const router = useRouter();
  // Mounted once per tap (keyed by the caller), so the check starts at once.
  const [step, setStep] = useState<Step>({ at: "check" });
  const commandId = useRef<string>("");
  const [round, setRound] = useState(0);

  useEffect(() => {
    let current = true;
    commandId.current = newCommandId();
    void previewFamilyChangeAction({ sessionLabel, operation: "unlink", studentId: kid.id, familyGroupId: groupId }).then((r) => {
      if (!current) return;
      setStep(r.ok ? { at: "ready", preview: r.preview } : { at: "problem", problem: r.problem, preview: null });
      cue(r.ok ? "ready" : "warn");
    });
    return () => {
      current = false;
    };
  }, [sessionLabel, kid.id, groupId, round]);

  function again() {
    setStep({ at: "check" });
    setRound((n) => n + 1);
  }

  function save(preview: FamilyPreview) {
    cue("tap");
    setStep({ at: "saving", preview });
    onSaving?.();
    void saveFamilyChangeAction({
      kind: "family_unlink",
      commandId: commandId.current,
      sessionLabel,
      studentId: kid.id,
      familyGroupId: groupId,
      expectedMemberIds: preview.expectedMemberIds,
    }).then((r) => {
      if (r.ok) {
        cue("success");
        setStep({ at: "saved", preview, saved: r });
      } else {
        cue("error");
        setStep({ at: "problem", problem: r.problem, preview });
      }
    });
  }

  function finish(saved: FamilySaved) {
    onClose();
    if (saved.familyGroupId) router.refresh();
    else router.push("/families");
  }

  const name = firstName(kid.name);
  let body: ReactNode;
  let footer: ReactNode;
  if (step.at === "check") {
    body = <Working text={tx(live ? W.link.checking : W.link.checkingLocal)} />;
    footer = null;
  } else if (step.at === "ready") {
    const p = step.preview;
    const left = p.children.filter((c) => p.after.family.includes(c.studentId));
    const leftAlone = p.after.alone.filter((id) => id !== kid.id);
    const other = p.children.find((c) => leftAlone.includes(c.studentId));
    body = (
      <div className="famx">
        <div className="famx-leaving">
          <ChildAvatar text={initials(kid.name)} seed={kid.id} size={56} student={kid.id} photo={kid.hasPhoto ? undefined : null} />
          <span className="famx-who">
            <strong>{kid.name}</strong>
            <span>{kid.classLabel}</span>
          </span>
          {/* Arrow and words wrap together under the name on a phone, never over it. */}
          <span className="famx-goes">
            <Ic n="arrowRight" size={20} />
            <span className="famx-tag">{tx(W.unlink.leaves(name))}</span>
          </span>
        </div>
        <p className="famx-after">
          <Ic n="users" size={18} />
          {left.length >= 2 ? tx(W.unlink.keeps(left.length)) : other ? tx(W.unlink.ends(firstName(other.fullName))) : tx(W.unlink.endsAlone)}
        </p>
        <ThirdChildBox preview={p} />
        <p className="famx-muted">{tx(W.link.paidStays)}</p>
      </div>
    );
    footer = (
      <>
        <Btn variant="sec" style={{ flex: 1 }} onClick={onClose}>{tx(W.unlink.cancel)}</Btn>
        <Btn variant="danger" big icon="x" style={{ flex: 1.6 }} onClick={() => save(p)}>{tx(W.unlink.save)}</Btn>
      </>
    );
  } else if (step.at === "saving") {
    body = <Working text={tx(W.link.saving)} />;
    footer = null;
  } else if (step.at === "saved") {
    const saved = step.saved;
    body = (
      <Saved text={saved.familyGroupId ? tx(W.unlink.saved(name)) : tx(W.unlink.savedEnded)}>
        {!saved.settled ? <p className="famx-warn"><Ic n="info" size={18} />{tx(W.problem.unsettled)}</p> : null}
      </Saved>
    );
    footer = !saved.settled ? (
      <Btn variant="pri" big icon="refresh" full onClick={() => save(step.preview)}>{tx(W.problem.finish)}</Btn>
    ) : (
      <Btn variant="pri" big icon="check" full onClick={() => finish(saved)}>{tx(W.link.done)}</Btn>
    );
  } else if (step.at === "problem") {
    body = <Problem problem={step.problem} />;
    footer = (
      <ProblemActions
        problem={step.problem}
        onClose={onClose}
        onRetry={() => (step.problem === "uncertain" && step.preview ? save(step.preview) : again())}
        onBack={null}
      />
    );
  } else {
    // An unlink has no picking step.
    body = null;
    footer = null;
  }

  return (
    <Sheet open={open} onClose={onClose} title={tx(W.unlink.title(name))} icon="users" footer={footer} dismissable={step.at !== "saving"}>
      {body}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- pieces */

function Working({ text }: { text: string }) {
  return (
    <div className="famx-working" role="status" aria-live="polite">
      <span className="famx-spinner" aria-hidden="true">
        <Ic n="users" size={26} />
      </span>
      <strong>{text}</strong>
      <span className="famx-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

function Saved({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="famx-saved" role="status" aria-live="polite">
      <span className="famx-tick" aria-hidden="true">
        <Ic n="check" size={34} stroke={3} />
      </span>
      <strong>{text}</strong>
      {children}
    </div>
  );
}

function PreviewView({ preview }: { preview: FamilyPreview }) {
  const { tx } = useVx();
  const family = preview.children.filter((c) => preview.after.family.includes(c.studentId));
  return (
    <div className="famx">
      <div className="famx-afterhead">
        <span className="fam-faces">
          {family.slice(0, 5).map((c) => (
            <ChildAvatar key={c.studentId} text={initials(c.fullName)} seed={c.studentId} size={44} student={c.studentId} photo={c.hasPhoto ? undefined : null} />
          ))}
        </span>
        <strong>{tx(W.link.afterTitle(family.length))}</strong>
      </div>
      {preview.familiesNow >= 2 ? (
        <p className="famx-after">
          <Ic n="link" size={18} />
          {tx(W.link.merge(preview.familiesNow))}
        </p>
      ) : null}
      <ThirdChildBox preview={preview} />
      <ul className="famx-kids">
        {preview.children.map((c, i) => (
          <li key={c.studentId} className="famx-kid" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
            <ChildAvatar text={initials(c.fullName)} seed={c.studentId} size={40} student={c.studentId} photo={c.hasPhoto ? undefined : null} />
            <span className="famx-who">
              <strong className="clip">{c.fullName}</strong>
              <span className="clip">{[c.classLabel, c.admissionNo ? tx(W.child.sr(c.admissionNo)) : null].filter(Boolean).join(" · ")}</span>
              <span className="fam-tags">
                {!c.inThisYear ? <Pill tone="mut">{tx(W.link.otherYear)}</Pill> : null}
                {c.staffChild ? <Pill tone="acc" icon="tag">{tx(W.link.staffChild)}</Pill> : null}
                {c.thirdChildNow ? <Pill tone="info" icon="users">{tx(W.link.thirdNow)}</Pill> : null}
              </span>
            </span>
            <span className="famx-money">
              {c.money ? (
                <>
                  <span className="num" style={{ color: c.money.feesPending > 0 ? "var(--warnfg)" : "var(--ok)" }}>{tx(W.link.feesLeft(rupees(c.money.feesPending)))}</span>
                  {c.money.lateFeePending > 0 ? <span className="num famx-late">{tx(W.link.lateApart(rupees(c.money.lateFeePending)))}</span> : null}
                </>
              ) : (
                <span className="famx-muted">{c.inThisYear ? tx(W.link.moneyNotRead) : null}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {preview.children.some((c) => !c.inThisYear) ? <p className="famx-muted">{tx(W.link.otherYearNote)}</p> : null}
      <p className="famx-muted">{tx(W.link.paidStays)}</p>
    </div>
  );
}

function ThirdChildBox({ preview }: { preview: FamilyPreview }) {
  const { tx } = useVx();
  const nameOf = (id: string) => preview.children.find((c) => c.studentId === id);
  const line = (n: ThirdChildNote): { tone: "ok" | "warn" | "info"; text: string } => {
    switch (n.kind) {
      case "off":
        return { tone: "info", text: tx(W.third.off) };
      case "needThree":
        return { tone: "info", text: tx(W.third.needThree(n.count)) };
      case "gets": {
        const c = nameOf(n.studentId);
        const money = n.feesStay
          ? ` ${tx(W.third.alreadyLess(firstName(c?.fullName ?? "—")))}`
          : n.tuition !== null && n.base !== null
            ? ` ${tx(W.third.tuition(rupees(n.tuition), rupees(n.base)))}`
            : n.tuition !== null
              ? ` ${tx(W.third.tuitionTo(rupees(n.tuition)))}`
              : "";
        return { tone: "ok", text: `${tx(W.third.gets(c?.fullName ?? "—", c?.classLabel ?? "—"))}${money}` };
      }
      case "keeps":
        return { tone: "ok", text: tx(W.third.keeps(nameOf(n.studentId)?.fullName ?? "—")) };
      case "staff":
        return { tone: "info", text: tx(W.third.staff(nameOf(n.studentId)?.fullName ?? "—")) };
      case "loses": {
        const first = firstName(nameOf(n.studentId)?.fullName ?? "—");
        return n.feesStay ? { tone: "info", text: tx(W.third.losesSame(first)) } : { tone: "warn", text: tx(W.third.loses(first)) };
      }
      case "same":
        return { tone: "info", text: tx(W.third.same) };
    }
  };
  return (
    <section className="famx-third">
      <span className="famx-label">{tx(W.third.title)}</span>
      {thirdChildNotes(preview).map((n, i) => {
        const l = line(n);
        return (
          <p key={`${n.kind}-${i}`} className={`famx-note ${l.tone}`}>
            <Ic n={l.tone === "warn" ? "alert" : l.tone === "ok" ? "checkCircle" : "info"} size={18} />
            {l.text}
          </p>
        );
      })}
    </section>
  );
}

function Problem({ problem }: { problem: FamilyProblem }) {
  const { tx } = useVx();
  return (
    <div className="famx-problem" role="alert">
      <span className="famx-problem-ic" aria-hidden="true">
        <Ic n={problem === "uncertain" ? "refresh" : "alert"} size={26} />
      </span>
      <p>{tx(W.problem[problem])}</p>
    </div>
  );
}

function ProblemActions({ problem, onClose, onRetry, onBack }: { problem: FamilyProblem; onClose: () => void; onRetry: () => void; onBack: (() => void) | null }) {
  const { tx } = useVx();
  const stuck = problem === "not_enabled" || problem === "read_only" || problem === "family_conflict" || problem === "not_found";
  if (stuck) return <Btn variant="sec" big full onClick={onClose}>{tx(W.problem.close)}</Btn>;
  return (
    <>
      {onBack && problem !== "uncertain" ? (
        <Btn variant="sec" icon="chevLeft" style={{ flex: 1 }} onClick={onBack}>{tx(W.link.back)}</Btn>
      ) : (
        <Btn variant="sec" style={{ flex: 1 }} onClick={onClose}>{tx(W.problem.close)}</Btn>
      )}
      <Btn variant="pri" big icon="refresh" style={{ flex: 1.6 }} onClick={onRetry}>
        {problem === "family_changed" ? tx(W.problem.checkAgain) : tx(W.problem.retry)}
      </Btn>
    </>
  );
}
