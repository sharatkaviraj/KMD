"use client";

import { useActionState } from "react";
import Link from "next/link";
import {taskDeliveryMessages} from "@/messages/setup";
import { Check, Link2, Send, TriangleAlert, Users } from "lucide-react";

import {
  createLinksAction,
  markRemindedAction,
  markSentAction,
  openRoundAction,
} from "@/app/(app)/collection/rounds/[id]/actions";
import * as m from "@/messages/pairs";
import { roundStatusLabel } from "@/modules/collection/domain/rounds";
import { idleCollectionState } from "@/modules/collection/domain/form-state";
import { countOf, primary, type Language, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Badge, Card, Notice } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";

/**
 * A round's links, and how far each has got.
 *
 * **"Class 6 · 14 children · 9 answered" is the sentence somebody chasing a
 * round needs.** A list of tokens is not, and neither is a single percentage
 * over the whole round: the thing the office acts on is *which* class has not
 * come back, because that is who gets the phone call.
 */

export type BoardLink = {
  managedTaskId?: string;
  id: string;
  token: string;
  audienceKind: string;
  audienceLabel: string;
  status: string;
  assignedStaffName: string | null;
  sentAt: string | null;
  remindedAt: string | null;
  reminderCount: number;
  members: number;
  answered: number;
};

export type BoardPlan = {
  ready: { label: string; ownerName: string; students: number }[];
  blocked: { label: string; reason: string; message: Localized; students: number }[];
  unassigned: { fullName: string; classLabel: string; reason: string }[];
  totals: { links: number; students: number; skipped: number };
};

export function RoundBoard({
  roundId,
  origin,
  plan,
  links,
  mayManage,
}: {
  roundId: string;
  origin: string;
  plan: BoardPlan;
  links: BoardLink[];
  mayManage: boolean;
}) {
  const language = useLanguage();
  const hasLinks = links.length > 0;

  return (
    <div className="space-y-6">
      {hasLinks ? (
        <Board roundId={roundId} origin={origin} links={links} language={language} mayManage={mayManage} />
      ) : null}

      {mayManage ? (
        <FanOut roundId={roundId} plan={plan} resuming={hasLinks} language={language} />
      ) : null}

      {!hasLinks && !mayManage ? (
        <Notice tone="info" text={m.boardNoLinks} language={language} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ the board */

function Board({
  roundId,
  origin,
  links,
  language,
  mayManage,
}: {
  roundId: string;
  origin: string;
  links: BoardLink[];
  language: Language;
  mayManage: boolean;
}) {
  const [openState, open, opening] = useActionState(openRoundAction, idleCollectionState);
  const anyDraft = links.some((link) => link.status === "draft");

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-semibold text-foreground">
        {primary(m.boardTitle, language)}
      </h2>

      {openState.status === "error" && openState.message ? (
        <Notice tone="danger" text={openState.message} language={language} />
      ) : null}

      {/* A draft link answers the same 404 an invented token gets, so a round
          whose links are all drafts has gone to nobody however many were
          made. One button, because opening a round is a single decision. */}
      {mayManage && anyDraft ? (
        <form action={open}>
          <input type="hidden" name="roundId" value={roundId} />
          <Button type="submit" fullWidth loading={opening}>
            {primary(m.boardOpen, language)}
          </Button>
        </form>
      ) : null}

      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.id}>
            <LinkRow
              roundId={roundId}
              origin={origin}
              link={link}
              language={language}
              mayManage={mayManage}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function LinkRow({
  roundId,
  origin,
  link,
  language,
  mayManage,
}: {
  roundId: string;
  origin: string;
  link: BoardLink;
  language: Language;
  mayManage: boolean;
}) {
  const [, sent, sending] = useActionState(markSentAction, idleCollectionState);
  const [, reminded, reminding] = useActionState(markRemindedAction, idleCollectionState);

  const done = link.members > 0 && link.answered >= link.members;
  const isMaster = link.audienceKind === "master";

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        {isMaster ? (
          <Link2 aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
        ) : (
          <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-foreground">
            {isMaster ? primary(m.boardMaster, language) : link.audienceLabel}
          </p>

          {/* The count first, because it is what the office is scanning for. */}
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {countOf(link.answered, link.members, language)}{" "}
            {primary(m.boardAnswered, language)}
            {link.assignedStaffName ? (
              <span className="text-subtle-foreground"> · {link.assignedStaffName}</span>
            ) : null}
          </p>

          <p className="mt-2 break-all font-mono text-[11px] text-subtle-foreground">
            {link.managedTaskId?<Link href={`/inbox?task=${link.managedTaskId}`}>{primary(taskDeliveryMessages.review,language)}</Link>:`${origin}/r/${link.token}`}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {done ? (
            <Badge tone="success">
              <Check aria-hidden className="size-3.5" />
            </Badge>
          ) : null}
          <Badge tone={link.status === "open" ? "success" : "neutral"}>
            {primary(
              link.status === "open" ? m.boardOpened : roundStatusLabel(link.status),
              language,
            )}
          </Badge>
        </div>
      </div>

      {mayManage && !link.managedTaskId && link.status === "open" ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          {/* **Neither of these sends anything.** The office hands the link
              over in WhatsApp itself and ticks it here, so the board says what
              actually happened rather than what this app attempted (D-10). */}
          {link.sentAt ? (
            <span className="inline-flex min-h-11 items-center text-[13px] text-success">
              <Check aria-hidden className="mr-1 size-4" />
              {primary(m.boardSent, language)}
            </span>
          ) : (
            <form action={sent}>
              <input type="hidden" name="requestId" value={link.id} />
              <input type="hidden" name="roundId" value={roundId} />
              <Button type="submit" variant="outline" size="sm" loading={sending}>
                <Send aria-hidden />
                {primary(m.boardMarkSent, language)}
              </Button>
            </form>
          )}

          {link.sentAt && !done ? (
            <form action={reminded}>
              <input type="hidden" name="requestId" value={link.id} />
              <input type="hidden" name="roundId" value={roundId} />
              <input type="hidden" name="reminderCount" value={link.reminderCount} />
              <Button type="submit" variant="outline" size="sm" loading={reminding}>
                {primary(m.boardMarkReminded, language)}
                {link.reminderCount > 0 ? ` (${link.reminderCount})` : ""}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------- the fan-out */

const BLOCKED_LABELS: Record<string, Localized> = {
  "many-owners": m.fanOutManyOwners,
  "no-owner": m.fanOutNoOwner,
  "no-phone": m.fanOutNoPhone,
};

const UNASSIGNED_LABELS: Record<string, Localized> = {
  "no-house": m.fanOutNoHouse,
  "no-route": m.fanOutNoRoute,
};

function FanOut({
  roundId,
  plan,
  resuming,
  language,
}: {
  roundId: string;
  plan: BoardPlan;
  resuming: boolean;
  language: Language;
}) {
  const [state, create, creating] = useActionState(createLinksAction, idleCollectionState);

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-semibold text-foreground">
        {primary(m.fanOutTitle, language)}
      </h2>

      {state.message ? (
        <Notice
          tone={state.status === "error" ? "danger" : "success"}
          text={state.message}
          language={language}
        />
      ) : null}

      <Card className="p-4">
        <p className="text-[15px] text-foreground">
          <strong className="text-[22px] font-semibold tabular-nums">
            {plan.totals.links}
          </strong>{" "}
          {primary(m.boardLinks, language)}
          <span className="text-muted-foreground">
            {" · "}
            {plan.totals.students} {primary(m.roundCoversMany, language)}
          </span>
        </p>

        {/* **Who gets left out is stated, never inferred.** A round that says
            "19 links" and quietly covers 470 of 504 children is the failure
            this whole screen exists to prevent. */}
        {plan.totals.skipped > 0 ? (
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-warning">
            <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
            {plan.totals.skipped} {primary(m.fanOutSkipped, language)}
          </p>
        ) : null}

        <form action={create} className="mt-3">
          <input type="hidden" name="roundId" value={roundId} />
          <Button
            type="submit"
            fullWidth
            loading={creating}
            disabled={plan.totals.links === 0}
          >
            {primary(resuming ? m.fanOutResume : m.fanOutCreate, language)}
          </Button>
        </form>
      </Card>

      {plan.blocked.length > 0 ? (
        <Card className="p-4">
          <p className="text-[14px] font-medium text-foreground">
            {primary(m.fanOutBlocked, language)}: {plan.blocked.length}
          </p>
          <ul className="mt-2 space-y-2">
            {plan.blocked.map((group) => (
              <li key={`${group.label}-${group.reason}`} className="text-[13px] leading-5">
                <span className="font-medium">{group.label}</span>{" "}
                <span className="text-subtle-foreground">
                  ({group.students} {primary(m.roundCoversMany, language)})
                </span>
                <span className="block text-muted-foreground">
                  {primary(BLOCKED_LABELS[group.reason] ?? group.message, language)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {plan.unassigned.length > 0 ? (
        <Card className="p-4">
          <p className="text-[14px] font-medium text-foreground">
            {primary(m.fanOutUnassigned, language)}: {plan.unassigned.length}
          </p>
          {/* Named, never counted away: these are exactly the children whose
              records are thinnest, and a number tells nobody which. */}
          <ul className="mt-2 space-y-1">
            {plan.unassigned.slice(0, 20).map((row) => (
              <li key={`${row.fullName}-${row.classLabel}`} className="text-[13px] leading-5">
                <span>{row.fullName}</span>{" "}
                <span className="text-subtle-foreground">{row.classLabel}</span>
                <span className="block text-muted-foreground">
                  {primary(UNASSIGNED_LABELS[row.reason] ?? m.fanOutUnassigned, language)}
                </span>
              </li>
            ))}
          </ul>
          {plan.unassigned.length > 20 ? (
            <p className="mt-2 text-[12px] text-subtle-foreground">
              {countOf(20, plan.unassigned.length, language)}
            </p>
          ) : null}
        </Card>
      ) : null}
    </section>
  );
}
