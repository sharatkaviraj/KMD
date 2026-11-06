import * as m from "@/messages/pairs";
import { ms, taskDeliveryMessages } from "@/messages/setup";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { dayLabel } from "@/platform/dates";
import { clearRouteFlagAction } from "@/app/(app)/collection/actions";
import { openRouteFlags } from "@/modules/collection/data/parent-messages-repo";
import { staleReasonLabels, type StaleReason } from "@/modules/collection/domain/parent-policy";
import { FlagRouteForm, ParentSendControls } from "@/modules/collection/ui/parent-send-controls";
import Link from "next/link";
import { Input } from "@/ui/primitives";
import { primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listSends, listTemplates } from "@/modules/collection/data/messages-repo";
import {
  bySendOrder,
  messageAudienceLabels,
  sendStatusLabels,
  needsProviderReconciliation,
  isGenericMessageTemplate,
  isTeacherTaskCampaign,
} from "@/modules/collection/domain/messages";
import { waMeLink } from "@/modules/collection/domain/requests";
import {
  QueueMessageForm,
  SendButton,
  TemplateForm,
} from "@/modules/collection/ui/office-forms";
import {
  cancelSendAction,
  confirmProviderResultAction,
  markSentAction,
  setTemplateActiveAction,
} from "@/app/(app)/collection/actions";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { Button, buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.messagesTitle) };
}

const STATUS_TONE = {
  draft: "neutral",
  queued: "warning",
  sent: "success",
  failed: "danger",
  cancelled: "neutral",
} as const;

/**
 * Templates, and the queue that does not send by itself.
 *
 * Every row shows the text exactly as it will read, because that is the thing
 * a person is actually approving. **A parent-facing message opens in somebody's
 * own WhatsApp** and is marked sent when they say so — D-10, and the reason is
 * that the day one goes out wrong it goes out wrong to four hundred families
 * at once, with no recall.
 *
 * Staff messages can go through the provider, and even those need an API key
 * this repo does not carry: sending costs money, which rule 8 makes somebody
 * else's decision.
 */
export default async function MessagesPage() {
  const staff = await requirePermission("collection:manage", "/collection/messages");
  const language = staff.language;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowSampark} title={m.messagesTitle} language={language} back={BACK} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const [templates, sends, flags] = await Promise.all([
    listTemplates(),
    listSends(sessionLabel),
    openRouteFlags(),
  ]);
  const admin = can(staff, "jobs:run");

  const active = templates.filter(isGenericMessageTemplate);
  const queue = [...sends].sort(bySendOrder);

  return (
    <>
      <PageHeader eyebrow={m.eyebrowSampark} title={m.messagesTitle} language={language} back={BACK} />

      <Notice
        className="mb-5"
        tone="warning"
        text={m.messagesParentRule}
        language={language}
      >
        <Link href="/collection/policy" className="text-[13px] font-semibold underline">
          {primary(ms.policyTitle, language)}
        </Link>
      </Notice>

      {/* Numbers somebody reported as wrong (P9): nothing goes to them, and an
          administrator clears one only after checking, with a note. */}
      {flags.length > 0 ? (
        <Section className="mb-6" title={ms.messagesFlagged} language={language}>
          <p className="mb-2 text-[13px] text-muted-foreground">{primary(ms.messagesFlaggedHint, language)}</p>
          <ul className="space-y-2" data-route-flags>
            {flags.map((flag) => (
              <li key={flag.id}>
                <Card className="p-3 text-[13px]">
                  <p className="font-semibold text-foreground">{flag.phone}</p>
                  <p className="text-muted-foreground">
                    {flag.reason} · {flag.flaggedByName ?? "—"} · {primary(dayLabel(flag.flaggedAt.slice(0, 10)), language)}
                  </p>
                  {admin ? (
                    <form action={clearRouteFlagAction} className="mt-2 flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={flag.id} />
                      <Input
                        name="note"
                        required
                        maxLength={300}
                        aria-label={primary(ms.messagesFlagClearNote, language)}
                        placeholder={primary(ms.messagesFlagClearNote, language)}
                        className="h-10 min-w-0 flex-1"
                      />
                      <Button type="submit" variant="ghost" size="sm">
                        {primary(ms.messagesFlagClear, language)}
                      </Button>
                    </form>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* -------------------------------------------------- the queue */}

      <Section title={m.messagesQueue} language={language}>
        {queue.length === 0 ? (
          <EmptyState title={m.messagesNone} language={language} />
        ) : (
          <ul className="space-y-3">
            {queue.map((send) => (
              <li key={send.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-foreground">
                        {send.toName ?? send.toPhone}
                      </p>
                      <p className="truncate text-[12px] text-subtle-foreground">
                        {language === "en"
                          ? send.templateLabelEn
                          : send.templateLabelHi}{" "}
                        · {primary(messageAudienceLabels[send.audience], language)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={STATUS_TONE[send.status]}>
                        {primary(needsProviderReconciliation(send) ? ms.messagesProviderCheck : sendStatusLabels[send.status], language)}
                      </Badge>
                      {send.staleReason && send.status !== "cancelled" ? (
                        <Badge tone="warning">{primary(ms.messagesStaleBadge, language)}</Badge>
                      ) : null}
                    </div>
                  </div>

                  {/* The text as it will actually read. This is the thing being
                      approved, so it is shown rather than summarised. */}
                  <p className="mt-3 whitespace-pre-line rounded-xl bg-surface-2 px-3 py-2 text-[14px] leading-6 text-foreground">
                    {language === "en" ? send.renderedEn : send.renderedHi}
                  </p>

                  {send.status === "cancelled" && send.staleReason?.includes("route_flagged") ? (
                    <p className="mt-2 text-[12px] text-destructive-soft-foreground" data-withdrawn={send.id}>
                      {primary(ms.messagesWithdrawnWrongNumber, language)}
                    </p>
                  ) : send.error ? (
                    <p className="mt-2 text-[12px] text-destructive-soft-foreground">
                      {send.error}
                    </p>
                  ) : null}

                  {/* What changed under this message. Read from the row, so it is
                      still here after the send is recorded and after a reload:
                      a message that went out after something moved needs a
                      correction, and the screen keeps saying so (P9). */}
                  {send.staleReason && send.status !== "cancelled" ? (
                    <Notice
                      className="mt-2"
                      tone="warning"
                      text={send.status === "sent" ? ms.messagesSentWarning : ms.messagesStale}
                      language={language}
                    >
                      <ul className="mt-1 list-disc pl-5 text-[12px]" data-stale-reasons={send.id}>
                        {send.staleReason.split(",").map((reason) => (
                          <li key={reason}>
                            {staleReasonLabels[reason as StaleReason]
                              ? primary(staleReasonLabels[reason as StaleReason], language)
                              : reason}
                          </li>
                        ))}
                      </ul>
                    </Notice>
                  ) : null}

                  {send.taskId || isTeacherTaskCampaign(send.templateCode) ? <Link className="mt-3 block text-sm text-primary" href={send.taskId?`/inbox?task=${send.taskId}`:"/inbox"}>{primary(taskDeliveryMessages.review,language)}</Link> : needsProviderReconciliation(send) ? (
                    <div className="mt-3 space-y-2">
                      <Notice tone="warning" text={ms.messagesProviderCheckHint} language={language} />
                      <form action={confirmProviderResultAction} className="space-y-2">
                        <input type="hidden" name="id" value={send.id} />
                        <label className="flex items-start gap-2 text-[13px]">
                          <input type="checkbox" name="checked" value="yes" required />
                          {primary(ms.messagesProviderChecked, language)}
                        </label>
                        <Input name="note" required minLength={5} maxLength={500} aria-label={primary(ms.messagesProviderEvidence, language)} placeholder={primary(ms.messagesProviderEvidence, language)} />
                        <Button type="submit" variant="outline" size="sm">{primary(ms.messagesProviderConfirm, language)}</Button>
                      </form>
                    </div>
                  ) : send.audience === "parent" && send.status !== "sent" && send.status !== "cancelled" ? (
                    <div className="mt-3 space-y-2">
                      <ParentSendControls id={send.id} approved={Boolean(send.approvedAt) && !send.staleReason} />
                      <div className="flex flex-wrap items-center gap-2">
                        <FlagRouteForm phone={send.toPhone} studentId={send.studentId} />
                        <form action={cancelSendAction}>
                          <input type="hidden" name="id" value={send.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            {primary(m.messagesCancel, language)}
                          </Button>
                        </form>
                      </div>
                    </div>
                  ) : send.status !== "sent" && send.status !== "cancelled" ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <a
                        href={waMeLink(
                          send.toPhone,
                          language === "en" ? send.renderedEn : send.renderedHi,
                        )}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={buttonClasses({ size: "sm" })}
                      >
                        {primary(m.messagesSendByHand, language)}
                      </a>

                      <form action={markSentAction}>
                        <input type="hidden" name="id" value={send.id} />
                        <Button type="submit" variant="outline" size="sm">
                          {primary(m.messagesMarkSent, language)}
                        </Button>
                      </form>

                      {send.audience === "staff" ? <SendButton id={send.id} /> : null}

                      <form action={cancelSendAction}>
                        <input type="hidden" name="id" value={send.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          {primary(m.messagesCancel, language)}
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {active.length > 0 ? (
        <Section className="mt-8" title={m.messagesQueue} language={language}>
          <Card className="p-4">
            <QueueMessageForm templates={active} />
          </Card>
        </Section>
      ) : null}

      {/* ---------------------------------------------- the templates */}

      <Section className="mt-8" title={m.messagesTemplates} language={language}>
        {templates.length === 0 ? (
          <EmptyState title={m.messagesNone} language={language} />
        ) : (
          <ul className="space-y-3">
            {templates.map((template) => (
              <li key={template.id}>
                <Card className="p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-foreground">
                        {language === "en" ? template.labelEn : template.labelHi}
                      </p>
                      <p className="truncate text-[12px] text-subtle-foreground">
                        <span className="font-mono">{template.code}</span> ·{" "}
                        {primary(messageAudienceLabels[template.audience], language)}
                      </p>
                    </div>
                    {!template.isActive ? (
                      <Badge tone="neutral">
                        {primary(m.collectionRetired, language)}
                      </Badge>
                    ) : null}
                  </div>

                  <TemplateForm template={template} />

                  <form action={setTemplateActiveAction} className="mt-2">
                    <input type="hidden" name="id" value={template.id} />
                    <input
                      type="hidden"
                      name="active"
                      value={template.isActive ? "false" : "true"}
                    />
                    <Button type="submit" variant="ghost" size="sm" fullWidth>
                      {primary(
                        template.isActive ? m.collectionRetire : m.collectionRestore,
                        language,
                      )}
                    </Button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section className="mt-8" title={m.add} language={language}>
        <Card className="p-4">
          <TemplateForm />
        </Card>
      </Section>
    </>
  );
}

const BACK = { href: "/collection", label: m.collectionTitle };
