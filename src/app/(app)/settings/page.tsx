import { requirePermission } from "@/platform/auth/current-staff";
import { loadSettingsScreen } from "@/vx/screens/settings/data";
import { isSettingsState } from "@/vx/screens/settings/domain/settings";
import { SettingsScreen } from "@/vx/screens/settings/settings-screen";

export const runtime = "nodejs";

export const metadata = { title: "Settings" };

/**
 * Settings, backups & glossary (design `Settings`). Admin only. The classic
 * Preferences screen stays at /preferences for everyone else.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await requirePermission("settings:manage", "/settings");
  const { s } = await searchParams;
  const data = await loadSettingsScreen();
  return <SettingsScreen data={data} state={isSettingsState(s) ? s : "home"} />;
}
