import { RouteLoading } from "@/ui/shell/route-loading";

export default function Loading() {
  return (
    <RouteLoading
      badgeLabel="Loading the plan"
      title="Reminder plan"
      description="Reading the fee calendar and which steps have already gone out."
      cards={3}
    />
  );
}
