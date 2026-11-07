import Link from "@/ui/link";
import { getCurrentStaff } from "@/platform/auth/current-staff";
import { waitingRequestCount } from "@/modules/certificates/data/requests";
import { getViewer } from "@/vx/view-as";
import { Ic } from "@/vx/icons";
import { lead, under } from "@/vx/text";
import { Card } from "@/vx/ui/primitives";
import { R } from "./request-text";

/**
 * On an approver's Today: how many certificates teachers are waiting for
 * (D-542), one tap from the queue. Nothing at all when none are waiting, and
 * never while the admin is previewing another role.
 */
export async function CertificateRequestsWaiting({ sessionLabel }: { sessionLabel: string }) {
  const [staff, { previewing }] = await Promise.all([getCurrentStaff(), getViewer()]);
  if (!staff || previewing) return null;
  const count = await waitingRequestCount(staff, sessionLabel);
  if (!count) return null;
  const title = R.waitingCount(count);
  const language = staff.language;
  return <Card as="section" aria-label={lead(title, language)} style={{ minWidth: 0 }}>
    <Link href="/school-office#requests" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 52, color: "var(--fg)" }}>
      <span style={{ flex: "none", width: 42, height: 42, borderRadius: 13, background: "var(--warns)", color: "var(--warnfg)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Ic n="award" size={20} /></span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <strong style={{ fontSize: 15 }}>{lead(title, language)}</strong>
        {under(title, language) ? <span lang="hi" style={{ fontSize: 12, color: "var(--mut)" }}>{under(title, language)}</span> : null}
        <span style={{ fontSize: 13, color: "var(--pri)", fontWeight: 600 }}>{lead(R.waitingAction, language)}</span>
      </span>
      <Ic n="chevRight" />
    </Link>
  </Card>;
}
