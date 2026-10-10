"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { fixQualityAction, skipQualityAction, unskipQualityAction } from "@/app/(app)/student-tools/actions";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { Chip, ChipRow, Input } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { Avatar, Btn, Card, EmptyState, Pill, Ring } from "@/vx/ui/primitives";

import { PeopleStyles } from "@/vx/screens/admissions/ui";
import { QUALITY_ISSUES, type QualityIssue } from "@/vx/screens/student-tools/logic";

export type QualityItem = { studentId: string; name: string; classLabel: string; issue: QualityIssue; detail: string | null; otherId: string | null };

const ISSUE_LABEL: Record<QualityIssue, Pair> = {
  father_phone: p("Phone number missing or wrong", "फ़ोन नंबर नहीं या ग़लत"),
  dob: p("Birth date missing", "जन्म तिथि नहीं"),
  mother_name: p("Mother's name missing", "माता का नाम नहीं"),
  duplicate: p("May be entered twice", "शायद दो बार दर्ज"),
  age: p("Age does not fit the class", "उम्र कक्षा से मेल नहीं खाती"),
  address: p("Address missing", "पता नहीं"),
};
const SHORT: Record<QualityIssue, Pair> = {
  father_phone: p("Phone", "फ़ोन"),
  dob: p("Birth date", "जन्म तिथि"),
  mother_name: p("Mother", "माता"),
  duplicate: p("Twice", "दो बार"),
  age: p("Age", "उम्र"),
  address: p("Address", "पता"),
};
const PLACEHOLDER: Partial<Record<QualityIssue, Pair>> = {
  father_phone: p("10-digit mobile", "10 अंकों का मोबाइल"),
  dob: p("DD-MM-YYYY", "DD-MM-YYYY"),
  age: p("Correct birth date DD-MM-YYYY", "सही जन्म तिथि DD-MM-YYYY"),
  mother_name: p("Mother's name", "माता का नाम"),
  address: p("Address", "पता"),
};

/** Student tools state `quality`: what is missing or wrong, fixed one by one. */
export function QualityList({ items, total, score }: { items: QualityItem[]; total: number; score: number }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<QualityIssue | "all">("all");
  const [values, setValues] = useState<Record<string, string>>({});
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const live = items.filter((i) => !gone.has(`${i.studentId}|${i.issue}`));
  const shown = (filter === "all" ? live : live.filter((i) => i.issue === filter)).slice(0, 60);
  const count = (k: QualityIssue) => live.filter((i) => i.issue === k).length;
  const hide = (key: string, on: boolean) =>
    setGone((g) => {
      const n = new Set(g);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });

  async function fix(item: QualityItem) {
    const key = `${item.studentId}|${item.issue}`;
    setBusy(key);
    const res = await fixQualityAction({ studentId: item.studentId, issue: item.issue, value: values[key] ?? "" });
    setBusy(null);
    if (!res.ok) {
      toast.show({ text: res.message, tone: "bad" });
      return;
    }
    hide(key, true);
    toast.show({ text: tx(p(`Fixed for ${item.name}.`, `${item.name} का सुधार हुआ।`)), tone: "ok" });
    router.refresh();
  }

  async function skip(item: QualityItem) {
    const key = `${item.studentId}|${item.issue}`;
    hide(key, true);
    const res = await skipQualityAction({ studentId: item.studentId, issue: item.issue, days: 30 });
    if (!res.ok) {
      hide(key, false);
      toast.show({ text: res.message, tone: "bad" });
      return;
    }
    toast.show({
      text: tx(p("Skipped for 30 days.", "30 दिन के लिए छोड़ा।")),
      tone: "info",
      undoLabel: tx(p("Undo", "वापस")),
      undo: async () => {
        const back = await unskipQualityAction({ studentId: item.studentId, issue: item.issue });
        if (back.ok) hide(key, false);
      },
    });
  }

  return (
    <div className="pp-wrap" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PeopleStyles />
      <Card style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Ring value={score} size={72}><strong>{score}%</strong></Ring>
        <span style={{ display: "flex", flexDirection: "column" }}>
          <strong style={{ fontSize: 17 }}>{tx(p(`${live.length} things to fix`, `${live.length} चीज़ें सुधारनी हैं`))}</strong>
          <span style={{ color: "var(--mut)", fontSize: 13 }}>{tx(p(`${score}% of ${total} records are complete`, `${total} में से ${score}% रिकॉर्ड पूरे`))}</span>
        </span>
      </Card>
      <ChipRow label={tx(p("Filter", "छाँटें"))}>
        <Chip on={filter === "all"} onClick={() => setFilter("all")} count={live.length}>{tx(p("All", "सब"))}</Chip>
        {QUALITY_ISSUES.filter((k) => count(k) > 0).map((k) => (
          <Chip key={k} on={filter === k} onClick={() => setFilter(k)} count={count(k)}>{tx(SHORT[k])}</Chip>
        ))}
      </ChipRow>
      {shown.length === 0 ? (
        <Card><EmptyState icon="checkCircle" title={tx(p("All clean", "सब ठीक है"))} body={tx(p("No record needs fixing right now.", "अभी किसी रिकॉर्ड में सुधार नहीं चाहिए।"))} /></Card>
      ) : (
        <Card>
          {shown.map((item) => {
            const key = `${item.studentId}|${item.issue}`;
            const fixable = item.issue !== "duplicate";
            return (
              <div key={key} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 0", borderTop: "1px solid var(--bd)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar text={item.name} seed={item.studentId} size={36} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <a href={`/admissions/${item.studentId}`} className="clip" style={{ fontWeight: 600, color: "inherit" }}>{item.name}</a>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{item.classLabel}</span>
                  </span>
                  <Pill tone={item.issue === "duplicate" || item.issue === "age" ? "warn" : "mut"}>{tx(ISSUE_LABEL[item.issue])}{item.detail ? ` · ${item.detail}` : ""}</Pill>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {fixable ? (
                    <>
                      <Input
                        style={{ flex: 1, minWidth: 160 }}
                        value={values[key] ?? ""}
                        placeholder={tx(PLACEHOLDER[item.issue] ?? p(""))}
                        aria-label={tx(ISSUE_LABEL[item.issue])}
                        inputMode={item.issue === "father_phone" || item.issue === "dob" || item.issue === "age" ? "numeric" : undefined}
                        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                      />
                      <Btn variant="pri" icon="check" disabled={busy === key || !(values[key] ?? "").trim()} onClick={() => fix(item)}>{tx(p("Save", "सहेजें"))}</Btn>
                    </>
                  ) : (
                    <>
                      <Btn variant="sec" href={`/admissions/${item.studentId}`}>{tx(p("Open this one", "यह खोलें"))}</Btn>
                      {item.otherId ? <Btn variant="sec" href={`/admissions/${item.otherId}`}>{tx(p("Open the other", "दूसरा खोलें"))}</Btn> : null}
                    </>
                  )}
                  <Btn variant="ghost" onClick={() => skip(item)}>{tx(p("Later", "बाद में"))}</Btn>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
