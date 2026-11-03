import { aiConnectionMessages as a } from "@/messages/setup";
import { requirePermission } from "@/platform/auth/current-staff";
import type { Language, Localized } from "@/platform/i18n/language";
import { loadAiConnectionAdmin } from "@/modules/mcp/data/card";
import { isLive } from "@/modules/mcp/domain/card";
import { istDate, istDateTime, providerName, STATUS_LABEL, statusOf } from "@/modules/mcp/ui/format";
import { lead, under } from "@/vx/text";
import { Btn, Card, CardHead, EmptyState, Pill } from "@/vx/ui/primitives";
import { Section, TopBar, VxPage } from "@/vx/ui/page";

import { disconnectAiConnectionAction, setAiConnectionSwitchAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "AI assistant connection" };

function Sub({ text, language }: { text: Localized; language: Language }) {
  const second = under(text, language);
  return (
    <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
      {lead(text, language)}
      {second ? <span style={{ display: "block", fontSize: 12 }}>{second}</span> : null}
    </p>
  );
}

/**
 * Settings → AI assistant connection (owner decision D9): the school's
 * switch, every connection with when it was last used, and Disconnect for
 * any of them. Admin only (`settings:manage`; the actions also require the
 * admin role and refuse test accounts).
 */
export default async function AiConnectionSettingsPage() {
  const staff = await requirePermission("settings:manage", "/settings/ai-connection");
  const language = staff.language;
  const { switchState, rows, address, now } = await loadAiConnectionAdmin();
  const on = switchState?.enabled === true;

  return (
    <VxPage>
      <TopBar crumb={lead(a.settingsCrumb, language)} title={lead(a.adminTitle, language)} mBack="/settings" />
      <main>
        <Section>
          <Card>
            <CardHead
              title={lead(a.switchTitle, language)}
              badge={<Pill tone={on ? "ok" : "warn"}>{lead(on ? a.stateOn : a.stateOff, language)}</Pill>}
            />
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
              <Sub text={switchState === null ? a.switchUnknown : on ? a.switchOn : a.switchOff} language={language} />
              {switchState?.updatedAt ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{istDateTime(switchState.updatedAt)}</span> : null}
              <form action={setAiConnectionSwitchAction}>
                <input type="hidden" name="enabled" value={on ? "false" : "true"} />
                <Btn type="submit" variant={on ? "danger" : "pri"} icon={on ? "x" : "check"}>
                  {lead(on ? a.turnOff : a.turnOn, language)}
                </Btn>
              </form>
              <Sub text={a.eligibleNote} language={language} />
            </div>
          </Card>

          {address ? (
            <Card>
              <CardHead title={lead(a.addressLabel, language)} />
              <code style={{ display: "block", marginTop: 10, padding: "8px 12px", borderRadius: 10, background: "var(--s2)", fontSize: 14, wordBreak: "break-all", userSelect: "all" }}>{address}</code>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                <Sub text={a.howClaude} language={language} />
                <Sub text={a.howChatGpt} language={language} />
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHead title={lead(a.connectionsTitle, language)} />
            {rows === null ? (
              <div style={{ marginTop: 10 }}>
                <Sub text={a.failed} language={language} />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState icon="link" title={lead(a.noConnections, language)} />
            ) : (
              <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column" }}>
                {rows.map((row) => {
                  const status = statusOf(row, now);
                  const live = isLive(row, now);
                  return (
                    <li key={row.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
                      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>
                          {row.staffName} · {lead(providerName(row), language)}{" "}
                          <Pill tone={status === "allowed" ? "ok" : status === "idle" ? "warn" : "mut"}>{lead(STATUS_LABEL[status], language)}</Pill>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--mut)" }}>
                          {lead(a.colCreated, language)} {istDate(row.createdAt)} · {lead(a.colLastUsed, language)}{" "}
                          {row.lastUsedAt ? istDateTime(row.lastUsedAt) : lead(a.never, language)} · {lead(a.colExpires, language)} {istDate(row.expiresAt)}
                          {row.revokedAt ? ` · ${istDate(row.revokedAt)} (${row.revokeReason ?? ""})` : ""}
                        </div>
                      </div>
                      {live ? (
                        <form action={disconnectAiConnectionAction}>
                          <input type="hidden" name="connectionId" value={row.id} />
                          <Btn type="submit" variant="danger">{lead(a.disconnect, language)}</Btn>
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            <div style={{ marginTop: 10 }}>
              <Sub text={a.logNote} language={language} />
            </div>
          </Card>
        </Section>
      </main>
    </VxPage>
  );
}
