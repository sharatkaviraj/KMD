import { getBuiltinAiReport, lastBuiltinAiSmoke, mayChangeBuiltinAiLimit, mayCheckBuiltinAiKeys } from "@/lib/ai/admin";
import { builtinAiMode, builtinAiPilot, DEFAULT_MODEL } from "@/lib/ai/config";
import { readKeyStatuses, type KeyStatus } from "@/lib/ai/provider-status";
import { requirePermission } from "@/platform/auth/current-staff";
import { p, lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, CardHead, Pill } from "@/vx/ui/primitives";
import { changeBuiltinAiLimit, checkBuiltinAiKeysAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Check keys sends every probe at once; each stops at 25 seconds.
export const maxDuration = 60;
export const metadata = { title: "Built-in AI usage" };

/** The four keys, in the router's order of preference, and how each is paid for. */
const KEYS = [
  { key: "gemini-free", en: "Free Gemini", hi: "मुफ़्त Gemini", payEn: "free AI Studio tier", payHi: "मुफ़्त AI Studio" },
  { key: "anthropic", en: "Claude", hi: "Claude", payEn: "Anthropic API credits", payHi: "Anthropic API क्रेडिट" },
  { key: "openai", en: "OpenAI", hi: "OpenAI", payEn: "OpenAI API credits", payHi: "OpenAI API क्रेडिट" },
  { key: "gemini-paid", en: "Gemini paid", hi: "सशुल्क Gemini", payEn: "Google billing", payHi: "Google बिलिंग" },
] as const;
const LABEL: Record<string, string> = { "gemini-free": "Free Gemini", "gemini-paid": "Gemini paid", anthropic: "Claude", openai: "OpenAI" };

const PROBLEMS: Record<string, [string, string]> = {
  quota_daily: ["daily quota used", "दैनिक सीमा पूरी"],
  quota: ["rate limited", "दर सीमा"],
  billing: ["billing or credits", "बिलिंग या क्रेडिट"],
  credential: ["key refused", "कुंजी अस्वीकार"],
  permission: ["access refused (403)", "अनुमति नहीं (403)"],
  model: ["model not available", "मॉडल उपलब्ध नहीं"],
  timeout: ["timed out", "समय समाप्त"],
  schema: ["unusable answer", "अनुपयोगी उत्तर"],
  server: ["provider error", "प्रदाता त्रुटि"],
  network: ["network error", "नेटवर्क त्रुटि"],
  other: ["failed", "विफल"],
};

/** Is a key's skip-until time still ahead? */
function stillBlocked(until: string) {
  return Date.parse(until) > Date.now();
}

export default async function BuiltinAiSettings({ searchParams }: { searchParams: Promise<{ result?: string; keys?: string }> }) {
  const staff = await requirePermission("settings:manage", "/settings/builtin-ai");
  const { result, keys } = await searchParams;
  const language = staff.language;
  const tx = (en: string, hi: string) => lead(p(en, hi), language);
  const mode = builtinAiPilot() ? builtinAiMode() : "off";
  const mayChange = mayChangeBuiltinAiLimit(staff) && mode !== "off";
  const mayCheck = mayCheckBuiltinAiKeys(staff);
  const [report, statuses, smoke] = await Promise.all([
    getBuiltinAiReport().catch(() => null), readKeyStatuses(), lastBuiltinAiSmoke().catch(() => null),
  ]);
  const asMoney = (value: number) => new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 2,
  }).format(value);
  const percent = (value: number, denominator: number) => denominator ? Math.round(100 * value / denominator) + "%" : "—";
  const free = report?.providers.find((row) => row.provider === "gemini-free")?.handled ?? 0;
  const recent = new Intl.DateTimeFormat(language === "en" ? "en-IN" : "hi-IN", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
  });
  const actionLabels: Record<string, string> = {
    "marks-photo": tx("Marks photo", "अंकों की फ़ोटो"),
    "substitution-photo": tx("Substitution photo", "प्रतिस्थापन की फ़ोटो"),
    voice: tx("Voice", "आवाज़"),
  };
  const statusOf = new Map(statuses.map((row) => [row.provider, row]));
  const statePill = (row: KeyStatus | undefined) => {
    if (!row) return <Pill tone="warn">{tx("Not checked", "जाँचा नहीं")}</Pill>;
    if (row.state === "ok") return <Pill tone="ok">{tx("OK", "ठीक")}</Pill>;
    if (row.state === "quota") return <Pill tone="warn">{tx("Quota hit", "सीमा पूरी")}</Pill>;
    return <Pill tone="bad">{tx("Failing", "विफल")}</Pill>;
  };
  const configured = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const smokeModels = smoke ? [...new Set(smoke.results.filter((row) => row.key === "gemini-free").map((row) => row.model))] : [];

  return <VxPage>
    <TopBar title={tx("Built-in AI", "ऐप का AI")} crumb={tx("Settings", "सेटिंग्स")} mBack="/settings" />
    <main><Section>
      <Card>
        <CardHead title={tx("This month", "इस महीने")} badge={<Pill tone={mode !== "off" && report ? "ok" : "warn"}>
          {!report || mode === "off" ? tx("Off", "बंद") : mode === "live" ? tx("On for staff", "स्टाफ़ के लिए चालू") : tx("TEST only", "केवल परीक्षण")}
        </Pill>} />
        {!report ? <p>{tx("Usage is not available on this deployment.", "इस डिप्लॉयमेंट पर उपयोग की जानकारी उपलब्ध नहीं है।")}</p> : <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><dt>{tx("Requests", "अनुरोध")}</dt><dd>{report.actions}</dd></div>
            <div><dt>{tx("Estimated cost", "अनुमानित खर्च")}</dt><dd>{asMoney(report.costInr)}</dd></div>
            <div><dt>{tx("Answered free", "मुफ़्त में उत्तर")}</dt><dd>{percent(free, report.handled)}</dd></div>
            <div><dt>{tx("Edited before saving", "सहेजने से पहले बदले")}</dt><dd>{percent(report.edited, report.applied)}</dd></div>
          </dl>
          <ul className="divide-y">
            {KEYS.map(({ key, en, hi, payEn, payHi }) => {
              const row = report.providers.find((entry) => entry.provider === key);
              return <li key={key} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span><strong>{tx(en, hi)}</strong> <span className="text-sm" style={{ color: "var(--mut)" }}>· {tx(payEn, payHi)}</span></span>
                <span>{tx((row?.handled ?? 0) + " answered", (row?.handled ?? 0) + " उत्तर")} · {tx((row?.attempts ?? 0) + " tries", (row?.attempts ?? 0) + " प्रयास")} · {asMoney(row?.cost ?? 0)}</span>
              </li>;
            })}
          </ul>
          <p className="text-sm">{tx("Voice requests heard by OpenAI are answered by Claude, so they count under Claude; OpenAI's tries show its use. Estimates include fallback tries where the provider reported usage. Free Gemini costs nothing.",
            "OpenAI से सुने गए आवाज़ अनुरोधों का उत्तर Claude देता है, इसलिए वे Claude में गिने जाते हैं। अनुमान में दूसरे प्रयास भी शामिल हैं। मुफ़्त Gemini का कोई खर्च नहीं।")}</p>
        </>}
      </Card>
      <Card>
        <CardHead title={tx("Keys", "कुंजियाँ")} sub={tx(`Gemini model: ${configured}`, `Gemini मॉडल: ${configured}`)} />
        {keys && <p role={keys === "checked" ? "status" : "alert"}>{keys === "checked"
          ? tx("Keys checked.", "कुंजियाँ जाँची गईं।") : tx("The check could not finish. Try again.", "जाँच पूरी नहीं हुई। फिर कोशिश करें।")}</p>}
        <ul className="divide-y">
          {KEYS.map(({ key, en, hi }) => {
            const row = statusOf.get(key);
            const problem = row?.problem ? PROBLEMS[row.problem] ?? PROBLEMS.other : null;
            return <li key={key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex flex-wrap items-center gap-2"><strong>{tx(en, hi)}</strong>{statePill(row)}</span>
              <span className="text-sm" style={{ color: "var(--mut)" }}>
                {row ? [
                  problem ? tx(problem[0], problem[1]) + (row.http_status ? ` (${row.http_status})` : "") : null,
                  row.blocked_until && stillBlocked(row.blocked_until) ? tx(`skipped until ${recent.format(new Date(row.blocked_until))}`, `${recent.format(new Date(row.blocked_until))} तक छोड़ा गया`) : null,
                  row.model, recent.format(new Date(row.checked_at)),
                ].filter(Boolean).join(" · ") : tx("No request yet", "अभी कोई अनुरोध नहीं")}
              </span>
            </li>;
          })}
        </ul>
        {smoke && <details>
          <summary>{tx(`Last key check · ${recent.format(new Date(smoke.at))}`, `पिछली जाँच · ${recent.format(new Date(smoke.at))}`)}</summary>
          {smoke.recommended && <p className="mt-2">{tx(`Best Flash model on the free key: ${smoke.recommended}`, `मुफ़्त कुंजी पर सबसे अच्छा Flash मॉडल: ${smoke.recommended}`)}</p>}
          {smokeModels.length > 0 && <ul className="mt-2 space-y-1 text-sm">{smokeModels.map((model) => {
            const rows = smoke.results.filter((row) => row.key === "gemini-free" && row.model === model);
            return <li key={model}>{tx("Free", "मुफ़्त")} · {model} · {rows.map((row) => `${row.probe} ${row.ok ? "✓" : "✗"}${row.ok ? ` ${row.ms} ms` : row.problem ? ` ${row.problem}${row.httpStatus ? ` ${row.httpStatus}` : ""}` : ""}${row.note ? ` (${row.note})` : ""}`).join(" · ")}</li>;
          })}</ul>}
          <ul className="mt-2 space-y-1 text-sm">{smoke.results.filter((row) => row.key !== "gemini-free").map((row, i) => (
            <li key={i}>{LABEL[row.key] ?? row.key} · {row.model} · {row.probe} {row.ok ? `✓ ${row.ms} ms` : `✗ ${row.problem ?? ""}${row.httpStatus ? ` ${row.httpStatus}` : ""}`}{row.note ? ` (${row.note})` : ""}</li>
          ))}</ul>
          {smoke.missing.length > 0 && <p className="text-sm">{tx(`Not configured: ${smoke.missing.map((key) => LABEL[key] ?? key).join(", ")}`, `सेट नहीं: ${smoke.missing.map((key) => LABEL[key] ?? key).join(", ")}`)}</p>}
        </details>}
        {mayCheck && <form action={checkBuiltinAiKeysAction} className="mt-3">
          <Btn variant="sec" type="submit">{tx("Check keys now", "कुंजियाँ अभी जाँचें")}</Btn>
          <p className="mt-1 text-sm" style={{ color: "var(--mut)" }}>{tx("Sends one tiny request per key and model, from the server. Keys are never shown.", "हर कुंजी और मॉडल पर सर्वर से एक छोटा अनुरोध। कुंजियाँ कभी नहीं दिखतीं।")}</p>
        </form>}
      </Card>
      {report && <Card>
        <CardHead title={tx("Daily limit per staff member", "हर कर्मचारी की दैनिक सीमा")} />
        {result && <p role={result === "saved" ? "status" : "alert"}>{result === "saved"
          ? tx("Daily limit saved.", "दैनिक सीमा सहेजी गई।") : tx("Could not save the daily limit.", "दैनिक सीमा सहेजी नहीं गई।")}</p>}
        <form action={changeBuiltinAiLimit} className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1">{tx("Actions per day (0 pauses new requests)", "दैनिक कार्रवाइयाँ (0 से नए अनुरोध रुकते हैं)")}
            <input className="w-24 rounded border p-2" name="limit" type="number" min={0} max={200}
              defaultValue={report.dailyLimit} required disabled={!mayChange} />
          </label>
          <Btn variant="pri" type="submit" disabled={!mayChange}>{tx("Save limit", "सीमा सहेजें")}</Btn>
        </form>
      </Card>}
      {report && <Card>
        <CardHead title={tx("Recent failures", "हाल की विफलताएँ")} />
        {!report.failures.length ? <p>{tx("No failures recorded this month.", "इस महीने कोई विफलता दर्ज नहीं हुई।")}</p> :
          <ul className="divide-y">{report.failures.map((row, i) => <li key={row.created_at + i} className="py-2">
            {actionLabels[row.action] ?? row.action} · {row.provider ? LABEL[row.provider] ?? row.provider : tx("Before provider", "AI से पहले")}
            {" · "}{recent.format(new Date(row.created_at))}
          </li>)}</ul>}
      </Card>}
    </Section></main>
  </VxPage>;
}
