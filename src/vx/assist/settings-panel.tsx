"use client";

import { useState } from "react";

import { dollars } from "@/modules/assist/domain/cost";
import { assistFeatures, assistTiers, FEATURE_LABELS, featureTier, isAssistFeature, type AssistFeature } from "@/modules/assist/domain/features";
import type { AssistProvider } from "@/modules/assist/domain/routes";
import type { AssistPanelData } from "@/modules/assist/data/panel";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { Input, Switch } from "@/vx/ui/controls";

const SAY = {
  intro: p(
    "AI writes first drafts — notes, notices, replies, remarks, plans — and staff decide. Nothing is saved or sent by AI, and every screen works the same with it off.",
    "AI पहला मसौदा लिखता है — नोट, सूचना, जवाब, टिप्पणी, योजना — और फ़ैसला स्टाफ़ करता है। AI न कुछ सहेजता है न भेजता है, और बंद होने पर हर स्क्रीन पहले जैसी चलती है।",
  ),
  keyMissing: p("No AI provider configured. An administrator can connect Claude or Gemini Paid in the deployment settings.", "कोई AI सेवा नहीं जुड़ी है। व्यवस्थापक डिप्लॉयमेंट सेटिंग्स में Claude या Gemini Paid जोड़ सकते हैं।"),
  keyOk: p("An AI provider is configured", "एक AI सेवा जुड़ी है"),
  master: p("AI helper", "AI सहायक"),
  masterSub: p("Switch off to hide every AI button for everyone", "बंद करने पर सबके लिए हर AI बटन छिप जाएगा"),
  budget: p("Monthly budget (US $)", "मासिक बजट (US $)"),
  budgetHint: p("New AI drafts stop for the month when the estimate reaches this.", "अनुमान यहाँ तक पहुँचते ही इस महीने नए AI मसौदे रुक जाते हैं।"),
  cap: p("AI drafts per person per day", "हर व्यक्ति के रोज़ के AI मसौदे"),
  features: p("Features", "सुविधाएँ"),
  quick: p("Quick help", "तेज़ मदद"),
  writing: p("For parents", "अभिभावकों के लिए"),
  careful: p("Careful", "सावधानी से"),
  who: p("Which AI writes what", "कौन-सा AI क्या लिखता है"),
  whoSub: p("The first one writes; if it is busy or out of credit, the next takes over. Nobody has to choose.", "पहला लिखता है; वह व्यस्त हो या क्रेडिट ख़त्म हो तो अगला लिखता है। किसी को चुनना नहीं पड़ता।"),
  quickSub: p("Tidy a note, translate, match columns, how-to, a cover activity", "नोट साफ़ करना, अनुवाद, कॉलम मिलान, कैसे करें, सब्स्टिट्यूट गतिविधि"),
  writingSub: p("Notices, replies, call scripts, summaries, the Today brief", "सूचनाएँ, जवाब, कॉल स्क्रिप्ट, सारांश, आज का सार"),
  carefulSub: p("Report-card remarks, results, reading an admission form", "रिपोर्ट कार्ड टिप्पणी, परिणाम, दाख़िला फ़ॉर्म पढ़ना"),
  none: p("No provider", "कोई सेवा नहीं"),
  save: p("Save", "सहेजें"),
  month: p("This month", "इस महीने"),
  spent: (spent: string, budget: string) => p(`${spent} of ${budget} used (estimate)`, `${budget} में से ${spent} खर्च (अनुमान)`),
  uses: p("drafts", "मसौदे"),
  keptRate: p("kept", "रखे गए"),
  noUse: p("No AI drafts yet this month.", "इस महीने अभी कोई AI मसौदा नहीं।"),
  people: p("Who uses it most", "सबसे ज़्यादा कौन उपयोग करता है"),
  invoice: p("This estimate uses the usage reported by the AI providers. Check their billing pages for exact charges.", "यह अनुमान AI सेवाओं के बताए उपयोग पर आधारित है। सटीक शुल्क उनकी बिलिंग में देखें।"),
  privacy: p("Only metadata is logged here (who, which feature, tokens, cost). What staff write is never stored by the helper.", "यहाँ केवल जानकारी दर्ज होती है (किसने, कौन-सी सुविधा, टोकन, लागत)। स्टाफ़ का लिखा सहायक कभी नहीं रखता।"),
  unreadable: p("The AI helper’s settings could not be read. Is the database update applied?", "AI सहायक की सेटिंग्स नहीं पढ़ी जा सकीं। क्या डेटाबेस अपडेट लगा है?"),
};

const PROVIDER_NAME: Record<AssistProvider, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  "gemini-paid": "Gemini",
  "gemini-free": "Gemini Free",
  "nvidia-free": "NVIDIA Free",
  "openrouter-free": "OpenRouter Free",
};

/**
 * Settings → AI helper (D-324). One switch for everything, a budget, a daily
 * limit per person, a switch per feature, and what this month has cost and
 * how often a draft was kept — the measure of whether a feature earns its
 * place. The key is not entered here; it belongs to the deployment.
 */
export function AssistSettingsPanel({
  data,
  pending,
  onSave,
}: {
  data: AssistPanelData;
  pending: boolean;
  onSave: (next: { enabled: boolean; monthlyBudgetUsd: number; dailyCapPerStaff: number; disabledFeatures: AssistFeature[] }) => void;
}) {
  const { tx } = useVx();
  const s = data.settings;
  const [enabled, setEnabled] = useState(s?.enabled ?? true);
  const [budget, setBudget] = useState(String(s?.monthlyBudgetUsd ?? 25));
  const [cap, setCap] = useState(String(s?.dailyCapPerStaff ?? 60));
  const [off, setOff] = useState<AssistFeature[]>(s?.disabledFeatures ?? []);

  const usage = new Map((data.month?.features ?? []).map((f) => [f.feature, f]));
  const budgetNumber = Number(budget);
  const spent = data.month?.spentUsd ?? 0;
  const share = budgetNumber > 0 ? Math.min(100, Math.round((spent / budgetNumber) * 100)) : 100;
  const card = { padding: "16px 18px", display: "flex", flexDirection: "column" as const, gap: 12 };

  return (
    <div className="pad" style={{ padding: "18px 24px 40px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--mut)" }}>{tx(SAY.intro)}</p>

      <div className="card" style={{ ...card, flexDirection: "row", alignItems: "center", background: data.configured ? "var(--oks)" : "var(--warns)", color: data.configured ? "var(--ok)" : "var(--warnfg)" }}>
        <Ic n={data.configured ? "checkCircle" : "key"} size={22} />
        <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.5 }}>{tx(data.configured ? SAY.keyOk : SAY.keyMissing)}</span>
      </div>

      {!s ? (
        <div className="card" style={{ ...card, color: "var(--warnfg)" }}>{tx(SAY.unreadable)}</div>
      ) : (
        <>
          <div className="card" style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(SAY.master)}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(SAY.masterSub)}</span>
              </span>
              <Switch on={enabled} onChange={setEnabled} label={tx(SAY.master)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <label className="field">
                <span>{tx(SAY.budget)}</span>
                <Input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))} />
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(SAY.budgetHint)}</span>
              </label>
              <label className="field">
                <span>{tx(SAY.cap)}</span>
                <Input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))} />
              </label>
            </div>
          </div>

          <div className="card" style={{ ...card, gap: 4, padding: "8px 10px" }}>
            <span className="sech" style={{ padding: "8px 8px 4px" }}>{tx(SAY.features)}</span>
            {assistFeatures.map((f) => {
              const label = FEATURE_LABELS[f];
              const u = usage.get(f);
              const decided = u ? u.kept + u.edited + u.discarded : 0;
              return (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "6px 8px", borderTop: "1px solid var(--bd)" }}>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                      {tx(label)}{" "}
                      <span className="pill" style={{ height: 20, padding: "0 7px", fontSize: 10, background: "var(--s3)", color: "var(--mut)", verticalAlign: "middle" }}>{tx(SAY[featureTier(f)])}</span>
                    </span>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(label.sub)}</span>
                    {u ? (
                      <span className="num" style={{ fontSize: 12, color: "var(--fg)" }}>
                        {u.uses} {tx(SAY.uses)} · {dollars(u.costUsd)}
                        {decided ? ` · ${Math.round(((u.kept + u.edited) / decided) * 100)}% ${tx(SAY.keptRate)}` : ""}
                      </span>
                    ) : null}
                  </span>
                  <Switch on={enabled && !off.includes(f)} disabled={!enabled} onChange={(on) => setOff((cur) => (on ? cur.filter((x) => x !== f) : [...cur, f]))} label={tx(label)} />
                </div>
              );
            })}
          </div>

          <button
            type="button"
            className="tap btn pri"
            disabled={pending}
            onClick={() => onSave({ enabled, monthlyBudgetUsd: Number(budget || 0), dailyCapPerStaff: Number(cap || 0), disabledFeatures: off.filter(isAssistFeature) })}
            style={{ height: 46, alignSelf: "flex-start", minWidth: 160 }}
          >
            <Ic n="check" size={18} />
            {tx(SAY.save)}
          </button>

          <div className="card" style={card}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(SAY.month)}</span>
            <span className="num" style={{ fontSize: 14 }}>{tx(SAY.spent(dollars(spent), dollars(budgetNumber || 0)))}</span>
            <div style={{ height: 8, borderRadius: 4, background: "var(--s3)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${share}%`, background: share >= 90 ? "var(--bad)" : share >= 70 ? "var(--warn)" : "var(--ok)" }} />
            </div>
            {data.month && data.month.staff.length ? (
              <>
                <span className="sech">{tx(SAY.people)}</span>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                  {data.month.staff.slice(0, 8).map((row) => (
                    <li key={row.name} className="num" style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                      <span>{row.name}</span>
                      <span style={{ color: "var(--mut)" }}>{row.uses} · {dollars(row.costUsd)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(SAY.noUse)}</span>
            )}
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(SAY.invoice)}</span>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(SAY.privacy)}</span>
          </div>

          <div className="card" style={card}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(SAY.who)}</span>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(SAY.whoSub)}</span>
            {assistTiers.map((tier) => (
              <div key={tier} style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 10, borderTop: "1px solid var(--bd)" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(SAY[tier])}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(SAY[`${tier}Sub`])}</span>
                <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  {data.chains[tier].length ? data.chains[tier].map((stage, i) => (
                    <span key={`${stage.provider}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {i ? <Ic n="chevRight" size={14} style={{ color: "var(--mut)" }} /> : null}
                      <span className="pill num" style={{ height: 24, padding: "0 9px", fontSize: 12, background: i ? "var(--s3)" : "var(--accs)", color: i ? "var(--fg)" : "var(--accfg)" }}>
                        {PROVIDER_NAME[stage.provider]} · {stage.model}
                      </span>
                    </span>
                  )) : <span style={{ fontSize: 12, color: "var(--warnfg)" }}>{tx(SAY.none)}</span>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
