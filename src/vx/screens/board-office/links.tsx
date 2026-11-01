import { can } from "@/platform/auth/permissions";
import { getCurrentStaff } from "@/platform/auth/current-staff";
import { loadBoardDeadlines } from "@/modules/official-results/data/repo";
import { lead } from "@/vx/text";
import { Btn, Card } from "@/vx/ui/primitives";
import { B } from "./text";

/** Drop into Exam Office or the School Office register; respects real account permissions. */
export async function BoardOfficeLinks() {
 const staff = await getCurrentStaff(); if (!staff || !can(staff, "outcomes:view")) return null;
 return <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><Btn href="/exam-office/board" icon="clipboard">{lead(B.board, staff.language)}</Btn><Btn href="/exam-office/official-results" icon="fileText">{lead(B.results, staff.language)}</Btn></div>;
}
/** Calendar reads the cycle store and links back to its only editor. */
export async function BoardDeadlineLinks({ sessionLabel }: { sessionLabel: string }) {
 const staff = await getCurrentStaff(); if (!staff || !can(staff, "outcomes:view")) return null;
 const deadlines = await loadBoardDeadlines(sessionLabel).catch(() => null);
 return <Card><h2 className="sech">{lead(B.deadlines, staff.language)}</h2>{deadlines === null ? <p role="alert">{lead(B.unavailable, staff.language)}</p> : deadlines.length ? <div style={{ display: "grid", gap: 12 }}>{deadlines.map(item => <a key={item.id} href={item.href}><strong>{item.date} · {item.label} · {item.attempt}</strong><div style={{ color: "var(--mut)", fontSize: 12, overflowWrap: "anywhere" }}>{lead(B.verifiedOn, staff.language)}: {item.verifiedOn} · {item.sourceReference}</div></a>)}</div> : <p style={{ color: "var(--mut)" }}>{lead(B.unverifiedDeadline, staff.language)}</p>}</Card>;
}
