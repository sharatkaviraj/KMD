import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { getFeeSetupVxData } from "@/modules/fees/vx/fee-setup-data";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { schoolToday } from "@/vx/format";
import { FeeSetup, type FeeSetupView } from "@/vx/screens/fee-setup/fee-setup";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

const VIEWS: FeeSetupView[] = ["structure", "edit", "copy", "installments", "discounts", "rule", "latefee", "transport", "route", "review", "history"];
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "");

/**
 * Fee setup: the yearly fee by class, installments and their dates, discount
 * rules, the late fee (kept apart) and bus routes, edited as a draft and
 * published through the existing fee-setup action's preview-then-apply.
 * The admin (`fees:manage`) edits; the accountant reads and can ask.
 */
export default async function FeeSetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("fees:view", "/fee-setup");
  const { previewing } = await getViewer();
  const sp = await searchParams;
  const session = await resolveViewSession({ searchParamSession: sp.session, cookieSession: await getViewSessionCookie() });
  const data = await getFeeSetupVxData(session.sessionLabel);
  const asked = one(sp.view) as FeeSetupView;
  const canEdit = can(staff, "fees:manage");
  // Edit-only states open read-only for a viewer; review needs something to publish, so it falls back to the table.
  const view: FeeSetupView = VIEWS.includes(asked) ? (!canEdit && (asked === "copy" || asked === "rule" || asked === "review") ? "structure" : asked) : "structure";
  return (
    <FeeSetup
      key={`${data.sessionLabel}:${data.updatedAt ?? ""}:${data.history[0]?.id ?? ""}`}
      data={data}
      today={schoolToday()}
      initialView={view}
      initialClass={one(sp.class) || null}
      initialRoute={one(sp.route) || null}
      canEdit={canEdit}
      readOnly={Boolean(previewing)}
    />
  );
}
