import type { Localized } from "@/platform/i18n/language";
import { aiConnectionMessages as a } from "@/messages/ai-connection";
import { connectionStatus, type ConnectionListRow, type ConnectionStatus } from "@/modules/mcp/domain/card";
import { PROVIDER_NAMES } from "@/modules/mcp/domain/redirects";

/** "3 Nov, 10:42" in school time. Digits only, so it reads the same in either language. */
export function istDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** "3 Feb 2027" in school time. */
export function istDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

export const STATUS_LABEL: Record<ConnectionStatus, Localized> = {
  allowed: a.allowed,
  idle: a.allowed,
  disconnected: a.disconnected,
  reconnect_required: a.reconnect,
};

export function statusOf(row: ConnectionListRow, now: number): ConnectionStatus {
  return connectionStatus(row, now);
}

export function providerName(row: Pick<ConnectionListRow, "provider">): Localized {
  return PROVIDER_NAMES[row.provider];
}
