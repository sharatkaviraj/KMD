import { RouteLoading } from "@/ui/shell/route-loading";

export default function Loading() {
  return (
    <RouteLoading
      badgeLabel="Loading notices"
      title="School notices"
      description="Reading the class rolls."
      cards={3}
    />
  );
}
