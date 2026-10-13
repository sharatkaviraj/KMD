import { Student360Backdrop, Student360Skeleton } from "@/vx/screens/admin/student360";

/**
 * Student 360's own skeleton, in the drawer's shape: the hero, the tiles, the
 * chips and the first cards. Every row on the students list prefetches this
 * boundary, so a tap shows it at once where the child's name will land.
 */
export default function Loading() {
  return (
    <>
      <Student360Backdrop />
      <Student360Skeleton />
    </>
  );
}
