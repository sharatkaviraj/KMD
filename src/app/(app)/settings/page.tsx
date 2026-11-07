import { loadAiPage } from "@/modules/assist/data/panel";
import { requirePermission } from "@/platform/auth/current-staff";
import { loadSettingsScreen } from "@/vx/screens/settings/data";
import { isSettingsState } from "@/vx/screens/settings/domain/settings";
import { SettingsScreen } from "@/vx/screens/settings/settings-screen";
import { isAiView } from "@/vx/screens/settings/ai/words";

export const runtime = "nodejs";
// Settings → AI helper → Check keys sends every probe at once; each stops at 25 seconds.
export const maxDuration = 60;

export const metadata = { title: "Settings" };

/**
 * Settings, backups & glossary (design `Settings`). Admin only. The classic
 * Preferences screen stays at /preferences for everyone else.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ s?: string; v?: string }> }) {
  const staff = await requirePermission("settings:manage", "/settings");
  const { s, v } = await searchParams;
  const state = isSettingsState(s) ? s : "home";
  // Every AI job's numbers are read only on the AI page itself (D-324, D-501).
  const [data, ai] = await Promise.all([loadSettingsScreen(), state === "ai" ? loadAiPage(staff) : Promise.resolve(null)]);
  return <SettingsScreen data={data} state={state} ai={ai} aiView={isAiView(v) ? v : "used"} />;
}
