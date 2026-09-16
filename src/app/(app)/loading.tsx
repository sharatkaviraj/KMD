import { SkeletonRows, Skeleton } from "@/ui/states";

/**
 * Shown while any screen in the group resolves.
 *
 * Language-free on purpose: it is grey blocks, and the one label on it is for
 * a screen reader, which gets the bilingual form because at this point the
 * staff profile has not been read yet.
 */
export default function Loading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-48" />
      <SkeletonRows rows={4} />
    </div>
  );
}
