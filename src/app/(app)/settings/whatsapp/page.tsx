import Link from "@/ui/link";
import type { CSSProperties, ReactNode } from "react";

import { HUB_TEMPLATE_SUBMISSIONS, templatesThatCount } from "@/modules/whatsapp/domain/hub-templates";
import { featureLabels, messageStatusLabels, noteFor, templateStatusLabels, waMessages as w } from "@/messages/whatsapp-settings";
import { requirePermission } from "@/platform/auth/current-staff";
import type { Language, Localized } from "@/platform/i18n/language";
import { WHATSAPP_FEATURES } from "@/platform/whatsapp/policy";
import { loadWhatsAppOverview, type MessageView, type TemplateView } from "@/platform/whatsapp/overview";
import { Ic, type IconName } from "@/vx/icons";
import { lead, under } from "@/vx/text";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { PendingBtn } from "@/vx/ui/pending-btn";
import { Card, CardHead, EmptyState, Pill } from "@/vx/ui/primitives";

import {
  checkConnectionAction,
  retryMessageAction,
  setFeatureAction,
  setPracticeModeAction,
  submitHubTemplatesAction,
  syncTemplatesAction,
} from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "School WhatsApp" };

type Tone = "ok" | "warn" | "bad" | "info" | "acc" | "mut" | "pri";

const STATUS_TONE: Record<string, Tone> = {
  dry_run: "info",
  held: "warn",
  queued: "warn",
  sending: "warn",
  retry_wait: "warn",
  accepted: "ok",
  sent: "ok",
  delivered: "ok",
  read: "ok",
  failed: "bad",
  unknown: "bad",
  cancelled: "mut",
};

const TEMPLATE_TONE: Record<string, Tone> = {
  approved: "ok",
  pending: "warn",
  not_submitted: "mut",
  rejected: "bad",
  paused: "bad",
  disabled: "bad",
};

const NOTE_ICON: Record<string, IconName> = { ok: "checkCircle", warn: "alert", bad: "alert", info: "info" };

/** The cards an action's answer can land on (`back()` in actions.ts). */
const ANCHORS = new Set(["conn", "practice", "feature", "hub", "templates", "retry"]);

/** The `_v8` Pay now set, by registry key (= the name it has on the hub). */
const HUB_SET = new Set(HUB_TEMPLATE_SUBMISSIONS.map((submission) => submission.name));
const QUALITY_TONE: Record<string, Tone> = { GREEN: "ok", YELLOW: "warn", RED: "bad" };
const anchorStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, scrollMarginTop: 76 };

const istTime = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });

function Sub({ text, language }: { text: Localized; language: Language }) {
  const second = under(text, language);
  return (
    <p style={{ margin: 0, fontSize: 13.5, color: "var(--mut)", lineHeight: 1.5 }}>
      {lead(text, language)}
      {second ? <span style={{ display: "block", fontSize: 12.5 }}>{second}</span> : null}
    </p>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "9px 0", borderTop: "1px solid var(--bd)", fontSize: 14 }}>
      <span style={{ color: "var(--mut)" }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

const list: CSSProperties = { listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column" };
const rowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "12px 0", borderTop: "1px solid var(--bd)" };

function MessageRow({ m, language, canChange }: { m: MessageView; language: Language; canChange: boolean }) {
  const say = (text: Localized) => lead(text, language);
  const feature = featureLabels[m.feature];
  return (
    <li style={rowStyle}>
      <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 650 }}>
          {m.toName || m.to}
          <Pill tone={STATUS_TONE[m.status] ?? "mut"}>{say(messageStatusLabels[m.status] ?? { hi: m.status, en: m.status })}</Pill>
          {m.paidAt ? <Pill tone="ok" icon="rupee">{say(w.paid)}</Pill> : null}
          {m.retried ? <Pill tone="mut">{say(w.retried)}</Pill> : null}
        </span>
        <span style={{ fontSize: 12.5, color: "var(--mut)" }}>
          {feature ? say(feature) : m.feature} · {m.to} · {istTime.format(new Date(m.at))}
        </span>
        {m.problem ? <Sub text={m.problem.text} language={language} /> : null}
      </div>
      {m.problem && canChange ? (
        m.ownScreen ? (
          <Link href={m.ownScreen} className="tap btn sec" style={{ textDecoration: "none" }}>
            <Ic n="arrowRight" size={18} />
            {say(w.retryOwnScreen)}
          </Link>
        ) : m.canRetry ? (
          <form action={retryMessageAction}>
            <input type="hidden" name="id" value={m.id} />
            {m.status === "unknown" ? <input type="hidden" name="confirmUnknown" value="1" /> : null}
            <PendingBtn
              label={say(m.status === "unknown" ? w.retryUnknown : w.retry)}
              pendingLabel={say(w.retrying)}
              icon="refresh"
              variant={m.status === "unknown" ? "sec" : "pri"}
              confirm={m.status === "unknown" ? say(w.retryUnknownHelp) : undefined}
            />
          </form>
        ) : null
      ) : null}
    </li>
  );
}

/** A template's review on the school's account, and its quality once approved. */
function TemplateStatus({ row, language }: { row: TemplateView; language: Language }) {
  const say = (text: Localized) => lead(text, language);
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      <Pill tone={TEMPLATE_TONE[row.status] ?? "mut"}>{say(templateStatusLabels[row.status] ?? { hi: row.status, en: row.status })}</Pill>
      {row.status === "approved" && row.quality && row.quality !== "UNKNOWN" ? (
        <Pill tone={QUALITY_TONE[row.quality] ?? "mut"}>{say(w.quality(row.quality))}</Pill>
      ) : null}
    </span>
  );
}

/**
 * Settings → WhatsApp (D-562, D-566): the school's own number (+91 83022 07823),
 * whether this deployment is connected to it, who may receive a message, which
 * kinds of message are switched on, which templates Meta has approved (and the
 * hub's Pay now set, sent for approval from here), what
 * did not arrive (in plain words, with Send again) and parents' replies.
 * Admin only (`settings:manage`); the actions also require the admin role.
 */
export default async function WhatsAppSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("settings:manage", "/settings/whatsapp");
  const language = staff.language;
  const say = (text: Localized) => lead(text, language);
  const canChange = staff.role === "admin";
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const note = typeof params.note === "string" ? noteFor(params.note, params) : null;
  const view = await loadWhatsAppOverview();
  const switches = view.switches;
  const practice = switches?.dryRun !== false;

  const templates = view.templates ?? [];
  const byFeature = new Map<string, typeof templates>();
  for (const template of templates) byFeature.set(template.feature, [...(byFeature.get(template.feature) ?? []), template]);
  const approvedCount = templates.filter((template) => template.status === "approved").length;
  const hubRows = templates.filter((template) => HUB_SET.has(template.key));
  const hubApproved = hubRows.filter((row) => row.status === "approved").length;
  const hubWaiting = hubRows.filter((row) => row.status === "pending").length;
  const hubToSend = hubRows.filter((row) => row.status === "not_submitted" || row.status === "rejected").length;
  const onHub = view.connected && view.provider === "hub";

  const noteAt = typeof params.note === "string" ? params.note.split("_")[0] : "";
  const banner = note ? (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 14,
        background: `var(--${note.tone === "ok" ? "oks" : note.tone === "bad" ? "bads" : note.tone === "warn" ? "warns" : "infos"})`,
        color: `var(--${note.tone === "ok" ? "ok" : note.tone === "bad" ? "bad" : note.tone === "warn" ? "warnfg" : "info"})`,
        fontSize: 14.5,
        fontWeight: 600,
        animation: "xToast .35s var(--ease) both",
      }}
    >
      <Ic n={NOTE_ICON[note.tone] ?? "info"} size={20} style={{ marginTop: 1 }} />
      <span>{say(note.text)}</span>
    </div>
  ) : null;
  /** The answer sits just above the card that was pressed, where the page lands. */
  const here = (id: string) => (noteAt === id ? banner : null);

  const providerText =
    view.provider === "hub" ? w.providerHub : view.provider === "meta_cloud" ? w.providerMeta : view.provider === "mock" ? w.providerMock : w.providerNone;

  return (
    <VxPage>
      <TopBar crumb={say(w.crumb)} title={say(w.title)} mBack="/settings" />
      <main>
        <Section style={{ maxWidth: 980 }}>
          {ANCHORS.has(noteAt) ? null : banner}

          <div id="conn" style={anchorStyle}>
            {here("conn")}
            <Card style={{ display: "flex", flexDirection: "column", gap: 12, animation: "xIn .32s var(--ease) both" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <span aria-hidden="true" style={{ flex: "none", width: 48, height: 48, borderRadius: 14, background: view.connected ? "var(--oks)" : "var(--warns)", color: view.connected ? "var(--ok)" : "var(--warnfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Ic n="message" size={24} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 18, fontWeight: 800 }}>
                    +91 83022 07823
                    <Pill tone={view.connected ? "ok" : "warn"}>{say(view.connected ? w.connected : w.notConnected)}</Pill>
                    {practice ? <Pill tone="info">{say(w.practiceBadge)}</Pill> : null}
                  </span>
                  <span style={{ fontSize: 13.5, color: "var(--mut)" }}>{w.senderName}</span>
                </span>
              </div>
              <Sub text={w.intro} language={language} />
              <div>
                <Fact label={say(w.rowProvider)}>{say(providerText)}</Fact>
                <Fact label={say(w.rowWebhook)}>{say(view.webhookReady ? w.webhookOn : w.webhookOff)}</Fact>
              </div>
              {!view.connected ? <Sub text={w.notConnectedHelp} language={language} /> : null}
              {canChange ? (
                <form action={checkConnectionAction}>
                  <PendingBtn label={say(w.checkConnection)} pendingLabel={say(w.checking)} icon="refresh" big />
                </form>
              ) : null}
            </Card>
          </div>

          <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 16 }}>
            <Card>
              <CardHead title={say(w.safetyTitle)} badge={<Pill tone={switches?.realRecipients ? "bad" : "ok"} icon="shield">{say(switches?.realRecipients ? w.realOn : w.realOff)}</Pill>} />
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                {switches ? null : <Sub text={w.switchesUnread} language={language} />}
                <Sub text={w.realOffHelp} language={language} />
                <div>
                  <Fact label={say(w.ownerNumber)}>{view.ownerNumberMasked ?? say(w.ownerMissing)}</Fact>
                  <Fact label={say(w.dailyLimit)}>
                    {switches?.dailyLimit ?? 0}
                    {view.sentToday !== null ? <span style={{ display: "block", fontSize: 12, color: "var(--mut)", fontWeight: 500 }}>{say(w.sentToday(view.sentToday))}</span> : null}
                  </Fact>
                </div>
              </div>
            </Card>

            <div id="practice" style={anchorStyle}>
              {here("practice")}
              <Card>
                <CardHead title={say(w.practiceTitle)} badge={<Pill tone={practice ? "info" : "warn"}>{say(practice ? w.on : w.off)}</Pill>} />
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12 }}>
                  <Sub text={practice ? w.practiceOnHelp : w.practiceOffHelp} language={language} />
                  {canChange && switches ? (
                    <form action={setPracticeModeAction}>
                      <input type="hidden" name="on" value={practice ? "false" : "true"} />
                      <PendingBtn label={say(practice ? w.practiceTurnOff : w.practiceTurnOn)} pendingLabel={say(w.saving)} icon={practice ? "send" : "shield"} variant={practice ? "sec" : "pri"} big />
                    </form>
                  ) : null}
                </div>
              </Card>
            </div>
          </div>

          <div id="feature" style={anchorStyle}>
            {here("feature")}
            <Card>
              <CardHead title={say(w.featuresTitle)} />
              <div style={{ marginTop: 8 }}>
                <Sub text={w.featuresHelp} language={language} />
              </div>
              <ul style={list}>
                {WHATSAPP_FEATURES.map((feature) => {
                  const on = switches?.features[feature] === true;
                  const rows = templatesThatCount(byFeature.get(feature) ?? []);
                  const approved = rows.filter((row) => row.status === "approved").length;
                  return (
                    <li key={feature} style={rowStyle}>
                      <span style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 15, fontWeight: 650 }}>{say(featureLabels[feature] ?? { hi: feature, en: feature })}</span>
                        <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{say(w.templateCounts(approved, rows.length))}</span>
                      </span>
                      <Pill tone={on ? "ok" : "mut"}>{say(on ? w.on : w.off)}</Pill>
                      {canChange && switches ? (
                        <form action={setFeatureAction}>
                          <input type="hidden" name="feature" value={feature} />
                          <input type="hidden" name="on" value={on ? "false" : "true"} />
                          <PendingBtn label={say(on ? w.turnOff : w.turnOn)} pendingLabel={say(w.saving)} icon={on ? "x" : "check"} />
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          <div id="hub" style={anchorStyle}>
            {here("hub")}
            <Card>
              <CardHead title={say(w.hubTitle)} badge={<Pill tone={hubApproved === hubRows.length && hubRows.length > 0 ? "ok" : hubWaiting > 0 ? "warn" : "mut"}>{say(w.templateCounts(hubApproved, hubRows.length))}</Pill>} />
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 12 }}>
                <Sub text={w.hubHelp} language={language} />
                {hubRows.length > 0 ? <span style={{ fontSize: 14, fontWeight: 600 }}>{say(w.hubCounts(hubApproved, hubWaiting, hubToSend))}</span> : null}
                {!canChange ? null : !onHub ? (
                  <Sub text={w.hubNeedsHub} language={language} />
                ) : hubToSend > 0 ? (
                  <form action={submitHubTemplatesAction}>
                    <PendingBtn label={say(w.hubSend(hubToSend))} pendingLabel={say(w.hubSending)} icon="send" big confirm={say(w.hubSendConfirm)} />
                  </form>
                ) : hubRows.length > 0 ? (
                  <Sub text={w.hubAllSent} language={language} />
                ) : null}
              </div>
              {hubRows.length > 0 ? (
                <details style={{ marginTop: 12, border: "1px solid var(--bd)", borderRadius: 14, padding: "10px 14px" }}>
                  <summary className="tap" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 650, listStyle: "none" }}>
                    <Ic n="chevDown" size={18} />
                    <span style={{ flex: 1, minWidth: 0 }}>{say(w.hubList)}</span>
                  </summary>
                  <ul style={{ ...list, marginTop: 8 }}>
                    {hubRows.map((row) => (
                      <li key={row.key} style={{ ...rowStyle, padding: "10px 0" }}>
                        <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontSize: 14, fontWeight: 600 }}>{row.label}</span>
                          <code style={{ fontSize: 12, color: "var(--mut)", overflowWrap: "anywhere" }}>{row.key}</code>
                          {row.reason ? <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{row.reason}</span> : null}
                        </span>
                        <TemplateStatus row={row} language={language} />
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </Card>
          </div>

          <div id="templates" style={anchorStyle}>
            {here("templates")}
            <Card>
              <CardHead title={say(w.templatesTitle)} badge={<Pill tone={approvedCount > 0 ? "ok" : "warn"}>{say(w.templateCounts(approvedCount, templates.length))}</Pill>} />
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 12 }}>
                <Sub text={w.templatesHelp} language={language} />
                {canChange ? (
                  <form action={syncTemplatesAction}>
                    <PendingBtn label={say(w.checkTemplates)} pendingLabel={say(w.checkingTemplates)} icon="refresh" big />
                  </form>
                ) : null}
              </div>
              {view.templates === null ? (
                <div style={{ marginTop: 10 }}>
                  <Sub text={w.logUnread} language={language} />
                </div>
              ) : templates.length === 0 ? (
                <EmptyState icon="file" title={say(w.noTemplates)} />
              ) : (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  {[...byFeature.entries()].map(([feature, rows]) => (
                    <details key={feature} style={{ border: "1px solid var(--bd)", borderRadius: 14, padding: "10px 14px" }}>
                      <summary className="tap" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 650, listStyle: "none" }}>
                        <Ic n="chevDown" size={18} />
                        <span style={{ flex: 1, minWidth: 0 }}>{say(featureLabels[feature] ?? { hi: feature, en: feature })}</span>
                        <Pill tone={rows.some((row) => row.status === "approved") ? "ok" : "mut"}>{say(w.templateCounts(rows.filter((row) => row.status === "approved").length, rows.length))}</Pill>
                      </summary>
                      <ul style={{ ...list, marginTop: 8 }}>
                        {rows.map((row) => (
                          <li key={row.key} style={{ ...rowStyle, padding: "10px 0" }}>
                            <span style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontSize: 14, fontWeight: 600 }}>{row.label}</span>
                              <code style={{ fontSize: 12, color: "var(--mut)", overflowWrap: "anywhere" }}>{row.key}</code>
                              {row.reason ? <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{row.reason}</span> : null}
                            </span>
                            <TemplateStatus row={row} language={language} />
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div id="retry" style={anchorStyle}>
            {here("retry")}
            <Card>
              <CardHead title={say(w.problemsTitle)} badge={view.problems && view.problems.length > 0 ? <Pill tone="bad">{view.problems.length}</Pill> : undefined} />
              {view.problems === null ? (
                <div style={{ marginTop: 10 }}>
                  <Sub text={w.logUnread} language={language} />
                </div>
              ) : view.problems.length === 0 ? (
                <EmptyState icon="checkCircle" title={say(w.problemsNone)} />
              ) : (
                <ul style={list}>
                  {view.problems.map((m) => (
                    <MessageRow key={m.id} m={m} language={language} canChange={canChange} />
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <CardHead title={say(w.logTitle)} />
            {view.messages === null ? (
              <div style={{ marginTop: 10 }}>
                <Sub text={w.logUnread} language={language} />
              </div>
            ) : view.messages.length === 0 ? (
              <EmptyState icon="message" title={say(w.logNone)} />
            ) : (
              <ul style={list}>
                {view.messages.map((m) => (
                  <MessageRow key={m.id} m={m} language={language} canChange={false} />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHead title={say(w.repliesTitle)} />
            <div style={{ marginTop: 8 }}>
              <Sub text={w.repliesHelp} language={language} />
            </div>
            {view.replies === null ? (
              <div style={{ marginTop: 10 }}>
                <Sub text={w.logUnread} language={language} />
              </div>
            ) : view.replies.length === 0 ? (
              <EmptyState icon="inbox" title={say(w.repliesNone)} />
            ) : (
              <ul style={list}>
                {view.replies.map((reply) => (
                  <li key={reply.id} style={rowStyle}>
                    <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 15, fontWeight: 650 }}>{reply.name ?? reply.from}</span>
                      <span style={{ fontSize: 14.5, lineHeight: 1.45, overflowWrap: "anywhere" }}>{reply.text ?? `(${reply.type})`}</span>
                      <span style={{ fontSize: 12.5, color: "var(--mut)" }}>
                        {reply.from} · {istTime.format(new Date(reply.at))}
                        {reply.answersTemplate ? ` · ${say(w.replyTo)} ${reply.answersTemplate}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Section>
      </main>
    </VxPage>
  );
}
