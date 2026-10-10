"use client";

import { useState } from "react";

import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Banner } from "@/vx/ui/page";
import { Btn, Card, Money, Pill, Stat, SuccessTick, WhatsAppPreview } from "@/vx/ui/primitives";

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
};

/** Admissions state `done`: the child is on the roll; what to do next. */
export function AdmissionDone({ info }: { info: DoneInfo }) {
  const { tx } = useVx();
  const toast = useToast();
  const [welcome, setWelcome] = useState(false);

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

  return (
    <div className="pp-wrap" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PeopleStyles />
      <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10 }}>
        <SuccessTick />
        <h2 className="serif" style={{ margin: 0, fontSize: 24 }}>
          {tx(p(`${info.name} admitted to ${info.classLabel}`, `${info.name} का ${info.classLabel} में दाख़िला हुआ`))}
        </h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <Pill tone="acc" icon="hash">SR {info.sr}</Pill>
          {info.phone ? <Pill tone="mut" icon="phone">{maskPhone(info.phone)}</Pill> : null}
        </div>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>
          {tx(p(`Saved by ${info.savedBy}. The fee record is ready.`, `${info.savedBy} ने सहेजा। फीस का रिकॉर्ड तैयार है।`))}
        </span>
      </Card>

      <Card style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
        <Stat label={tx(p("Pending today", "आज तक बाकी"))} value={<Money value={info.pendingToday} />} tone={info.pendingToday > 0 ? "var(--warn)" : undefined} />
        <Stat label={tx(p("Not due yet", "अभी देय नहीं"))} value={<Money value={info.notDueYet} />} sub={tx(p("Shown apart, never added", "अलग दिखाया, जोड़ा नहीं"))} />
      </Card>

      {info.missingDocs.length > 0 ? (
        <Banner tone="warn">{tx(p(`Documents still to collect: ${info.missingDocs.join(", ")}`, `अभी लेने बाकी काग़ज़: ${info.missingDocs.join(", ")}`))}</Banner>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
        <Btn variant="pri" big icon="rupee" href={`/payments?studentId=${info.studentId}`}>{tx(p("Collect fees now", "अभी फीस लें"))}</Btn>
        <Btn variant="sec" big icon="message" onClick={() => setWelcome(true)}>{tx(p("Welcome message", "स्वागत संदेश"))}</Btn>
        <Btn variant="sec" big icon="printer" onClick={() => window.print()}>{tx(p("Print admission slip", "दाख़िला पर्ची छापें"))}</Btn>
        <Btn variant="ghost" big icon="userPlus" href="/admissions/new">{tx(p("Add another student", "एक और विद्यार्थी जोड़ें"))}</Btn>
      </div>
      <Btn variant="ghost" icon="edit" href={`/admissions/${info.studentId}`}>{tx(p("Open the record", "रिकॉर्ड खोलें"))}</Btn>

      <Sheet
        open={welcome}
        onClose={() => setWelcome(false)}
        title={tx(p("Welcome message", "स्वागत संदेश"))}
        sub={tx(p("Copy it and send it from the school phone. Nothing is sent from here.", "कॉपी करके स्कूल के फ़ोन से भेजें। यहाँ से कुछ नहीं जाता।"))}
        icon="message"
        footer={<Btn variant="pri" full icon="copy" onClick={copy}>{tx(p("Copy message", "संदेश कॉपी करें"))}</Btn>}
      >
        <WhatsAppPreview lines={lines} title={info.phone ? maskPhone(info.phone) : tx(p("Parent", "अभिभावक"))} />
      </Sheet>
    </div>
  );
}
