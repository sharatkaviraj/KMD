import { SkeletonRows, Skeleton } from "@/ui/states";

/** Shown while any screen in the group resolves. */
export default function Loading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-48" />
      <SkeletonRows rows={4} />
    </div>
  );
}
