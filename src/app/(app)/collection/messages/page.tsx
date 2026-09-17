import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listSends, listTemplates } from "@/modules/collection/data/messages-repo";
import {
  bySendOrder,
  messageAudienceLabels,
  sendStatusLabels,
} from "@/modules/collection/domain/messages";
import { waMeLink } from "@/modules/collection/domain/requests";
import {
  QueueMessageForm,
  SendButton,
  TemplateForm,
} from "@/modules/collection/ui/office-forms";
import {
  cancelSendAction,
  markSentAction,
  setTemplateActiveAction,
} from "@/app/(app)/collection/actions";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { Button, buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

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
        <PageHeader title={m.messagesTitle} language={language} back={BACK} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const [templates, sends] = await Promise.all([
    listTemplates(),
    listSends(sessionLabel),
  ]);

  const active = templates.filter((template) => template.isActive);
  const queue = [...sends].sort(bySendOrder);

  return (
    <>
      <PageHeader title={m.messagesTitle} language={language} back={BACK} />

      <Notice
        className="mb-5"
        tone="warning"
        text={m.messagesParentRule}
        language={language}
      />

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
                    <Badge tone={STATUS_TONE[send.status]}>
                      {primary(sendStatusLabels[send.status], language)}
                    </Badge>
                  </div>

                  {/* The text as it will actually read. This is the thing being
                      approved, so it is shown rather than summarised. */}
                  <p className="mt-3 whitespace-pre-line rounded-xl bg-surface-2 px-3 py-2 text-[14px] leading-6 text-foreground">
                    {language === "en" ? send.renderedEn : send.renderedHi}
                  </p>

                  {send.error ? (
                    <p className="mt-2 text-[12px] text-destructive-soft-foreground">
                      {send.error}
                    </p>
                  ) : null}

                  {send.status !== "sent" && send.status !== "cancelled" ? (
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
