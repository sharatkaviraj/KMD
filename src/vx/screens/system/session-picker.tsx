"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { pickSessionAction } from "@/app/(app)/preferences/session/actions";
import { clearViewAsAction, setViewAsAction } from "@/vx/shell/view-as-actions";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";

export type SessionOption = { label: string; current: boolean; status: string };
export type RoleOption = { menu: string; label: Pair; home: string };

/*
 * P11 state `session` (design `Auth` · session): which academic year to look
 * at and — for the administrator only — which role's screens to see the app
 * as (read-only). Pick both, then Continue: the session is a cookie on this
 * browser (the fee app's session action) and "see as" is the shell's own
 * preview switch; nothing about the school changes.
 */

const T = {
  hello: (name: string) => p(`Hello, ${name}`, `नमस्ते, ${name}`),
  sub: p("Pick the year and the role to work in. You can switch any time from the menu.", "साल और भूमिका चुनें जिसमें काम करना है। मेनू से कभी भी बदल सकते हैं।"),
  session: p("Session", "सत्र"),
  workAs: p("Work as", "इस रूप में काम करें"),
  current: p("Current", "चालू"),
  closed: p("Closed", "बंद"),
  practice: p("Practice", "अभ्यास"),
  currentSub: p("The school's current session", "विद्यालय का चालू सत्र"),
  closedSub: p("Closed — for looking back", "बंद — पुराना देखने के लिए"),
  practiceSub: p("A rehearsal copy, not the real year", "अभ्यास की प्रति, असली साल नहीं"),
  openSub: p("Open", "खुला"),
  closedNote: (label: string) => p(`${label} is closed. It is there for looking back.`, `${label} बंद है। यह पुराना देखने के लिए है।`),
  me: p("Admin", "प्रशासक"),
  meSub: p("Money, students, staff and settings", "पैसा, विद्यार्थी, स्टाफ़ और सेटिंग्स"),
  previewSub: p("See their screens — nothing can be changed", "उनकी स्क्रीन देखें — कुछ बदला नहीं जा सकता"),
  go: (role: string, session: string) => p(`Continue as ${role} · ${session}`, `${role} · ${session} के रूप में आगे बढ़ें`),
  goPlain: (session: string) => p(`Continue · ${session}`, `आगे बढ़ें · ${session}`),
  now: (label: string) => p(`Now showing ${label}.`, `अब ${label} दिख रहा है।`),
};

const ROLE_LOOK: Record<string, { icon: IconName; bg: string; fg: string; sub?: Pair }> = {
  self: { icon: "shield", bg: "var(--accs)", fg: "var(--accfg)" },
  teacher: { icon: "grad", bg: "var(--warns)", fg: "var(--warnfg)", sub: p("Attendance, marks and parents of a class", "एक कक्षा की हाज़िरी, अंक और अभिभावक") },
  accountant: { icon: "rupee", bg: "var(--infos)", fg: "var(--info)", sub: p("Payment Desk, receipts, dues and reports", "भुगतान डेस्क, रसीदें, बकाया और रिपोर्ट") },
  academic: { icon: "book", bg: "var(--oks)", fg: "var(--ok)", sub: p("Marks, progress and notes across classes", "सभी कक्षाओं के अंक, प्रगति और नोट") },
  exam: { icon: "clipboard", bg: "var(--infos)", fg: "var(--info)", sub: p("Exam plan, marks tracker and results", "परीक्षा योजना, अंक और परिणाम") },
};

function Radio({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: 20, height: 20, borderRadius: 10, border: `2px solid ${on ? "var(--acc)" : "var(--bds)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--acc)", transform: `scale(${on ? 1 : 0})`, transition: "transform .25s var(--spring)" }} />
    </span>
  );
}

/** "2026-27" as the design writes a year, "2026–27"; the stored label is untouched. */
const yearLabel = (label: string) => label.replace(/(\d{4})-(\d{2})$/, "$1–$2");

const choice = (on: boolean) => ({ border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)" });

export function SessionPicker({ name, sessions, viewing, roles, previewing, home }: { name: string; sessions: SessionOption[]; viewing: string; roles: RoleOption[] | null; previewing: string | null; home: string }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [session, setSession] = useState(viewing);
  const [role, setRole] = useState<string | null>(previewing);
  const [busy, setBusy] = useState(false);

  const picked = sessions.find((s) => s.label === session);
  const roleName = role === null ? tx(T.me) : tx(roles?.find((r) => r.menu === role)?.label ?? T.me);

  async function go() {
    if (busy) return;
    setBusy(true);
    try {
      if (session !== viewing) {
        const res = await pickSessionAction(session);
        if (!res.ok) {
          toast.show({ text: res.message, tone: "bad" });
          return;
        }
        toast.show({ text: tx(T.now(res.sessionLabel)), tone: "ok" });
      }
      if (roles && role !== previewing) {
        const href = role ? await setViewAsAction(role) : await clearViewAsAction();
        router.push(href);
      } else {
        router.push(home);
      }
      router.refresh();
    } catch (error) {
      toast.show({ text: error instanceof Error ? error.message : "Could not switch.", tone: "bad" });
    } finally {
      setBusy(false);
    }
  }

  const sessionLook = (s: SessionOption) =>
    s.current
      ? { pill: T.current, pbg: "var(--oks)", pfg: "var(--ok)", sub: T.currentSub }
      : /TEST/i.test(s.label)
        ? { pill: T.practice, pbg: "var(--warns)", pfg: "var(--warnfg)", sub: T.practiceSub }
        : s.status === "closed"
          ? { pill: T.closed, pbg: "var(--s3)", pfg: "var(--mut)", sub: T.closedSub }
          : { pill: null, pbg: "", pfg: "", sub: T.openSub };

  const roleCards: { key: string | null; label: string; sub: Pair; look: (typeof ROLE_LOOK)[string] }[] = roles
    ? [{ key: null, label: tx(T.me), sub: T.meSub, look: ROLE_LOOK.self }, ...roles.map((r) => ({ key: r.menu, label: tx(r.label), sub: ROLE_LOOK[r.menu]?.sub ?? T.previewSub, look: ROLE_LOOK[r.menu] ?? ROLE_LOOK.self }))]
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 className="serif" style={{ margin: 0, fontSize: 28, fontWeight: 600, lineHeight: 1.15 }}>{tx(T.hello(name))}</h1>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.sub)}</span>
      </div>

      <div role="radiogroup" aria-label={tx(T.session)} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="sech">{tx(T.session)}</span>
        {sessions.map((s, i) => {
          const on = session === s.label;
          const look = sessionLook(s);
          return (
            <button key={s.label} type="button" role="radio" aria-checked={on} onClick={() => setSession(s.label)} className="tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderRadius: 16, ...choice(on), color: "var(--fg)", textAlign: "left", animation: `xIn .32s var(--ease) ${i * 40}ms both` }}>
              <Radio on={on} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{yearLabel(s.label)}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(look.sub)}</span>
              </span>
              {look.pill ? <span className="pill" style={{ background: look.pbg, color: look.pfg }}>{tx(look.pill)}</span> : null}
            </button>
          );
        })}
      </div>

      {roleCards.length ? (
        <div role="radiogroup" aria-label={tx(T.workAs)} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="sech">{tx(T.workAs)}</span>
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
            {roleCards.map((r, i) => {
              const on = role === r.key;
              return (
                <button key={r.key ?? "self"} type="button" role="radio" aria-checked={on} onClick={() => setRole(r.key)} className="tap" style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8, padding: 14, borderRadius: 16, ...choice(on), color: "var(--fg)", textAlign: "left", animation: `xIn .32s var(--ease) ${(i + 2) * 40}ms both` }}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 11, background: r.look.bg, color: r.look.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Ic n={r.look.icon} size={18} />
                    </span>
                    <Radio on={on} />
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{r.label}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(r.sub)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {picked && !picked.current && picked.status === "closed" ? (
        <div className="fadein" style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 14, background: "var(--infos)", color: "var(--info)", fontSize: 14, lineHeight: 1.5 }}>
          <Ic n="lock" size={18} style={{ marginTop: 2 }} />
          <span>{tx(T.closedNote(yearLabel(picked.label)))}</span>
        </div>
      ) : null}

      <button type="button" className="tap btn pri" onClick={() => void go()} disabled={busy} style={{ height: 52, fontSize: 16, borderRadius: 14 }}>
        {tx(roles ? T.go(roleName, yearLabel(session)) : T.goPlain(yearLabel(session)))}
        <Ic n="arrowRight" size={18} />
      </button>
    </div>
  );
}
