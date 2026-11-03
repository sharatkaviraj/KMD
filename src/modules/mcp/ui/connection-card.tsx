import { aiConnectionMessages as a } from "@/messages/setup";
import { primary, secondary, type Language, type Localized } from "@/platform/i18n/language";
import { Badge, Card } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import type { CardState, ConnectionListRow } from "@/modules/mcp/domain/card";
import { istDate, istDateTime, providerName, statusOf } from "@/modules/mcp/ui/format";

/**
 * A member of staff's own AI-connection card (plan §8.1), on Preferences.
 * Every state comes from One's records; none says "connected and working".
 * Disconnect posts the connection id to an action that ends it only if it is
 * the signed-in person's own.
 */

function Text({ text, language, small }: { text: Localized; language: Language; small?: boolean }) {
  const under = secondary(text, language);
  return (
    <p className={small ? "text-[13px] leading-5 text-muted-foreground" : "text-[15px] leading-6"}>
      {primary(text, language)}
      {under ? <span lang="en" className="block text-[12px] leading-5 text-muted-foreground">{under}</span> : null}
    </p>
  );
}

function LiveRow({ row, language, now, disconnect }: { row: ConnectionListRow; language: Language; now: number; disconnect: (formData: FormData) => Promise<void> }) {
  const idle = statusOf(row, now) === "idle";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-[15px] font-medium">
          {primary(providerName(row), language)} · <Badge tone={idle ? "warning" : "success"}>{primary(a.allowed, language)}</Badge>
        </p>
        <p className="text-[13px] text-muted-foreground">
          {row.lastUsedAt ? primary(a.lastUsed(istDateTime(row.lastUsedAt)), language) : primary(a.notUsedYet, language)} ·{" "}
          {primary(a.ends(istDate(row.expiresAt)), language)}
        </p>
        {idle ? <Text text={a.idle} language={language} small /> : null}
      </div>
      <form action={disconnect}>
        <input type="hidden" name="connectionId" value={row.id} />
        <Button type="submit" variant="destructive-outline" size="sm">
          {primary(a.disconnect, language)}
        </Button>
      </form>
    </li>
  );
}

export function AiConnectionCard({
  state,
  address,
  language,
  now,
  disconnect,
}: {
  state: CardState;
  /** The canonical MCP URL to paste into the AI app. */
  address: string | null;
  language: Language;
  now: number;
  disconnect: (formData: FormData) => Promise<void>;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      {state.kind === "unavailable" ? (
        <>
          <p className="text-[15px] font-medium">{primary(a.unavailable, language)}</p>
          <Text text={a.unavailableHelp} language={language} small />
        </>
      ) : null}

      {state.kind === "switched_off" ? (
        <>
          <p className="text-[15px] font-medium">
            <Badge tone="warning">{primary(a.cardSwitchedOff, language)}</Badge>
          </p>
          {state.live.length ? (
            <ul className="flex flex-col gap-3">
              {state.live.map((row) => (
                <LiveRow key={row.id} row={row} language={language} now={now} disconnect={disconnect} />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {state.kind === "not_connected" ? <p className="text-[15px] font-medium">{primary(a.notConnected, language)}</p> : null}

      {state.kind === "allowed" ? (
        <ul className="flex flex-col gap-3">
          {state.live.map((row) => (
            <LiveRow key={row.id} row={row} language={language} now={now} disconnect={disconnect} />
          ))}
        </ul>
      ) : null}

      {state.kind === "disconnected" ? (
        <p className="text-[15px] font-medium">
          {primary(providerName(state.last), language)} ·{" "}
          {state.last.revokedAt ? primary(a.disconnectedOn(istDate(state.last.revokedAt)), language) : primary(a.disconnected, language)}
        </p>
      ) : null}

      {state.kind === "reconnect_required" ? (
        <>
          <p className="text-[15px] font-medium">
            {primary(providerName(state.last), language)} · <Badge tone="warning">{primary(a.reconnect, language)}</Badge>
          </p>
          <Text text={a.reconnectHelp} language={language} small />
        </>
      ) : null}

      {state.kind !== "unavailable" && address ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-[13px] font-semibold">{primary(a.addressLabel, language)}</p>
          <code className="block select-all break-all rounded-lg bg-surface-2 px-3 py-2 text-[14px]">{address}</code>
          <Text text={a.howClaude} language={language} small />
          <Text text={a.howChatGpt} language={language} small />
          <Text text={a.honesty} language={language} small />
        </div>
      ) : null}
    </Card>
  );
}
