import { RouteLoading } from "@/ui/shell/route-loading";

export default function Loading() {
  return (
    <RouteLoading
      badgeLabel="Loading online payments"
      title="Online payments"
      description="Reading links, captured payments and receipt messages."
      cards={3}
    />
  );
}
