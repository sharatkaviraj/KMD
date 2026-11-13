"use client";

import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";

import { HelpSheet, type HelpStep } from "./shared";

/*
 * "How to mark attendance", in its own chunk: fetched the first time a
 * teacher opens Help, not with the register. `/teach/attendance` is the
 * tightest page budget in One (`check:bundles`), and the pictures and both
 * languages' words are most of a kilobyte nobody needs to mark a class.
 */

const V = (x: string) => `var(--${x})`;

const MINI = (rows: [string, string][]) => (
  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 5 }}>
    {rows.map(([bg, c], i) => (
      <span key={i} className="tc-mini" style={{ background: bg }}>
        <span className="tc-msk" />
        <span style={{ width: 18, height: 12, borderRadius: 6, background: c }} />
      </span>
    ))}
  </div>
);

/** The real button's words in the reader's language, for the help picture. */
function SaveWord() {
  const { tx } = useVx();
  return <>{tx(p("Save attendance", "हाज़िरी सेव करें"))}</>;
}

const HELP: HelpStep[] = [
  { title: p("Everyone starts as Present", "सब बच्चे पहले से उपस्थित हैं।"), body: p("You do not need to tap the children who came.", "जो बच्चे आए उन पर टैप करने की ज़रूरत नहीं।"), pic: MINI([[V("oks"), V("ok")], [V("oks"), V("ok")], [V("oks"), V("ok")]]) },
  {
    title: p("Tap a child who is away", "जो बच्चा नहीं आया, उस पर टैप करें।"),
    body: p("Once = Absent (red). Tap again = Present again. For a half day, press “Half-day” on the red card.", "एक बार = अनुपस्थित (लाल)। फिर टैप = फिर उपस्थित। आधे दिन के लिए लाल कार्ड पर “आधा दिन” दबाएँ।"),
    pic: MINI([[V("card"), V("ok")], [V("bads"), V("bad")], [V("warns"), V("warn")]]),
  },
  {
    title: p("Press Save attendance", "सेव दबाएँ — कार्यालय तुरंत देख लेगा।"),
    body: p("The office sees it at once. You can change it later if you need to.", "कार्यालय तुरंत देख लेता है। ज़रूरत हो तो बाद में बदल सकते हैं।"),
    pic: (
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 5 }}>
        <span className="tc-mini"><span className="tc-msk" /><span style={{ width: 18, height: 12, borderRadius: 6, background: V("ok") }} /></span>
        <span className="tc-ib" style={{ height: 30, borderRadius: 9, background: V("pri"), color: V("prifg"), fontSize: 11, fontWeight: 700 }}><SaveWord /></span>
      </div>
    ),
  },
];

/** Only when a parent's note waits on this register (D-601). */
const ASK_STEP: HelpStep = {
  title: p("A parent's note", "अभिभावक का संदेश"),
  body: p(
    "“Parent says sick” means the parent told Veer Patta AI on WhatsApp. Press Leave or Absent under the child. Saving applies it, and no absent message goes to that parent.",
    "“अभिभावक कहते हैं: बीमार” का मतलब है कि अभिभावक ने व्हाट्सऐप पर Veer Patta AI को बताया है। बच्चे के नीचे छुट्टी या अनुपस्थित दबाएँ। सेव करने पर यह लागू होगा, और उस अभिभावक को अनुपस्थिति का संदेश नहीं जाएगा।",
  ),
  pic: (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 5 }}>
      <span className="tc-mini" style={{ background: V("warns") }}><span className="tc-msk" /><span style={{ width: 18, height: 12, borderRadius: 6, background: V("warn") }} /></span>
      <span style={{ display: "flex", gap: 4 }}>
        <span style={{ flex: 1, height: 10, borderRadius: 5, background: V("infos") }} />
        <span style={{ width: 22, height: 10, borderRadius: 5, background: V("info") }} />
      </span>
    </div>
  ),
};

export function RegisterHelp({ open, onClose, phone, asks }: { open: boolean; onClose: () => void; phone?: string; asks: boolean }) {
  return (
    <HelpSheet
      open={open}
      onClose={onClose}
      title={p("How to mark attendance", "हाज़िरी कैसे लगाएँ")}
      sub={asks ? p("4 easy steps", "4 आसान कदम") : p("3 easy steps", "3 आसान कदम")}
      steps={asks ? [...HELP.slice(0, 2), ASK_STEP, HELP[2]] : HELP}
      phone={phone}
    />
  );
}
