import { getBuiltinAiReport, mayChangeBuiltinAiLimit } from "@/lib/ai/admin";
import { builtinAiMode, builtinAiPilot } from "@/lib/ai/config";
import { requirePermission } from "@/platform/auth/current-staff";
import { p, lead } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, CardHead, Pill } from "@/vx/ui/primitives";
import { changeBuiltinAiLimit } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Built-in AI usage" };

const PROVIDERS: Record<string, string> = {
  "gemini-free": "Gemini Free", "gemini-paid": "Gemini Paid", anthropic: "Claude", openai: "OpenAI",
};

export default async function BuiltinAiSettings({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const staff = await requirePermission("settings:manage", "/settings/builtin-ai");
  const { result } = await searchParams;
  const language = staff.language;
  const tx = (en: string, hi: string) => lead(p(en, hi), language);
  const mode = builtinAiPilot() ? builtinAiMode() : "off";
  const mayChange = mayChangeBuiltinAiLimit(staff) && mode !== "off";
  const report = await getBuiltinAiReport().catch(() => null);
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

  return <VxPage>
    <TopBar title={tx("Built-in AI", "ऐप का AI")} crumb={tx("Settings", "सेटिंग्स")} mBack="/settings" />
    <main><Section>
      <Card>
        <CardHead title={tx("This month", "इस महीने")} badge={<Pill tone={mode !== "off" && report ? "ok" : "warn"}>
          {!report || mode === "off" ? tx("Off", "बंद") : mode === "live" ? tx("On for staff", "स्टाफ़ के लिए चालू") : tx("TEST only", "केवल परीक्षण")}
        </Pill>} />
        {!report ? <p>{tx("Usage is not available on this deployment.", "इस डिप्लॉयमेंट पर उपयोग की जानकारी उपलब्ध नहीं है।")}</p> : <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><dt>{tx("Actions", "कार्रवाइयाँ")}</dt><dd>{report.actions}</dd></div>
            <div><dt>{tx("Estimated cost", "अनुमानित खर्च")}</dt><dd>{asMoney(report.costInr)}</dd></div>
            <div><dt>{tx("Free / paid handled", "मुफ़्त / सशुल्क")}</dt><dd>{percent(free, report.handled)} / {percent(report.handled - free, report.handled)}</dd></div>
            <div><dt>{tx("Edited before saving", "सहेजने से पहले बदले")}</dt><dd>{percent(report.edited, report.applied)}</dd></div>
          </dl>
          <ul className="divide-y">
            {report.providers.map((row) => <li key={row.provider} className="flex flex-wrap justify-between gap-2 py-2">
              <span>{PROVIDERS[row.provider] ?? row.provider}</span>
              <span>{tx(row.handled + " handled", row.handled + " पूरे")} · {tx(row.attempts + " attempts", row.attempts + " प्रयास")} · {asMoney(row.cost)}</span>
            </li>)}
          </ul>
          <p className="text-sm">{tx("Estimates include fallback attempts where the provider reported usage.", "अनुमान में वे दूसरे प्रयास शामिल हैं जिनका उपयोग बताया गया।")}</p>
        </>}
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
            {actionLabels[row.action] ?? row.action} · {row.provider ? PROVIDERS[row.provider] ?? row.provider : tx("Before provider", "AI से पहले")}
            {" · "}{recent.format(new Date(row.created_at))}
          </li>)}</ul>}
      </Card>}
    </Section></main>
  </VxPage>;
}
