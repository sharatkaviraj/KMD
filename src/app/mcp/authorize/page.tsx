import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { aiConnectionMessages as a } from "@/messages/setup";
import { requireStaff } from "@/platform/auth/current-staff";
import { roleLabels } from "@/platform/auth/permissions";
import type { Language } from "@/platform/i18n/language";
import { aiConnectionEligibility } from "@/modules/mcp/domain/eligibility";
import { TOOLS } from "@/modules/mcp/domain/tools";
import { PROVIDER_NAMES } from "@/modules/mcp/domain/redirects";
import { authorizationErrorUrl, consentSubject, loadAuthorization } from "@/modules/mcp/data/authorize";
import { readAiConnectionSwitch } from "@/modules/mcp/data/connections";
import { lead, under, type Pair } from "@/vx/text";
import { Btn, Card, CardHead, Pill } from "@/vx/ui/primitives";
import { VxPage } from "@/vx/ui/page";

import { approveAuthorizationAction, denyAuthorizationAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = { title: "Connect an AI assistant" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The query exactly as sent, repeats included — the validator refuses repeats, so they must survive to it. */
function queryOf(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  return query;
}

function Line({ text, language, muted }: { text: Pair; language: Language; muted?: boolean }) {
  const second = under(text, language);
  return (
    <p style={{ margin: 0, fontSize: muted ? 13 : 15, color: muted ? "var(--mut)" : undefined }}>
      {lead(text, language)}
      {second ? <span style={{ display: "block", fontSize: 12, color: "var(--mut)" }}>{second}</span> : null}
    </p>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <VxPage>
      <main style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "28px 16px 40px" }}>
        <div style={{ width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>
      </main>
    </VxPage>
  );
}

/**
 * The AI connection's consent page (plan §5.2 option B): behind the normal
 * One sign-in, which brings a signed-out visitor back here with the whole
 * query. The client and the exact redirect URI are proven before anything is
 * sent anywhere; until then an error is this page, never a redirect. Then
 * eligibility (admins first, D7; TEST for admins only, D11) and the school's
 * switch. Approve and Deny re-validate everything from the raw query.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const query = queryOf(await searchParams);
  const staff = await requireStaff(`/mcp/authorize?${query.toString()}`);
  const language = staff.language;
  const loaded = await loadAuthorization(query);

  if (loaded.kind === "unknown_host") {
    return (
      <Frame>
        <Card>
          <CardHead title={lead(a.consentTitle, language)} />
          <Line text={a.unknownHost} language={language} />
        </Card>
      </Frame>
    );
  }

  const { decision, endpoints } = loaded;
  if (decision.kind === "show_error") {
    return (
      <Frame>
        <Card>
          <CardHead title={lead(a.consentTitle, language)} />
          <div style={{ marginTop: 12 }}>
            <Line text={a.invalidRequest} language={language} />
          </div>
        </Card>
      </Frame>
    );
  }
  if (decision.kind === "redirect_error") {
    redirect(authorizationErrorUrl(decision.redirectUri, decision.error, decision.description, decision.state, endpoints));
  }

  const request = decision.request;
  const provider = PROVIDER_NAMES[request.provider];
  const host = new URL(request.redirectUri).host;
  const eligibility = aiConnectionEligibility(consentSubject(staff));
  const switchState = await readAiConnectionSwitch().catch(() => null);
  const blocked: Pair | null = !eligibility.ok
    ? eligibility.reason === "test_not_admin"
      ? a.testNotAdmin
      : a.notEligible
    : switchState?.enabled !== true
      ? a.switchedOff
      : null;
  const raw = query.toString();

  return (
    <Frame>
      <Card>
        <CardHead
          title={lead(a.wantsToRead(provider), language)}
          sub={lead(a.returnsTo(host), language)}
          badge={request.provider === "local" ? <Pill tone="warn">{lead(a.localBadge, language)}</Pill> : undefined}
        />
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <span className="sech">{lead(a.signedInAs, language)}</span>
            <p style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 600 }}>
              {staff.displayName} · {lead(roleLabels[staff.role], language)}
            </p>
          </div>

          {request.provider === "local" ? <Line text={a.localWarning} language={language} muted /> : null}

          {blocked ? (
            <Line text={blocked} language={language} />
          ) : (
            <>
              <span className="sech">{lead(a.canDo, language)}</span>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                {TOOLS.map((tool) => (
                  <li key={tool.name} style={{ fontSize: 14 }}>
                    {lead(a.tools[tool.name] ?? { en: tool.title, hi: tool.title }, language)}
                  </li>
                ))}
              </ul>
              <Line text={a.cannot} language={language} muted />
              <Line text={a.lasts} language={language} muted />
              {/* A forwarded link made in someone else's AI account would connect THEIR account to this admin's One. */}
              <div role="note" style={{ padding: "10px 12px", borderRadius: 10, background: "var(--warns)", color: "var(--warnfg)" }}>
                <Line text={a.ownAccountOnly} language={language} />
              </div>
            </>
          )}
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {blocked ? null : (
            <form action={approveAuthorizationAction}>
              <input type="hidden" name="request" value={raw} />
              <Btn type="submit" variant="pri" icon="check">{lead(a.approve, language)}</Btn>
            </form>
          )}
          <form action={denyAuthorizationAction}>
            <input type="hidden" name="request" value={raw} />
            <Btn type="submit" variant={blocked ? "pri" : "sec"}>{lead(blocked ? a.goBack : a.deny, language)}</Btn>
          </form>
        </div>
      </Card>
    </Frame>
  );
}
