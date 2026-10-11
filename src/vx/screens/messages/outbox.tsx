"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  approveCalendarNoticeAction,
  declineCalendarNoticeAction,
  prepareReminderBatchAction,
  sendByHandAction,
  undoSentAction,
  type OutboxResult,
} from "@/app/(app)/messages/outbox-actions";
import { agoP, clock, dateLabel } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { SearchBox } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { Banner, Section } from "@/vx/ui/page";
import { Btn, Card, CardHead, EmptyState, Pill, SecHead } from "@/vx/ui/primitives";

import { UNDO_MINUTES } from "./domain/outbox";
import type { OutboxData, OutboxItem } from "./outbox-data";

/*
 * Messages → To send. Each row opens the person's own WhatsApp with the text
 * filled in and is marked sent by them; nothing is sent by the app (D-10).
 * The number reaches the browser only inside the link, after the tap.
 */

const AUDIENCE = { parents: p("Parents", "अभिभावक"), staff: p("Staff", "स्टाफ़"), both: p("Parents and staff", "अभिभावक और स्टाफ़") } as const;
const TEMPLATE = { gentle: p("Gentle reminder", "विनम्र याद"), final: p("Firm reminder", "सख़्त याद"), upcoming: p("Coming up", "आने वाली किस्त") } as const;

export function Outbox({ data, tabs }: { data: OutboxData; tabs: React.ReactNode }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const after = (result: OutboxResult) => {
    toast.show({ text: tx(result.message), tone: result.ok ? "ok" : "bad" });
    if (result.ok) router.refresh();
  };

  const send = (item: OutboxItem) => {
    // Open the tab inside the tap, so a phone does not block it as a pop-up;
    // the link is filled in once the server has marked the row sent.
    const win = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
    setBusy(item.id);
    start(async () => {
      const result = await sendByHandAction({ source: item.source, id: item.id });
      setBusy(null);
      if (result.ok && result.link) {
        if (win) win.location.href = result.link;
        else window.location.href = result.link;
      } else win?.close();
      after(result);
    });
  };

  const run = (key: string, action: () => Promise<OutboxResult>) => {
    setBusy(key);
    start(async () => {
      const result = await action();
      setBusy(null);
      after(result);
    });
  };

  const q = query.trim().toLowerCase();
  const shown = data.items.filter((i) => !q || `${i.name} ${i.about} ${i.group} ${i.phone}`.toLowerCase().includes(q));
  const groups = new Map<string, OutboxItem[]>();
  for (const item of shown) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  const waiting = data.items.filter((i) => i.status === "queued").length;

  return (
    <Section>
      <div className="only-m">{tabs}</div>
      <Banner tone="info">
        {tx(
          p(
            `Tap Send to open WhatsApp with the message filled in, then press send there. The row is marked sent by you; Undo works for ${UNDO_MINUTES} minutes. Nothing is sent by the app.`,
            `भेजें दबाएँ — व्हाट्सऐप संदेश के साथ खुलेगा, वहाँ भेजें दबाएँ। यह आपके नाम से भेजा दर्ज होगा; ${UNDO_MINUTES} मिनट तक वापस कर सकते हैं। ऐप खुद कुछ नहीं भेजता।`,
          ),
        )}
      </Banner>

      {data.notices.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SecHead>{tx(p("Notices waiting for approval", "मंज़ूरी की प्रतीक्षा में सूचनाएँ"))}</SecHead>
          {data.notices.map((n) => (
            <Card key={n.id}>
              <CardHead
                title={n.title}
                sub={`${tx(AUDIENCE[n.audience as keyof typeof AUDIENCE] ?? AUDIENCE.parents)} · ${n.recipients} · ${n.by} · ${tx(agoP(n.at))}`}
              />
              <div style={{ whiteSpace: "pre-wrap", fontSize: 14, margin: "10px 0", color: "var(--mut)" }}>{n.textHi && n.textHi !== n.textEn ? `${n.textHi}\n\n${n.textEn}` : n.textEn}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Btn variant="pri" icon="check" disabled={pending} onClick={() => run(n.id, () => approveCalendarNoticeAction(n.id))}>
                  {busy === n.id ? tx(p("Preparing…", "तैयार हो रहा है…")) : tx(p("Approve · make the messages", "मंज़ूर करें · संदेश बनाएँ"))}
                </Btn>
                <Btn variant="ghost" icon="x" disabled={pending} onClick={() => run(`d${n.id}`, () => declineCalendarNoticeAction(n.id))}>
                  {tx(p("Don't send", "न भेजें"))}
                </Btn>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {data.batches.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SecHead>{tx(p("Fee reminders to prepare", "तैयार करने को फीस रिमाइंडर"))}</SecHead>
          {data.batches.map((b) => (
            <Card key={b.id}>
              <CardHead
                title={`${tx(TEMPLATE[b.template as keyof typeof TEMPLATE] ?? TEMPLATE.gentle)} · ${b.audienceLine || b.name}`}
                sub={`${b.families} ${tx(p("families", "परिवार"))} · ${b.by} · ${tx(agoP(b.at))}${b.scheduledFor ? ` · ${tx(p("for", "के लिए"))} ${dateLabel(b.scheduledFor)} ${clock(b.scheduledFor)}` : ""}`}
              />
              <p style={{ fontSize: 13, color: "var(--mut)", margin: "8px 0" }}>
                {tx(p("Each family's amount is worked out again now, so a family that has paid since is left out. Late fee is never included.", "हर परिवार की राशि अभी फिर से निकाली जाएगी; जिसने भर दिया वह छूट जाएगा। विलंब शुल्क शामिल नहीं।"))}
              </p>
              <Btn variant="pri" icon="send" disabled={pending} onClick={() => run(b.id, () => prepareReminderBatchAction(b.id))}>
                {busy === b.id ? tx(p("Preparing…", "तैयार हो रहा है…")) : tx(p("Prepare the messages", "संदेश तैयार करें"))}
              </Btn>
            </Card>
          ))}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <SecHead style={{ flex: 1 }}>{tx(p(`To send · ${waiting}${data.more ? `+${data.more}` : ""}`, `भेजने को · ${waiting}${data.more ? `+${data.more}` : ""}`))}</SecHead>
        <SearchBox value={query} onChange={setQuery} placeholder={tx(p("Search name or class", "नाम खोजें"))} style={{ width: 260 }} />
      </div>

      {data.items.length === 0 ? (
        <EmptyState icon="send" title={tx(p("Nothing to send", "भेजने को कुछ नहीं"))} body={tx(p("Notices, fee reminders and teachers' messages to parents appear here once they are ready.", "सूचनाएँ, फीस रिमाइंडर और शिक्षकों के संदेश तैयार होने पर यहाँ दिखेंगे।"))} />
      ) : null}

      {[...groups.entries()].map(([group, rows]) => (
        <div key={group} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SecHead action={<span style={{ fontSize: 12, color: "var(--mut)" }}>{rows.filter((r) => r.status === "queued").length}</span>}>{group}</SecHead>
          <Card pad={false} style={{ overflow: "hidden" }}>
            {rows.map((item, i) => (
              <div key={`${item.source}${item.id}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: i ? "1px solid var(--bd)" : undefined }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {item.name}
                    {item.about ? <span style={{ color: "var(--mut)", fontWeight: 400 }}> · {item.about}</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--mut)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={item.preview}>
                    {item.phone} · {item.preview.split("\n").find((l) => l.trim()) ?? ""}
                  </div>
                </div>
                {item.status === "sent" ? (
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <Pill tone="ok" icon="check">{tx(p("Sent", "भेजा"))}</Pill>
                    {item.canUndo ? (
                      <Btn variant="ghost" icon="undo" disabled={pending} onClick={() => run(`u${item.id}`, () => undoSentAction({ source: item.source, id: item.id }))}>
                        {tx(p("Undo", "वापस"))}
                      </Btn>
                    ) : null}
                  </span>
                ) : item.blocked ? (
                  <Pill tone="warn" icon="alert">{tx(p("No usable number", "नंबर नहीं"))}</Pill>
                ) : (
                  <Btn variant="pri" icon="send" disabled={pending} onClick={() => send(item)}>
                    {busy === item.id ? "…" : tx(p("Send", "भेजें"))}
                  </Btn>
                )}
              </div>
            ))}
          </Card>
        </div>
      ))}
      {data.more ? <p style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p(`${data.more} more are waiting; they show as these are sent.`, `${data.more} और प्रतीक्षा में; ये भेजने के बाद दिखेंगे।`))}</p> : null}
    </Section>
  );
}
