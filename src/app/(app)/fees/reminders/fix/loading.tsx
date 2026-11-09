import { RouteLoading } from "@/ui/shell/route-loading";

export default function Loading() {
  return (
    <RouteLoading
      badgeLabel="Loading failures"
      title="Families we didn't reach"
      description="Reading the send log, WhatsApp's results and the ledger."
      cards={3}
    />
  );
}
