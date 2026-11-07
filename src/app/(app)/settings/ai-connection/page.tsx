import Link from "@/ui/link";
import type { CSSProperties, ReactNode } from "react";

import { aiConnectionMessages as a } from "@/messages/ai-connection";
import { monthStartIst } from "@/modules/assist/domain/cost";
import { loadAiConnectionAdmin, toolCallsSince } from "@/modules/mcp/data/card";
import { isLive } from "@/modules/mcp/domain/card";
import { istDate, istDateTime, providerName, STATUS_LABEL, statusOf } from "@/modules/mcp/ui/format";
import { requirePermission } from "@/platform/auth/current-staff";
import type { Language, Localized } from "@/platform/i18n/language";
import { Ic, type IconName } from "@/vx/icons";
import { lead, under } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, CardHead, EmptyState, Pill } from "@/vx/ui/primitives";

import { disconnectAiConnectionAction, setAiConnectionSwitchAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "Claude / ChatGPT connector" };

function Sub({ text, language }: { text: Localized; language: Language }) {
  const second = under(text, language);
  return (
    <p style={{ margin: 0, fontSize: 13, color: "var(--mut)", lineHeight: 1.5 }}>
      {lead(text, language)}
      {second ? <span style={{ display: "block", fontSize: 12 }}>{second}</span> : null}
    </p>
  );
}

function Box({ icon, label, tone, delay }: { icon: IconName; label: string; tone: "acc" | "info"; delay: number }) {
  return (
    <span style={{ flex: "1 1 150px", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, background: tone === "acc" ? "var(--accs)" : "var(--infos)", color: tone === "acc" ? "var(--accfg)" : "var(--info)", fontSize: 14, fontWeight: 700, animation: `xPopIn .5s var(--ease) ${delay}ms both` }}>
      <Ic n={icon} size={20} />
      {label}
    </span>
  );
}

function Arrow({ label, delay }: { label: string; delay: number }) {
  return (
    <span style={{ flex: "0 1 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontSize: 11.5, fontWeight: 600, color: "var(--mut)", animation: `xFade .4s ${delay}ms both`, textAlign: "center" }}>
      <Ic n="arrowRight" size={18} />
      {label}
    </span>
  );
}

const row: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, lineHeight: 1.45 };

function Line({ icon, color, children }: { icon: IconName; color: string; children: ReactNode }) {
  return (
    <li style={row}>
      <Ic n={icon} size={17} style={{ flex: "none", marginTop: 2, color }} />
      <span>{children}</span>
    </li>
  );
}

/**
 * Settings → Claude / ChatGPT connector (owner decision D9; renamed and
 * explained in D-501). A staff member's own Claude or ChatGPT reads a few
 * counts from One through MCP. It is not the AI helper inside One, which has
 * its own page, and the page says so first. Then: the school's switch, the
 * address to paste, what it can and can never read, this month's calls (counts
 * only), and every connection with Disconnect. Admin only (`settings:manage`;
 * the actions also require the admin role and refuse test accounts).
 */
export default async function AiConnectionSettingsPage() {
  const staff = await requirePermission("settings:manage", "/settings/ai-connection");
  const language = staff.language;
  const say = (text: Localized) => lead(text, language);
  const [{ switchState, rows, address, now }, month] = await Promise.all([loadAiConnectionAdmin(), toolCallsSince(monthStartIst(new Date())).catch(() => null)]);
  const on = switchState?.enabled === true;
  const answered = month?.reduce((sum, t) => sum + t.ok, 0) ?? 0;
  const refused = month?.reduce((sum, t) => sum + t.refused, 0) ?? 0;
  const failed = month?.reduce((sum, t) => sum + t.failed, 0) ?? 0;
  const most = Math.max(1, ...(month ?? []).map((t) => t.ok + t.refused + t.failed));

  return (
    <VxPage>
      <TopBar crumb={say(a.settingsCrumb)} title={say(a.adminTitle)} mBack="/settings" />
      <main>
        <Section style={{ maxWidth: 980 }}>
          <Card style={{ display: "flex", flexDirection: "column", gap: 14, animation: "xIn .32s var(--ease) both" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <span aria-hidden="true" style={{ flex: "none", width: 46, height: 46, borderRadius: 14, background: "var(--infos)", color: "var(--info)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n="link" size={23} />
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 17, fontWeight: 800 }}>
                  {say(a.whatTitle)}
                  <Pill tone="info">MCP</Pill>
                </span>
                <Sub text={a.whatBody} language={language} />
              </span>
            </div>
            <div role="img" aria-label={`${say(a.flowApp)} ${say(a.flowAsks)} ${say(a.flowOne)}, ${say(a.flowAnswers)}`} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Box icon="message" label={say(a.flowApp)} tone="info" delay={60} />
              <Arrow label={say(a.flowAsks)} delay={260} />
              <Box icon="eye" label={say(a.flowOne)} tone="acc" delay={420} />
              <Arrow label={say(a.flowAnswers)} delay={620} />
            </div>
            <Sub text={a.freeOfCost} language={language} />
            <Link href="/settings?s=ai" className="tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14, border: "1px dashed var(--bds)", color: "var(--fg)", textDecoration: "none" }}>
              <span aria-hidden="true" style={{ flex: "none", width: 36, height: 36, borderRadius: 11, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n="sparkle" size={18} />
              </span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{say(a.helperLink)}</span>
                <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{say(a.helperLinkSub)}</span>
              </span>
              <Ic n="arrowRight" size={18} style={{ color: "var(--sub)" }} />
            </Link>
          </Card>

          <Card>
            <CardHead title={say(a.switchTitle)} badge={<Pill tone={on ? "ok" : "warn"}>{say(on ? a.stateOn : a.stateOff)}</Pill>} />
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
              <Sub text={switchState === null ? a.switchUnknown : on ? a.switchOn : a.switchOff} language={language} />
              {switchState?.updatedAt ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{istDateTime(switchState.updatedAt)}</span> : null}
              <form action={setAiConnectionSwitchAction}>
                <input type="hidden" name="enabled" value={on ? "false" : "true"} />
                <Btn type="submit" variant={on ? "danger" : "pri"} icon={on ? "x" : "check"}>
                  {say(on ? a.turnOff : a.turnOn)}
                </Btn>
              </form>
              <Sub text={a.eligibleNote} language={language} />
            </div>
          </Card>

          {address ? (
            <Card>
              <CardHead title={say(a.addressLabel)} />
              <code style={{ display: "block", marginTop: 10, padding: "8px 12px", borderRadius: 10, background: "var(--s2)", fontSize: 14, wordBreak: "break-all", userSelect: "all" }}>{address}</code>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                <Sub text={a.howClaude} language={language} />
                <Sub text={a.howChatGpt} language={language} />
              </div>
            </Card>
          ) : null}

          <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 16 }}>
            <Card>
              <CardHead title={say(a.canReadTitle)} />
              <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {Object.values(a.tools).map((tool) => (
                  <Line key={tool.en} icon="check" color="var(--ok)">{say(tool)}</Line>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHead title={say(a.cannotTitle)} />
              <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                <Line icon="x" color="var(--bad)">{say(a.cannot)}</Line>
                <Line icon="clock" color="var(--mut)">{say(a.lasts)}</Line>
                <Line icon="lock" color="var(--mut)">{say(a.logNote)}</Line>
              </ul>
            </Card>
          </div>

          <Card>
            <CardHead title={say(a.monthTitle)} />
            {month === null ? (
              <div style={{ marginTop: 10 }}><Sub text={a.monthUnread} language={language} /></div>
            ) : answered + refused + failed === 0 ? (
              <div style={{ marginTop: 10 }}><Sub text={a.monthNone} language={language} /></div>
            ) : (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <Pill tone="ok">{say(a.monthAnswered(answered))}</Pill>
                  {refused ? <Pill tone="warn">{say(a.monthRefused(refused))}</Pill> : null}
                  {failed ? <Pill tone="bad">{say(a.monthFailed(failed))}</Pill> : null}
                </span>
                {month.map((t, i) => {
                  const total = t.ok + t.refused + t.failed;
                  const label = a.tools[t.tool];
                  return (
                    <div key={t.tool} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5 }}>
                        <span>{label ? say(label) : t.tool}</span>
                        <b className="num">{total}</b>
                      </span>
                      <span style={{ display: "block", height: 8, borderRadius: 5, background: "var(--s3)", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${(total / most) * 100}%`, background: "var(--info)", transformOrigin: "left", animation: `xGrowX .7s var(--ease) ${i * 50}ms both` }} />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <CardHead title={say(a.connectionsTitle)} />
            {rows === null ? (
              <div style={{ marginTop: 10 }}>
                <Sub text={a.failed} language={language} />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState icon="link" title={say(a.noConnections)} />
            ) : (
              <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column" }}>
                {rows.map((r) => {
                  const status = statusOf(r, now);
                  const live = isLive(r, now);
                  return (
                    <li key={r.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
                      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>
                          {r.staffName} · {say(providerName(r))}{" "}
                          <Pill tone={status === "allowed" ? "ok" : status === "idle" ? "warn" : "mut"}>{say(STATUS_LABEL[status])}</Pill>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--mut)" }}>
                          {say(a.colCreated)} {istDate(r.createdAt)} · {say(a.colLastUsed)} {r.lastUsedAt ? istDateTime(r.lastUsedAt) : say(a.never)} · {say(a.colExpires)} {istDate(r.expiresAt)}
                          {r.revokedAt ? ` · ${istDate(r.revokedAt)} (${r.revokeReason ?? ""})` : ""}
                        </div>
                      </div>
                      {live ? (
                        <form action={disconnectAiConnectionAction}>
                          <input type="hidden" name="connectionId" value={r.id} />
                          <Btn type="submit" variant="danger">{say(a.disconnect)}</Btn>
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </Section>
      </main>
    </VxPage>
  );
}
