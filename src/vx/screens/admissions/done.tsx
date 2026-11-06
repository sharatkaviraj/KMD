"use client";

import Link from "@/ui/link";
import { useState } from "react";

import { rupees, shortDay } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p } from "@/vx/text";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { TopBar } from "@/vx/ui/page";
import { Btn, WhatsAppPreview } from "@/vx/ui/primitives";

import { firstName, maskPhone } from "@/vx/screens/admissions/logic";
import { PeopleStyles } from "@/vx/screens/admissions/ui";

export type DoneInfo = {
  studentId: string;
  name: string;
  classLabel: string;
  sr: string;
  fatherName: string | null;
  phone: string | null;
  savedBy: string;
  pendingToday: number;
  notDueYet: number;
  missingDocs: string[];
  schoolName: string;
  /** When it was saved; defaults to now. */
  savedAt?: string;
};

/** Admissions state `done`: the child is on the roll; what to do next. */
export function AdmissionDone({ info }: { info: DoneInfo }) {
  const { tx } = useVx();
  const toast = useToast();
  const [welcome, setWelcome] = useState(false);

  // Copy-only (UI-50): nothing is sent from here.
  const lines = [
    `Namaste ${info.fatherName ?? ""}`.trim() + ",",
    `${firstName(info.name)} is now a student of ${info.schoolName}, ${info.classLabel}.`,
    `SR number: ${info.sr}`,
    info.pendingToday > 0 ? `Fees due today: Rs ${info.pendingToday.toLocaleString("en-IN")}` : "No fee is due today.",
    "Welcome to the school family.",
  ];

  async function copy() {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.show({ text: tx(p("Message copied. Paste it in WhatsApp.", "संदेश कॉपी हुआ। WhatsApp में चिपकाएँ।")), tone: "ok" });
    } catch {
      toast.show({ text: tx(p("Could not copy. Select the text and copy it.", "कॉपी नहीं हुआ। लिखावट चुनकर कॉपी करें।")), tone: "bad" });
    }
  }

  const sub = [
    tx(p(`Saved by ${firstName(info.savedBy)}`, `${firstName(info.savedBy)} ने सहेजा`)),
    shortDay(info.savedAt ?? new Date()),
    `${rupees(info.pendingToday)} ${tx(p("pending today", "आज बकाया"))}`,
    `${rupees(info.notDueYet)} ${tx(p("not due yet", "अभी देय नहीं"))}`,
  ].join(" · ") + (info.missingDocs.length ? ` · ${tx(p("still to collect", "अभी लेने हैं"))}: ${info.missingDocs.join(", ")}` : "");

  return (
    <>
      <PeopleStyles />
      <TopBar crumb={tx(p("Admissions", "दाख़िले"))} title={tx(p("Admission saved", "प्रवेश सहेजा"))} mSub={`${info.name} · SR ${info.sr}`} mBack="/admissions" />
      <main>
        <div className="pad" style={{ padding: "22px 28px 40px", animation: "xIn .4s var(--ease) both" }}>
          <div className="card" style={{ maxWidth: 640, margin: "0 auto", padding: "30px 26px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
            <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true" style={{ animation: "xPopIn .5s var(--spring) both" }}>
              <circle cx="48" cy="48" r="44" style={{ fill: "var(--oks)" }} />
              <circle cx="48" cy="48" r="44" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 4, ["--len" as string]: "276.5", strokeDasharray: 276.5, animation: "xDraw .7s .1s var(--ease) both" }} />
              <path d="M30 49l12 12 24-26" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: "60", strokeDasharray: 60, animation: "xDraw .45s .5s var(--ease) both" }} />
            </svg>
            <h2 className="serif" style={{ margin: 0, fontSize: 26, fontWeight: 600, lineHeight: 1.25 }}>
              {tx(p(`${info.name} admitted to ${info.classLabel}`, `${info.name} का ${info.classLabel} में दाख़िला हुआ`))}
            </h2>
            <span className="pill num" style={{ height: 30, padding: "0 14px", fontSize: 14, background: "var(--infos)", color: "var(--info)", animation: "xPopIn .45s .7s var(--spring) both" }}>SR {info.sr}</span>
            <span style={{ fontSize: 14, color: "var(--mut)" }}>{sub}</span>
            <div className="pp-g2" style={{ width: "100%", marginTop: 10, gap: 10 }}>
              <Btn variant="pri" icon="rupee" href={`/payments?studentId=${info.studentId}`} style={{ height: 48 }}>
                {info.pendingToday > 0 ? tx(p(`Collect ${rupees(info.pendingToday)} now`, `अभी ${rupees(info.pendingToday)} लें`)) : tx(p("Collect fees", "फीस लें"))}
              </Btn>
              <Btn variant="sec" icon="message" onClick={() => setWelcome(true)} style={{ height: 48 }}>{tx(p("Welcome message", "स्वागत संदेश"))}</Btn>
              <Btn variant="sec" icon="printer" onClick={() => window.print()} style={{ height: 48 }}>{tx(p("Print admission form", "प्रवेश फ़ॉर्म छापें"))}</Btn>
              <Btn variant="soft" icon="userPlus" href="/admissions/new" style={{ height: 48 }}>{tx(p("Add another", "एक और जोड़ें"))}</Btn>
            </div>
            <Link href={`/admissions/${info.studentId}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 13, fontWeight: 600, color: "var(--acc)" }}>
              {tx(p("Open the record", "रिकॉर्ड खोलें"))} <Ic n="chevRight" size={14} />
            </Link>
          </div>
        </div>
      </main>

      <Sheet
        open={welcome}
        onClose={() => setWelcome(false)}
        title={tx(p("Welcome message", "स्वागत संदेश"))}
        sub={`${info.fatherName ?? tx(p("Parent", "अभिभावक"))}${info.phone ? ` · ${maskPhone(info.phone)}` : ""} · ${tx(p("copy it and send it from the school phone", "कॉपी करके स्कूल के फ़ोन से भेजें"))}`}
        footer={
          <>
            <Btn variant="sec" style={{ flex: 1 }} onClick={() => setWelcome(false)}>{tx(p("Not now", "अभी नहीं"))}</Btn>
            <Btn variant="pri" icon="copy" style={{ flex: 1.4 }} onClick={copy}>{tx(p("Copy message", "संदेश कॉपी करें"))}</Btn>
          </>
        }
      >
        <WhatsAppPreview lines={lines} title={info.phone ? maskPhone(info.phone) : tx(p("Parent", "अभिभावक"))} />
      </Sheet>
    </>
  );
}
