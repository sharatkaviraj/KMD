import { p, type Pair } from "@/vx/text";

import { clockP, dayP, istIso, minutesOf } from "./format";
import type { DoneItem, NeedItem } from "./types";
import { NW } from "./words";

/**
 * The fee office's, the exam office's and the admin's jobs (D-630), each read
 * from the screen that already owns them. Pure mappers: the loaders in
 * `../data` hand them what those screens load.
 */

const base = (item: Omit<NeedItem, "lateMinutes" | "startsInMinutes" | "peopleWaiting" | "count" | "canSnooze"> & Partial<NeedItem>): NeedItem => ({
  lateMinutes: 0,
  startsInMinutes: null,
  peopleWaiting: 0,
  count: 1,
  canSnooze: item.lane !== "waiting",
  ...item,
});

/* ------------------------------------------------------------- fee office */

/** The counter closes its day by 5:30 pm; from 4:30 it is a "do now". */
const CLOSE_BY = 17 * 60 + 30;
const CLOSE_SOON = 16 * 60 + 30;

export type CounterFacts = {
  today: string;
  nowMinutes: number;
  /** The clock the page was drawn on (a lab seat's set time, D-269). */
  now: Date;
  canCollect: boolean;
  canAccounts: boolean;
  queue: readonly { id: string; arrivedAt: string }[];
  followUpsToday: { count: number; kept: number };
  chequesToDeposit: { count: number };
  upiOpen: { count: number };
  requests: readonly { id: string; title: string; mine: boolean; status: string; requestedAt: string; source?: string }[];
  closure: { status: string; closedAt: string | null } | null;
};

export function counterNeeds(f: CounterFacts): { items: NeedItem[]; done: DoneItem[] } {
  const items: NeedItem[] = [];
  const done: DoneItem[] = [];
  const { today, nowMinutes } = f;

  if (f.canCollect && f.queue.length) {
    const n = f.queue.length;
    const first = [...f.queue].sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt))[0];
    const waited = Math.max(0, Math.round((f.now.getTime() - Date.parse(first.arrivedAt)) / 60_000));
    items.push(
      base({
        key: `counter:${today}`,
        kind: "counter",
        title: p(n === 1 ? "1 family at the counter" : `${n} families at the counter`, `काउंटर पर ${n} परिवार`),
        why: Number.isFinite(waited) && waited > 0 ? p(`The first has waited ${waited} min`, `पहला परिवार ${waited} मिनट से रुका है`) : null,
        lane: "now",
        dueAt: null,
        peopleWaiting: n,
        count: n,
        effort: "medium",
        href: "/payments",
        act: p("Open the counter", "काउंटर खोलें"),
      }),
    );
  }

  const calls = Math.max(0, f.followUpsToday.count - f.followUpsToday.kept);
  if (calls > 0) {
    items.push(
      base({
        key: `calls:${today}`,
        kind: "calls",
        title: p(calls === 1 ? "1 call-back for today" : `${calls} call-backs for today`, `आज ${calls} कॉल करने हैं`),
        why: p("Families you said you would call", "जिन परिवारों को फ़ोन करना तय था"),
        lane: "today",
        dueAt: istIso(today, CLOSE_SOON),
        count: calls,
        effort: calls > 10 ? "long" : "medium",
        href: "/dues",
        act: p("Start calling", "कॉल शुरू करें"),
      }),
    );
  }

  if (f.canAccounts && f.chequesToDeposit.count > 0) {
    const n = f.chequesToDeposit.count;
    items.push(
      base({
        key: `cheques:${today}`,
        kind: "cheques",
        title: p(n === 1 ? "Put 1 cheque in the bank bag" : `Put ${n} cheques in the bank bag`, `${n} चेक बैंक थैले में रखें`),
        why: p("Cheques taken and not yet sent to the bank", "लिए गए चेक, बैंक नहीं भेजे"),
        lane: "today",
        dueAt: istIso(today, CLOSE_BY),
        count: n,
        effort: "medium",
        href: "/accounts/books",
        act: p("Open cheques", "चेक खोलें"),
      }),
    );
  }

  if (f.canAccounts && f.upiOpen.count > 0) {
    const n = f.upiOpen.count;
    items.push(
      base({
        key: `upi:${today}`,
        kind: "upi",
        title: p(n === 1 ? "Match 1 UPI payment" : `Match ${n} UPI payments`, `${n} UPI भुगतान मिलाएँ`),
        why: p("Bank lines without a receipt yet", "बैंक की पंक्तियाँ, जिनकी रसीद नहीं मिली"),
        lane: "today",
        dueAt: istIso(today, CLOSE_BY),
        count: n,
        effort: n > 5 ? "long" : "medium",
        href: "/accounts/books?view=upi",
        act: p("Match UPI", "UPI मिलाएँ"),
      }),
    );
  }

  for (const r of f.requests) {
    if (!r.mine || r.source === "desk" || (r.status !== "waiting" && r.status !== "seen")) continue;
    items.push(
      base({
        key: `request:${r.id}`,
        kind: "request",
        title: p(r.title),
        why: r.status === "seen" ? p("The admin has seen it", "प्रशासक ने देख लिया है") : p("Sent to the admin", "प्रशासक को भेजा"),
        lane: "waiting",
        dueAt: r.requestedAt,
        effort: "quick",
        href: "/accounts/books?view=requests",
        act: p("See", "देखें"),
        waitingOn: NW.admin,
      }),
    );
  }

  if (f.canAccounts) {
    if (f.closure?.status === "closed") {
      done.push({ key: `close:${today}`, kind: "close", title: p("Day closed", "दिन बंद किया"), at: f.closure.closedAt });
    } else {
      const late = Math.max(0, nowMinutes - CLOSE_BY);
      items.push(
        base({
          key: `close:${today}`,
          kind: "close",
          title: p("Close the day", "दिन बंद करें"),
          why: p(`Count the cash and close by ${clockP(istIso(today, CLOSE_BY)).en}`, `नकद गिनें और ${clockP(istIso(today, CLOSE_BY)).hi} तक दिन बंद करें`),
          lane: nowMinutes >= CLOSE_SOON ? "now" : "today",
          dueAt: istIso(today, CLOSE_BY),
          lateMinutes: late,
          effort: "medium",
          href: "/receipts",
          act: p("Close the day", "दिन बंद करें"),
        }),
      );
    }
  }
  return { items, done };
}

/** The fee office in the real year, where money lives in Fees: promises made for today. */
export function promiseNeeds(today: string, promisesToday: number): NeedItem[] {
  if (promisesToday <= 0) return [];
  return [
    base({
      key: `promise:${today}`,
      kind: "promise",
      title: p(
        promisesToday === 1 ? "1 family promised to pay today" : `${promisesToday} families promised to pay today`,
        `आज ${promisesToday} परिवारों ने फीस देने का वादा किया`,
      ),
      why: p("Check who came, and call the rest", "देखें कौन आया, बाकी को फ़ोन करें"),
      lane: "today",
      dueAt: istIso(today, CLOSE_SOON),
      count: promisesToday,
      effort: promisesToday > 10 ? "long" : "medium",
      href: "/dues?tab=prom",
      act: p("See promises", "वादे देखें"),
    }),
  ];
}

/* ------------------------------------------------------------ exam office */

export type ExamStepKey = "created" | "datesheet" | "parents" | "seating" | "duties" | "papers" | "admit";

const STEP: Record<ExamStepKey, { title: Pair; href: (examId: string) => string }> = {
  created: { title: p("Exam created", "परीक्षा बनी"), href: () => "/calendar" },
  datesheet: { title: p("Make the date sheet", "डेट शीट बनाएँ"), href: (id) => `/exam-office/plan?exam=${id}` },
  parents: { title: p("Tell parents the dates", "अभिभावकों को तिथियाँ बताएँ"), href: (id) => `/exam-office/plan?exam=${id}&view=publish` },
  seating: { title: p("Plan the seating", "बैठक व्यवस्था बनाएँ"), href: (id) => `/exam-office/plan?exam=${id}&view=seating` },
  duties: { title: p("Give invigilation duties", "निरीक्षण ड्यूटी लगाएँ"), href: (id) => `/exam-office/plan?exam=${id}&view=duties` },
  papers: { title: p("Collect question papers", "प्रश्न पत्र इकट्ठे करें"), href: (id) => `/exam-office/plan?exam=${id}&view=papers` },
  admit: { title: p("Print admit slips", "प्रवेश पर्ची छापें"), href: (id) => `/exam-office/plan?exam=${id}&view=seating` },
};

export type ExamFacts = {
  today: string;
  nowMinutes: number;
  /** The exam whose marks are being entered, or none. */
  results: {
    id: string;
    name: Pair;
    lateCount: number;
    entered: number;
    total: number;
    marksDueOn: string | null;
    resultsOn: string | null;
    published: boolean;
  } | null;
  /** The next exam to set up, with its steps. */
  next: {
    id: string;
    name: Pair;
    steps: readonly { key: ExamStepKey; state: "todo" | "doing" | "done"; dueOn: string | null; owner: "you" | "teachers" | "office"; progress: string | null }[];
  } | null;
};

export function examNeeds(f: ExamFacts): { items: NeedItem[]; done: DoneItem[] } {
  const items: NeedItem[] = [];
  const done: DoneItem[] = [];
  const { today } = f;
  const r = f.results;
  if (r) {
    const name = r.name;
    if (r.lateCount > 0) {
      const due = r.marksDueOn;
      items.push(
        base({
          key: `exam-late:${r.id}`,
          kind: "exam_marks",
          title: p(
            r.lateCount === 1 ? `Remind 1 teacher · ${name.en}` : `Remind ${r.lateCount} teachers · ${name.en}`,
            `${r.lateCount} शिक्षकों को याद दिलाएँ · ${name.hi ?? name.en}`,
          ),
          why: p(`${r.entered} of ${r.total} marks in${due ? ` · due ${dayP(due).en}` : ""}`, `${r.total} में से ${r.entered} अंक आए${due ? ` · ${dayP(due).hi} तक` : ""}`),
          lane: due && due < today ? "now" : "today",
          dueAt: due ? istIso(due, 17 * 60) : null,
          lateMinutes: due && due < today ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 60_000) : 0,
          count: r.lateCount,
          effort: "medium",
          href: "/exam-office?view=remind",
          act: p("Remind teachers", "शिक्षकों को याद दिलाएँ"),
        }),
      );
    }
    if (!r.published && r.total > 0 && r.entered >= r.total) {
      items.push(
        base({
          key: `results:${r.id}`,
          kind: "results",
          title: p(`Publish results · ${name.en}`, `परिणाम जारी करें · ${name.hi ?? name.en}`),
          why: r.resultsOn ? p(`All marks are in · results day ${dayP(r.resultsOn).en}`, `सारे अंक आ गए · परिणाम ${dayP(r.resultsOn).hi}`) : p("All marks are in", "सारे अंक आ गए"),
          lane: r.resultsOn && r.resultsOn > today ? "later" : "today",
          dueAt: r.resultsOn ? istIso(r.resultsOn, 10 * 60) : null,
          effort: "long",
          href: "/exam-office/results",
          act: p("Open results", "परिणाम खोलें"),
        }),
      );
    }
  }
  const n = f.next;
  if (n) {
    for (const s of n.steps) {
      if (s.key === "created") continue;
      const key = `exam-step:${n.id}:${s.key}`;
      const words = STEP[s.key];
      if (s.state === "done") continue;
      const lane = s.owner !== "you" ? "waiting" : !s.dueOn ? "later" : s.dueOn < today ? "now" : s.dueOn <= today ? "today" : "later";
      items.push(
        base({
          key,
          kind: "exam_step",
          title: p(`${words.title.en} · ${n.name.en}`, `${words.title.hi ?? words.title.en} · ${n.name.hi ?? n.name.en}`),
          why: s.dueOn ? p(`Due ${dayP(s.dueOn).en}${s.progress ? ` · ${s.progress}` : ""}`, `${dayP(s.dueOn).hi} तक${s.progress ? ` · ${s.progress}` : ""}`) : null,
          lane,
          dueAt: s.dueOn ? istIso(s.dueOn, 17 * 60) : null,
          lateMinutes: s.dueOn && s.dueOn < today ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${s.dueOn}T00:00:00Z`)) / 60_000) : 0,
          effort: "long",
          href: words.href(n.id),
          act: p("Open", "खोलें"),
          waitingOn: s.owner === "teachers" ? NW.teachers : s.owner === "office" ? NW.office : null,
        }),
      );
    }
  }
  return { items, done };
}

/* ------------------------------------------------------------------ admin */

export type AdminInboxFacts = readonly {
  id: string;
  kind: "not_marked" | "cover" | "submission" | "confirmations" | "refund" | "job" | "leave" | "parent";
  at: string | null;
  urgent: boolean;
  title: Pair;
  href?: string;
  classIds?: string[];
  day?: string;
}[];

const ADMIN_KIND: Record<AdminInboxFacts[number]["kind"], NeedItem["kind"]> = {
  not_marked: "attendance",
  cover: "cover",
  submission: "request",
  confirmations: "request",
  refund: "refund",
  job: "job",
  leave: "leave",
  parent: "parent",
};

/**
 * The admin's queue as jobs, only so the AI can order it: the inbox keeps
 * drawing its own cards. An urgent card is Do now; the rest is Today.
 */
export function adminNeeds(inbox: AdminInboxFacts, now: Date, nowMinutes: number, bells: readonly { starts: string }[] = []): NeedItem[] {
  const firstBell = bells.map((b) => minutesOf(b.starts)).filter((m): m is number => m !== null).sort((a, b) => a - b)[0] ?? null;
  return inbox.map((i) => {
    const kind = ADMIN_KIND[i.kind];
    const since = i.at ? Date.parse(i.at) : NaN;
    const waitingSince = Number.isNaN(since) ? 0 : Math.max(0, Math.round((now.getTime() - since) / 60_000));
    return base({
      key: `inbox:${i.id}`,
      kind,
      title: i.title,
      why: null,
      lane: i.urgent ? "now" : "today",
      dueAt: i.at,
      // A class with no register by the first bell holds up the day.
      lateMinutes: i.kind === "not_marked" && firstBell !== null ? Math.max(0, nowMinutes - firstBell) : i.urgent ? Math.max(1, Math.min(waitingSince, 24 * 60)) : 0,
      peopleWaiting: i.kind === "parent" || i.kind === "leave" || i.kind === "submission" || i.kind === "confirmations" || i.kind === "refund" ? 1 : 0,
      count: i.classIds?.length || 1,
      effort: i.kind === "job" || i.kind === "parent" || i.kind === "leave" ? "quick" : "medium",
      href: i.href ?? `/inbox?item=${encodeURIComponent(i.id)}`,
      act: p("Open", "खोलें"),
      canSnooze: false,
    });
  });
}
