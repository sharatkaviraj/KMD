import { Badge } from "@/ui/primitives/badge";
import {
  profileLabel,
  profileTone,
  type ReminderProfile,
} from "@/modules/whatsapp/domain/reminder-profile";
import { cn } from "@/platform/utils";

/**
 * One family's reminder profile as a pill.
 *
 * `suggested` renders the pill dashed, so the office can tell at a glance which
 * families it filed by hand and which the ledger filed for it — the second kind
 * moves on its own next installment, the first does not.
 */
export function ProfileBadge({
  profile,
  suggested = false,
  className,
}: {
  profile: ReminderProfile;
  suggested?: boolean;
  className?: string;
}) {
  return (
    <Badge
      variant={profileTone(profile)}
      title={suggested ? "Suggested from the ledger" : "Set by the office"}
      className={cn(
        "whitespace-nowrap text-[11px] font-bold",
        suggested && "border border-dashed border-current/40",
        className,
      )}
    >
      {profileLabel(profile)}
    </Badge>
  );
}
