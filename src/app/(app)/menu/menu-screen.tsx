"use client";

import Link from "@/ui/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { logoutAction } from "@/app/login/actions";
import { cue } from "@/ui/feedback/cue";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { DesignMenu } from "@/vx/nav";
import { greetingPair } from "@/vx/screens/teach/ui/fmt";
import { QuickSwitches, Shortcuts, usePins } from "@/vx/shell/menu-prefs";
import { openSearch } from "@/vx/shell/top-actions";
import { setViewAsAction } from "@/vx/shell/view-as-actions";
import { p, type Pair } from "@/vx/text";
import { ListenButton } from "@/vx/ui/listen";
import { Confirm } from "@/vx/ui/overlays";
import { TopBar } from "@/vx/ui/page";
import { Avatar } from "@/vx/ui/primitives";

import { pinnedTiles, settingsLinks, type MenuGroup, type MenuTile } from "./menu-items";
import "./menu.css";

export type MenuScreenProps = {
  menu: DesignMenu;
  name: string;
  initials: string;
  /** The person's approved photo, when there is one. */
  photo?: string | null;
  /** "Admin · every workspace", "Accountant". */
  sub: string;
  groups: MenuGroup[];
  /** What the phone's bottom bar already opens, so default shortcuts are something else. */
  onBar?: string[];
  /** May open the school's Settings (`settings:manage`): the big button goes there. */
  schoolSettings?: boolean;
  /** "See the app as" — the admin only (UI-12, read-only). */
  previews: { key: string; label: Pair; icon: IconName }[];
  previewing: string | null;
};

const M = {
  menu: p("Menu", "मेनू"),
  search: p("Find a student, receipt or page…", "विद्यार्थी, रसीद या पेज खोजें…"),
  settings: p("Settings", "सेटिंग्स"),
  schoolSettings: p("School settings", "स्कूल की सेटिंग्स"),
  schoolSettingsSub: p("School name, certificates, parents' messages, backups, AI", "स्कूल का नाम, प्रमाण पत्र, अभिभावक संदेश, बैकअप, AI"),
  mySettings: p("My settings", "मेरी सेटिंग्स"),
  mySettingsSub: p("Photo, language, first screen, WhatsApp", "फ़ोटो, भाषा, पहली स्क्रीन, व्हाट्सऐप"),
  mine: p("My settings", "मेरी सेटिंग्स"),
  password: p("Password", "पासवर्ड"),
  year: p("School year", "सत्र"),
  jump: p("Jump to a group", "किसी समूह पर जाएँ"),
  seeAs: p("See One as…", "One को ऐसे देखें…"),
  seeAsHint: p("What they see. Nothing changes.", "उन्हें क्या दिखता है। कुछ नहीं बदलता।"),
  signOut: p("Sign out", "साइन आउट"),
  signOutQ: p("Sign out of One?", "One से साइन आउट करें?"),
  signOutBody: p("You will need your password to come back in.", "वापस आने के लिए आपको अपना पासवर्ड चाहिए होगा।"),
  foot: p("VPPS One · staff workspace", "VPPS One · स्टाफ़ कार्यक्षेत्र"),
};

/** What Listen reads, and the part of the page each line lights (null lights nothing). */
const GUIDE: { line: Pair; part: string | null }[] = [
  { line: p("This is the Menu. Every page you can open is here.", "यह मेनू है। आप जो भी पेज खोल सकते हैं, सब यहाँ है।"), part: null },
  { line: p("At the top are your settings. One tap switches dark mode, language or sounds.", "सबसे ऊपर आपकी सेटिंग्स हैं। एक टैप से डार्क मोड, भाषा या आवाज़ बदलें।"), part: "menu-settings" },
  { line: p("These four big buttons are your shortcuts. Tap Change to choose your own.", "ये चार बड़े बटन आपके शॉर्टकट हैं। अपने चुनने के लिए ‘बदलें’ दबाएँ।"), part: "menu-shortcuts" },
  { line: p("Below, pages are in groups. Tap a group's name to jump straight to it.", "नीचे पेज समूहों में हैं। किसी समूह के नाम पर टैप करें, सीधे वहाँ पहुँचें।"), part: "menu-jump" },
  { line: p("Every button says, under its name, what it opens.", "हर बटन के नाम के नीचे लिखा है कि वह क्या खोलता है।"), part: "menu-groups" },
  { line: p("Sign out is at the very bottom.", "साइन आउट सबसे नीचे है।"), part: "menu-signout" },
];

const noSubscribe = () => () => {};

/** Minutes past midnight in the school's time, or -1 before the page is live (the server cannot know the hour). */
function schoolMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const h = Number(parts.find((x) => x.type === "hour")?.value ?? 0);
  const m = Number(parts.find((x) => x.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

function reduceMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** A label, and the Hindi under it for a reader of both. */
function Words({ label, cls }: { label: Pair; cls?: string }) {
  const { tx, sub } = useVx();
  const second = sub(label);
  return (
    <>
      <b className={cls}>{tx(label)}</b>
      {second ? <span className="vxm-l2" lang="hi">{second}</span> : null}
    </>
  );
}

/** One screen as a big tile: its icon in the group's colour, its name, and what it opens. */
function Tile({ tile, index }: { tile: MenuTile; index: number }) {
  const { tx } = useVx();
  return (
    <Link href={tile.href} className="tap lift vxm-tile" style={{ ["--i" as string]: index }}>
      <span className="vxm-ic" aria-hidden="true"><Ic n={tile.icon} size={21} /></span>
      <Words label={tile.label} />
      {tile.hint ? <span className="vxm-hint">{tx(tile.hint)}</span> : null}
    </Link>
  );
}

function GroupHead({ title, icon }: { title: Pair; icon: IconName }) {
  const { tx, sub } = useVx();
  const second = sub(title);
  return (
    <div className="vxm-gh">
      <span aria-hidden="true"><Ic n={icon} size={19} /></span>
      <h2>
        {tx(title)}
        {second ? <small lang="hi">{second}</small> : null}
      </h2>
    </div>
  );
}

function PreviewTile({ menu, label, icon, on, index }: { menu: string; label: Pair; icon: IconName; on: boolean; index: number }) {
  const { tx } = useVx();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="tap lift vxm-tile"
      aria-current={on ? "page" : undefined}
      disabled={pending}
      style={{ ["--i" as string]: index }}
      onClick={() =>
        start(async () => {
          const href = await setViewAsAction(menu);
          router.push(href);
          router.refresh();
        })
      }
    >
      <span className="vxm-ic" aria-hidden="true"><Ic n={pending ? "refresh" : icon} size={21} className={pending ? "spin" : undefined} /></span>
      <Words label={label} />
      <span className="vxm-hint">{tx(M.seeAsHint)}</span>
    </button>
  );
}

/**
 * The group chips that stay at the top while the page scrolls: a tap jumps to
 * the group, and the chip of the group in view is lit, so the long list
 * always says where in it you are.
 */
function JumpChips({ groups, extra }: { groups: { id: string; short: Pair; icon: IconName; tone: string }[]; extra?: { id: string; short: Pair; icon: IconName; tone: string } | null }) {
  const { tx } = useVx();
  const all = extra ? [...groups, extra] : groups;
  const [active, setActive] = useState<string | null>(null);
  const row = useRef<HTMLDivElement>(null);
  // The chip a tap chose. It stays lit until the reader scrolls by hand: the
  // last groups cannot reach the top of a short page, and the smooth scroll
  // passes other groups on the way (desk check, 7 Nov: Records tapped,
  // Studies lit).
  const held = useRef<string | null>(null);
  const seen = useRef(new Map<string, boolean>());
  // Where the sticky row ends: under the phone's top edge, the preview
  // banner, or the desk's top bar.
  const [band, setBand] = useState(80);
  const ids = all.map((g) => g.id).join(",");

  useEffect(() => {
    const measure = () => {
      const box = row.current;
      if (!box) return;
      const top = Number.parseFloat(getComputedStyle(box).top) || 0;
      setBand(Math.round(top + box.offsetHeight + 8));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const els = ids.split(",").map((id) => document.getElementById(`menu-${id}`)).filter((x): x is HTMLElement => Boolean(x));
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const pick = () => ids.split(",").find((id) => seen.current.get(id)) ?? null;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.current.set(e.target.id.replace(/^menu-/, ""), e.isIntersecting);
        if (!held.current) setActive(pick());
      },
      // The band just under the sticky chips: the group whose top half is there is "here".
      { rootMargin: `-${band}px 0px -55% 0px` },
    );
    els.forEach((el) => io.observe(el));
    // A hand on the page (finger, wheel, keys) lets go of the tapped chip.
    // A touch or key on the chip row itself is a tap on a chip, which holds
    // its own chip a moment later; letting go first would flicker.
    const release = (e: Event) => {
      if (!held.current || (e.target instanceof Element && e.target.closest("#menu-jump"))) return;
      held.current = null;
      setActive(pick());
    };
    const opts = { passive: true } as const;
    window.addEventListener("touchstart", release, opts);
    window.addEventListener("wheel", release, opts);
    window.addEventListener("keydown", release);
    return () => {
      io.disconnect();
      window.removeEventListener("touchstart", release);
      window.removeEventListener("wheel", release);
      window.removeEventListener("keydown", release);
    };
  }, [ids, band]);

  // Keep the lit chip in sight in the sideways row, without moving the page.
  useEffect(() => {
    const box = row.current;
    const chip = active ? box?.querySelector<HTMLElement>(`[data-g="${active}"]`) : null;
    if (!box || !chip) return;
    const left = chip.offsetLeft - 18;
    if (chip.offsetLeft < box.scrollLeft || chip.offsetLeft + chip.offsetWidth > box.scrollLeft + box.clientWidth) {
      box.scrollTo({ left: Math.max(0, left), behavior: reduceMotion() ? "auto" : "smooth" });
    }
  }, [active]);

  const go = (id: string) => {
    cue("select");
    held.current = id;
    setActive(id);
    document.getElementById(`menu-${id}`)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  };

  return (
    <nav ref={row} id="menu-jump" className="vxm-jump vx-step" aria-label={tx(M.jump)}>
      {all.map((g) => (
        <button key={g.id} type="button" data-g={g.id} data-tone={g.tone} className={`tap vxm-chip${active === g.id ? " on" : ""}`} aria-current={active === g.id ? "true" : undefined} onClick={() => go(g.id)}>
          <span aria-hidden="true"><Ic n={g.icon} size={15} /></span>
          {tx(g.short)}
        </button>
      ))}
    </nav>
  );
}

function SignOut() {
  const { tx } = useVx();
  const [ask, setAsk] = useState(false);
  const [leaving, start] = useTransition();
  return (
    <>
      <button type="button" className="tap vxm-out" onClick={() => { cue("tap"); setAsk(true); }}>
        <Ic n="logout" size={20} /> {tx(M.signOut)}
      </button>
      <Confirm
        open={ask}
        onClose={() => setAsk(false)}
        onConfirm={() => start(async () => { await logoutAction(); })}
        title={tx(M.signOutQ)}
        body={tx(M.signOutBody)}
        confirmLabel={tx(M.signOut)}
        danger
        busy={leaving}
        icon="logout"
      />
    </>
  );
}

/**
 * The phone Menu (F13-Menu, redrawn D-519 for staff who are new to apps):
 *
 * 1. Menu, with Listen, which reads out what is where and lights each part.
 * 2. Search.
 * 3. Settings, first: the person, five quick switches with their state in
 *    words, and one big button to all settings (the school's for an admin,
 *    their own for everyone else) with My settings, Password and School year.
 * 4. Their four shortcuts, with Change.
 * 5. Group chips that stay on top and jump down the page.
 * 6. Every screen they may open, as a big tile that says what it opens, in
 *    coloured groups.
 * 7. "See One as…" for the admin, then Sign out, which asks once.
 *
 * On a desk it is reached from the person at the foot of the sidebar and
 * draws the same, under a top bar.
 */
export function MenuScreen(props: MenuScreenProps) {
  const { tx } = useVx();
  const pins = usePins();
  const pinned = pinnedTiles(props.groups, pins, props.menu, props.onBar);
  const all = props.groups.flatMap((g) => g.tiles);
  // A pinned tile is not drawn a second time below: the admin's four pins were
  // the whole Daily group, so the same tiles showed twice (UX review 6 Nov 2026).
  const pinnedKeys = new Set(pinned.map((x) => x.key));
  const groups = props.groups.map((g) => ({ ...g, tiles: g.tiles.filter((x) => !pinnedKeys.has(x.key)) })).filter((g) => g.tiles.length > 0);
  const links = settingsLinks(Boolean(props.schoolSettings));
  const minutes = useSyncExternalStore(noSubscribe, schoolMinutes, () => -1);
  const [reading, setReading] = useState<string | null>(null);
  const previewGroup = props.previews.length ? { id: "seeas", short: p("See as", "ऐसे देखें"), icon: "eye" as IconName, tone: "preview" } : null;
  const chips = groups.length + (previewGroup ? 1 : 0) > 1;

  const guide = GUIDE.filter((g) => g.part !== "menu-jump" || chips);
  const lines = guide.map((g) => tx(g.line));
  const onLine = (i: number | null) => {
    const part = i === null ? null : (guide[i]?.part ?? null);
    setReading(part);
    if (part) document.getElementById(part)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
  };
  const lit = (id: string) => `vx-step${reading === id ? " reading" : ""}`;

  let n = 0;
  return (
    <>
      <div className="only-d" style={{ display: "contents" }}>
        <TopBar title={tx(M.menu)} actions={<ListenButton lines={lines} onLine={onLine} className="tap btn soft" style={{ height: 40, borderRadius: 20, padding: "0 16px" }} />} />
      </div>
      <main>
        <div className="vx-menu vxm">
          <div className="vxm-head only-m">
            <h1 className="serif">{tx(M.menu)}</h1>
            <div className="vxm-listen">
              <ListenButton lines={lines} onLine={onLine} className="tap btn soft" style={{ height: 44, borderRadius: 22, padding: "0 16px" }} />
            </div>
          </div>
          <button type="button" className="tap vxm-search" onClick={openSearch}>
            <Ic n="search" />
            <span>{tx(M.search)}</span>
          </button>

          <section id="menu-settings" aria-labelledby="menu-settings-h" className={`card vxm-set ${lit("menu-settings")}`}>
            <h2 id="menu-settings-h" className="vxm-set-h">
              <Ic n="settings" size={16} /> {tx(M.settings)}
            </h2>
            <div className="vxm-me">
              <Avatar text={props.initials} photo={props.photo} size={52} seed={props.name} />
              <span className="vxm-me-t">
                {minutes >= 0 ? <span className="vxm-greet">{tx(greetingPair(minutes))}</span> : null}
                <span className="vxm-name">{props.name}</span>
                <span className="vxm-role">{props.sub}</span>
              </span>
            </div>
            <QuickSwitches />
            <Link href={links.school ?? links.mine} className="tap vxm-go">
              <span className="vxm-go-ic" aria-hidden="true"><Ic n={links.school ? "settings" : "user"} size={22} /></span>
              <span className="vxm-go-t">
                <b>{tx(links.school ? M.schoolSettings : M.mySettings)}</b>
                <span>{tx(links.school ? M.schoolSettingsSub : M.mySettingsSub)}</span>
              </span>
              <Ic n="chevRight" size={20} />
            </Link>
            <div className={`vxm-mini${links.school ? "" : " two"}`}>
              {links.school ? (
                <Link href={links.mine} className="tap">
                  <span aria-hidden="true"><Ic n="user" size={20} /></span>
                  {tx(M.mine)}
                </Link>
              ) : null}
              <Link href={links.password} className="tap">
                <span aria-hidden="true"><Ic n="key" size={20} /></span>
                {tx(M.password)}
              </Link>
              <Link href={links.year} className="tap">
                <span aria-hidden="true"><Ic n="calendar" size={20} /></span>
                {tx(M.year)}
              </Link>
            </div>
          </section>

          {pinned.length ? (
            <section id="menu-shortcuts" className={lit("menu-shortcuts")}>
              <Shortcuts pinned={pinned} all={all} />
            </section>
          ) : null}

          {chips ? <JumpChips groups={groups} extra={previewGroup} /> : null}

          <div id="menu-groups" className={lit("menu-groups")} style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {groups.map((g) => (
              <section key={g.id} id={`menu-${g.id}`} data-tone={g.tone} className="vxm-group" aria-label={tx(g.title)}>
                <GroupHead title={g.title} icon={g.icon} />
                <div className="vxm-tiles">
                  {g.tiles.map((x) => (
                    <Tile key={x.key} tile={x} index={n++} />
                  ))}
                </div>
              </section>
            ))}
            {previewGroup ? (
              <section id="menu-seeas" data-tone="preview" className="vxm-group" aria-label={tx(M.seeAs)}>
                <GroupHead title={M.seeAs} icon="eye" />
                <div className="vxm-tiles">
                  {props.previews.map((m) => (
                    <PreviewTile key={m.key} menu={m.key} label={m.label} icon={m.icon} on={props.previewing === m.key} index={n++} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <div id="menu-signout" className={lit("menu-signout")} style={{ marginTop: 6 }}>
            <SignOut />
          </div>
          <span className="vxm-foot">{tx(M.foot)}</span>
        </div>
      </main>
    </>
  );
}
