import type { Language } from "@/platform/i18n/language";
import { Ic } from "@/vx/icons";
import { lead, p, type Pair } from "@/vx/text";
import { Avatar, Btn } from "@/vx/ui/primitives";

/*
 * P11 state `denied` (design `Auth` · denied): a page this role does not
 * open. It names who *can* open it, with a way to reach them, because the
 * useful next step is the one the staff member takes with a person. No hooks
 * and no database, so the route page and the design fixture draw the same
 * thing.
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
  only: (roles: string) => p(`Only ${roles} can open this page`, `यह पेज सिर्फ़ ${roles} खोल सकते हैं`),
  nobody: p("Your role cannot open this page", "आपकी भूमिका यह पेज नहीं खोल सकती"),
  signedInAs: p("You are signed in as", "आप साइन इन हैं:"),
  why: p("If you need it for your work, ask one of the people below to give your account access.", "काम के लिए चाहिए तो नीचे दिए किसी व्यक्ति से अपने खाते के लिए अनुमति माँगें।"),
  whyNoPeople: p("If you need it for your work, ask the administrator to give your account access.", "काम के लिए चाहिए तो प्रशासक से अपने खाते के लिए अनुमति माँगें।"),
  request: p("Request access", "अनुमति माँगें"),
  home: p("Go to my Home", "मेरे होम पर जाएँ"),
  needs: p("This page needs", "इस पेज के लिए चाहिए"),
  call: (name: string) => p(`Call ${name}`, `${name} को फ़ोन करें`),
};

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
  permission: string | null;
  home: string;
  /** A wa.me link to the first person who can grant access, typed by the reader; never sent by the app. */
  requestHref: string | null;
}) {
  const names = roles.map((r) => lead(r, language));
  const joined = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} ${language === "hi" ? "और" : "and"} ${names[names.length - 1]}`;
  const title = names.length ? T.only(joined) : T.nobody;
  return (
    <div className="card col rise" style={{ maxWidth: 560, width: "100%", margin: "24px auto 0", padding: "30px 26px", display: "flex", flexDirection: "column", gap: 14, alignItems: "center", textAlign: "center" }}>
      <span aria-hidden="true" style={{ width: 72, height: 72, borderRadius: 36, background: "var(--warns)", color: "var(--warnfg)", display: "flex", alignItems: "center", justifyContent: "center", animation: "xPopIn .5s var(--spring) both" }}>
        <Ic n="shield" size={32} />
      </span>
      <h1 className="serif" style={{ margin: 0, fontSize: 24, fontWeight: 600, lineHeight: 1.45 }}>{lead(title, language)}</h1>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--mut)" }}>
        {lead(T.signedInAs, language)} <b style={{ color: "var(--fg)" }}>{me.name} · {lead(me.role, language)}</b>. {lead(people.length ? T.why : T.whyNoPeople, language)}
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
                  <a href={person.callHref} className="tap btn soft" aria-label={lead(T.call(person.name), language)} style={{ width: 40, padding: 0, color: "var(--accfg)" }}>
                    <Ic n="phone" size={18} />
                  </a>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="g2" style={{ width: "100%", display: "grid", gridTemplateColumns: requestHref ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)", gap: 8 }}>
        {requestHref ? (
          <a href={requestHref} target="_blank" rel="noreferrer" className="tap btn pri" style={{ height: 46 }}>
            <Ic n="send" size={18} />
            {lead(T.request, language)}
          </a>
        ) : null}
        <Btn variant={requestHref ? "sec" : "pri"} href={home} style={{ height: 46 }}>{lead(T.home, language)}</Btn>
      </div>
      {permission ? (
        <span style={{ fontSize: 12, color: "var(--sub)" }}>
          {lead(T.needs, language)} <code style={{ fontSize: 12, overflowWrap: "anywhere" }}>{permission}</code>
        </span>
      ) : null}
    </div>
  );
}
