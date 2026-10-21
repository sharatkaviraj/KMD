import type { Language } from "@/platform/i18n/language";
import { Ic } from "@/vx/icons";
import { lead, p, type Pair } from "@/vx/text";
import { Avatar, Btn } from "@/vx/ui/primitives";

import { permissionArea } from "./logic";

/*
 * P11 state `denied` (design `Auth` · denied): a page this reader does not
 * open. It says what the page is for and who can open it, with a way to
 * reach them, because the useful next step is the one the staff member takes
 * with a person. No hooks and no database, so the route page and the design
 * fixture draw the same thing.
 *
 * Smoke 20 Oct (dev.groups[16]): an Admin whose account had Settings turned
 * off (a Smoke Lab seat, D-314) read "Only Admin can open this page", and
 * every reader saw the raw permission code. When the reader's own role is
 * among those that open the page, the page is off for this *account*, and it
 * says so; the code is never shown.
 */

export type DeniedPerson = {
  id: string;
  initials: string;
  name: string;
  role: Pair;
  /** Masked for show ("98290 ••512"); null when this reader does not see staff numbers. */
  phoneShown: string | null;
  /** `tel:` — only when the number is visible to this reader. */
  callHref: string | null;
};

const TONES = [
  { bg: "var(--accs)", fg: "var(--accfg)" },
  { bg: "var(--oks)", fg: "var(--ok)" },
  { bg: "var(--infos)", fg: "var(--info)" },
];

const T = {
  forRoles: (roles: Pair) => p(`This page is for ${roles.en}`, `यह पेज ${roles.hi ?? roles.en} के लिए है`),
  account: p("This account is not allowed to open this page", "यह खाता यह पेज नहीं खोल सकता"),
  area: (area: Pair) => p(`It is the page for ${area.en}.`, `यह ${area.hi ?? area.en} का पेज है।`),
  signedInAs: p("You are signed in as", "आप साइन इन हैं:"),
  turnedOff: p(
    "Your role usually opens it, but it is turned off for this account. If you need it, ask the administrator.",
    "आपकी भूमिका में यह आमतौर पर खुलता है, पर इस खाते के लिए बंद है। ज़रूरत हो तो प्रशासक से पूछें।",
  ),
  why: p("If your work needs it, ask one of the people below.", "काम के लिए ज़रूरत हो तो नीचे दिए किसी व्यक्ति से पूछें।"),
  whyNoPeople: p("If your work needs it, ask the administrator.", "काम के लिए ज़रूरत हो तो प्रशासक से पूछें।"),
  request: p("Ask for access", "अनुमति माँगें"),
  home: p("Go to my Home", "मेरे होम पर जाएँ"),
  call: (name: string) => p(`Call ${name}`, `${name} को फ़ोन करें`),
};

/** "Admin, Accountant and Fee Collector" in each language. */
function joinRoles(roles: Pair[]): Pair {
  const join = (names: string[], and: string) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`);
  return { en: join(roles.map((r) => r.en), "and"), hi: join(roles.map((r) => r.hi ?? r.en), "और") };
}

/** Which title and sentence the screen says. Pure, for tests. */
export function deniedWords({ me, roles, permission, hasPeople }: { me: { role: Pair }; roles: Pair[]; permission: string | null; hasPeople: boolean }): { title: Pair; area: Pair | null; body: Pair } {
  const area = permissionArea(permission);
  const ownRole = roles.some((r) => r.en === me.role.en);
  const title = ownRole || roles.length === 0 ? T.account : T.forRoles(joinRoles(roles));
  const body = ownRole ? T.turnedOff : hasPeople ? T.why : T.whyNoPeople;
  return { title, area: area ? T.area(area) : null, body };
}

export function DeniedScreen({
  language,
  me,
  roles,
  people,
  permission,
  home,
  requestHref,
}: {
  language: Language;
  /** "Name · Role" of the reader. */
  me: { name: string; role: Pair };
  /** The roles that hold the permission, as labels. */
  roles: Pair[];
  people: DeniedPerson[];
  /** Only to say what the page is for; the code itself is never shown. */
  permission: string | null;
  home: string;
  /** A wa.me link to the first person who can grant access, typed by the reader; never sent by the app. */
  requestHref: string | null;
}) {
  const words = deniedWords({ me, roles, permission, hasPeople: people.length > 0 });
  return (
    <div className="card col rise" style={{ maxWidth: 560, width: "100%", margin: "24px auto 0", padding: "30px 26px", display: "flex", flexDirection: "column", gap: 14, alignItems: "center", textAlign: "center" }}>
      <span aria-hidden="true" style={{ width: 72, height: 72, borderRadius: 36, background: "var(--warns)", color: "var(--warnfg)", display: "flex", alignItems: "center", justifyContent: "center", animation: "xPopIn .5s var(--spring) both" }}>
        <Ic n="shield" size={32} />
      </span>
      <h1 className="serif" style={{ margin: 0, fontSize: 24, fontWeight: 600, lineHeight: 1.45 }}>{lead(words.title, language)}</h1>
      {words.area ? <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>{lead(words.area, language)}</p> : null}
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--mut)" }}>
        {lead(T.signedInAs, language)} <b style={{ color: "var(--fg)" }}>{me.name} · {lead(me.role, language)}</b>. {lead(words.body, language)}
      </p>
      {people.length ? (
        <div style={{ width: "100%", border: "1px solid var(--bd)", borderRadius: 16, textAlign: "left" }}>
          {people.map((person, i) => {
            const tone = TONES[i % TONES.length];
            return (
              <div key={person.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
                <Avatar text={person.initials} size={38} bg={tone.bg} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{person.name}</span>
                  <span className="num clip" style={{ fontSize: 12, color: "var(--mut)" }}>{[lead(person.role, language), person.phoneShown].filter(Boolean).join(" · ")}</span>
                </span>
                {person.callHref ? (
                  <a href={person.callHref} className="tap btn soft" aria-label={lead(T.call(person.name), language)} style={{ width: 44, height: 44, padding: 0, color: "var(--accfg)" }}>
                    <Ic n="phone" size={18} />
                  </a>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="g2" style={{ width: "100%", display: "grid", gridTemplateColumns: requestHref ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)", gap: 8 }}>
        <Btn variant="pri" href={home} style={{ height: 46 }}>{lead(T.home, language)}</Btn>
        {requestHref ? (
          <a href={requestHref} target="_blank" rel="noreferrer" className="tap btn sec" style={{ height: 46 }}>
            <Ic n="send" size={18} />
            {lead(T.request, language)}
          </a>
        ) : null}
      </div>
    </div>
  );
}
