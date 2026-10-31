import { RouteLoading } from "@/ui/shell/route-loading";

export default function Loading() {
  return (
    <RouteLoading
      badgeLabel="Loading families"
      title="Families"
      description="Reading every family's payment history to work out their reminder profile."
      cards={3}
    />
  );
}
