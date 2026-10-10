"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Avatar, avatarColor, Btn, Pill, Progress, WhatsAppPreview } from "@/vx/ui/primitives";
import { agoP, initials } from "@/vx/format";

import { bilingualReminder, waLink } from "./domain/messages";
import type { ActionResult } from "./save-types";

/*
 * Late teachers and the reminder that goes to them. The reminder is sent
 * from the coordinator's own WhatsApp (wa.me), carrying each teacher's own
 * marks link; the app records that it went.
 */

export type TeacherRowView = {
  id: string;
  name: string;
  phone: string | null;
  phoneMasked: string;
  papers: { paperId: string; classLabel: string; subjectCode: string; entered: number; total: number; status: "done" | "in_progress" | "not_started" | "empty" }[];
  entered: number;
  total: number;
  late: boolean;
  notStarted: boolean;
  link: { url: string; createdAt: string; openedAt: string | null } | null;
  remindedAt: string | null;
};

export type ExamName = { id: string; en: string; hi: string };

export function pendingOf(t: TeacherRowView): string[] {
  return t.papers.filter((x) => x.status !== "done" && x.status !== "empty").map((x) => `${x.classLabel} ${x.subjectCode} (${x.entered}/${x.total})`);
}

export function reminderFor(t: TeacherRowView, exam: ExamName, dueLabel: string, from: string, link: string | null): string {
  return bilingualReminder({ teacherName: t.name, examName: exam.en, examNameHi: exam.hi, pending: pendingOf(t), dueLabel, link, from });
}

export function RemindSheet({
  open,
  onClose,
  teachers,
  exam,
  dueLabel,
  from,
  remind,
}: {
  open: boolean;
  onClose: () => void;
  teachers: TeacherRowView[];
  exam: ExamName;
  dueLabel: string;
  from: string;
  remind: (input: { examId: string; staffIds: string[] }) => Promise<ActionResult>;
}) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sent, setSent] = useState<Map<string, string | null> | null>(null);
  const first = teachers[0];
  const close = () => {
    setSent(null);
    onClose();
  };

  if (!first) return null;
  const newLinks = teachers.filter((t) => !t.link).length;
  const text = reminderFor(first, exam, dueLabel, from, first.link?.url ?? "(link)");

  const send = () =>
    start(async () => {
      const r = await remind({ examId: exam.id, staffIds: teachers.map((t) => t.id) }).catch(() => null);
      if (!r || !r.ok) {
        toast.show({ text: tx(r && !r.ok ? r.message : p("Could not record the reminders", "रिमाइंडर दर्ज नहीं हुए")), tone: "bad" });
        return;
      }
      const links = (r.data?.links as { staffId: string; url: string | null }[] | undefined) ?? [];
      setSent(new Map(links.map((l) => [l.staffId, l.url])));
      router.refresh();
      if (teachers.length === 1) {
        const url = links[0]?.url ?? null;
        window.open(waLink(first.phone, reminderFor(first, exam, dueLabel, from, url)), "_blank", "noopener");
      }
    });

  return (
    <Sheet
      open={open}
      onClose={close}
      icon="send"
      title={sent ? tx(p("Open each chat to send", "भेजने के लिए हर चैट खोलें")) : teachers.length === 1 ? `${tx(p("Remind", "याद दिलाएँ"))} ${first.name}?` : `${tx(p("Remind", "याद दिलाएँ"))} ${teachers.length} ${tx(p("teachers?", "शिक्षकों को?"))}`}
      sub={`${tx({ en: exam.en, hi: exam.hi })} · ${tx(p("due", "अंतिम तिथि"))} ${dueLabel}`}
      footer={
        sent ? (
          <Btn variant="pri" full onClick={close}>
            {tx(p("Done", "हो गया"))}
          </Btn>
        ) : (
          <div style={{ display: "flex", gap: 10, width: "100%" }}>
            <Btn variant="sec" onClick={close} style={{ flex: 1 }}>
              {tx(p("Cancel", "रद्द करें"))}
            </Btn>
            <Btn variant="pri" icon="send" disabled={pending} onClick={send} style={{ flex: 2 }}>
              {teachers.length === 1 ? tx(p("Send reminder", "रिमाइंडर भेजें")) : `${tx(p("Send", "भेजें"))} ${teachers.length} ${tx(p("reminders", "रिमाइंडर"))}`}
            </Btn>
          </div>
        )
      }
    >
      {sent ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 13, color: "var(--mut)", marginBottom: 6 }}>
            {tx(p("Recorded. Each teacher gets her own link with only her classes.", "दर्ज हो गया। हर शिक्षक को केवल अपनी कक्षाओं वाला लिंक मिलता है।"))}
          </span>
          {teachers.map((t) => {
            const url = sent.get(t.id) ?? null;
            const msg = reminderFor(t, exam, dueLabel, from, url);
            return (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
                <Avatar text={initials(t.name)} bg={avatarColor(t.id)} size={34} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <strong className="clip">{t.name}</strong>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{t.phoneMasked || tx(p("No phone saved", "फ़ोन नंबर नहीं है"))}</span>
                </span>
                <Btn variant="soft" icon="copy" onClick={() => void navigator.clipboard?.writeText(msg).then(() => toast.show({ text: tx(p("Message copied", "संदेश कॉपी हुआ")) }))}>
                  <span className="hide-m">{tx(p("Copy", "कॉपी"))}</span>
                </Btn>
                <a className="tap btn pri" href={waLink(t.phone, msg)} target="_blank" rel="noopener noreferrer">
                  <Ic n="send" size={16} /> WhatsApp
                </a>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mut)" }}>
            {tx(p("Preview · to", "झलक ·"))} {first.name}
            {teachers.length > 1 ? tx(p(" (each teacher gets their own link)", " (हर शिक्षक को अपना लिंक)")) : ""}
          </span>
          <WhatsAppPreview title={first.name} lines={text.split("\n")} />
          {teachers.length > 1 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {teachers.map((t) => (
                <Pill key={t.id}>{t.name}</Pill>
              ))}
            </div>
          ) : null}
          <div className="card" style={{ padding: "4px 14px" }}>
            {[
              [p("To", "किसे"), `${teachers.length} ${tx(teachers.length === 1 ? p("teacher", "शिक्षक") : p("teachers", "शिक्षक"))}`],
              [p("New links", "नए लिंक"), newLinks ? `${newLinks} · ${tx(p("made when you send", "भेजते समय बनेंगे"))}` : tx(p("None needed", "ज़रूरत नहीं"))],
              [p("Sent through", "भेजा जाएगा"), tx(p("Your WhatsApp · no cost", "आपका WhatsApp · कोई खर्च नहीं"))],
            ].map(([k, v]) => (
              <div key={tx(k as Pair)} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
                <span style={{ color: "var(--mut)" }}>{tx(k as Pair)}</span>
                <strong style={{ textAlign: "right" }}>{v as string}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** One late teacher as a row: her papers as chips, how far she has got, and what to do. */
export function TeacherLateRow({
  t,
  onRemind,
  onCall,
  callTag,
  readOnly,
}: {
  t: TeacherRowView;
  onRemind?: () => void;
  onCall?: () => void;
  callTag?: string | null;
  readOnly?: boolean;
}) {
  const { tx } = useVx();
  const share = t.total ? (t.entered / t.total) * 100 : 0;
  const seen = t.link?.openedAt
    ? `${tx(p("Opened the link", "लिंक खोला"))} ${tx(agoP(t.link.openedAt))}`
    : t.link
      ? tx(p("Link not opened yet", "लिंक अभी खोला नहीं"))
      : tx(p("No link yet", "अभी कोई लिंक नहीं"));
  const tag = callTag ?? (t.remindedAt ? `${tx(p("Reminded", "याद दिलाया"))} ${tx(agoP(t.remindedAt))}` : null);
  return (
    <div className="row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", flexWrap: "wrap" }}>
      <Avatar text={initials(t.name)} bg={avatarColor(t.id)} size={40} />
      <span style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong>{t.name}</strong>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{t.phoneMasked}</span>
          {tag ? <Pill tone={callTag ? "ok" : "acc"}>{tag}</Pill> : null}
        </span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {t.papers.map((x) => (
            <Pill key={x.paperId} tone={x.status === "done" ? "ok" : x.entered ? "warn" : "bad"} icon={x.status === "done" ? "check" : undefined}>
              {x.classLabel} {x.subjectCode} {x.status === "done" ? "" : `${x.entered}/${x.total}`}
            </Pill>
          ))}
        </span>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{seen}</span>
      </span>
      <span style={{ width: 150, display: "flex", flexDirection: "column", gap: 4 }}>
        <strong style={{ fontSize: 13 }}>
          {tx(p(`${t.entered} of ${t.total} marks`, `${t.total} में से ${t.entered} अंक`))}
        </strong>
        <Progress value={share} max={100} tone={share < 25 ? "var(--bad)" : "var(--warn)"} height={5} />
      </span>
      {readOnly ? null : (
        <span style={{ display: "flex", gap: 8 }}>
          {onCall ? (
            t.phone ? (
              <a className="tap btn sec" href={`tel:${t.phone}`} onClick={onCall}>
                <Ic n="phone" size={16} /> {tx(p("Call", "फ़ोन"))}
              </a>
            ) : null
          ) : null}
          {onRemind ? (
            <Btn variant={t.remindedAt ? "soft" : "pri"} icon={t.remindedAt ? "checkCircle" : "send"} onClick={onRemind}>
              {t.remindedAt ? tx(p("Remind again", "फिर याद दिलाएँ")) : tx(p("Remind", "याद दिलाएँ"))}
            </Btn>
          ) : null}
        </span>
      )}
    </div>
  );
}
