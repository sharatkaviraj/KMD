"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { VxPage } from "@/vx/ui/page";
import { HelpIcon, HelpSheet, LangSeg, TchTop, type HelpStep } from "@/vx/screens/teach/ui/shared";

import "./task.css";

/*
 * The frame of My tasks and of one task: the teacher screens' own top bar
 * (Back, the title, the language switch and "?"), and room at the bottom so
 * the task's Send bar sits above the phone's bottom menu, not under it
 * (smoke 20 Oct: a teacher typed an address and could not find Send; the
 * task screen had no header, no Back and no help).
 */

const HELP: HelpStep[] = [
  { title: p("Read what the office needs", "देखें ऑफ़िस को क्या चाहिए"), body: p("The line at the top says what to fill in, for which children, and by when.", "ऊपर लिखा है कि क्या भरना है, किन बच्चों का और कब तक।"), icon: "inbox" },
  { title: p("Fill it in", "भरें"), body: p("Type the details or add a photo for each child. What you type stays on this phone until you send it.", "हर बच्चे का विवरण लिखें या फ़ोटो लगाएँ। भेजने तक लिखा हुआ इसी फ़ोन में रहता है।"), icon: "edit" },
  { title: p("Send it to the office", "ऑफ़िस को भेजें"), body: p("Tap Send at the bottom. The office checks it; you will see it under “Sent · the office is checking”.", "नीचे भेजें दबाएँ। ऑफ़िस जाँचेगा; यह “भेज दिया · ऑफ़िस देख रहा है” में दिखेगा।"), icon: "send" },
];

export function TaskShell({ title, back, intro, phone, children }: { title: string | Pair; back: string; intro?: Pair | null; phone?: string; children: ReactNode }) {
  const { tx, sub } = useVx();
  const [help, setHelp] = useState(false);
  const heading = typeof title === "string" ? title : tx(title);
  const helpLabel = tx(p("Help", "मदद"));
  return (
    <VxPage className="tc tc-task">
      <TchTop
        crumb={tx(p("More · My tasks", "और · मेरे काम"))}
        title={heading}
        actions={
          <>
            <LangSeg />
            <button type="button" className="tap btn sec" onClick={() => setHelp(true)}>
              <Ic n="help" />
              {helpLabel}
            </button>
          </>
        }
        mBack={back}
        mTitle={heading}
        mAction={
          <>
            <LangSeg />
            <HelpIcon onClick={() => setHelp(true)} label={helpLabel} />
          </>
        }
      />
      <main>
        <section className="pad tc-task-body" style={{ padding: "18px 16px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 760, margin: "0 auto", width: "100%" }}>
          {intro ? (
            <div className="tc-note" style={{ background: "var(--infos)", color: "var(--info)" }}>
              <Ic n="inbox" style={{ marginTop: 2 }} />
              <span style={{ display: "flex", flexDirection: "column" }}>
                <b>{tx(intro)}</b>
                {sub(intro) ? <span style={{ fontSize: 13 }}>{sub(intro)}</span> : null}
              </span>
            </div>
          ) : null}
          {children}
        </section>
      </main>
      <HelpSheet open={help} onClose={() => setHelp(false)} title={p("How to answer a task", "काम का जवाब कैसे दें")} sub={p("3 easy steps", "3 आसान कदम")} steps={HELP} phone={phone} />
    </VxPage>
  );
}
