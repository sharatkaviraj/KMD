import { Student360Backdrop } from "@/vx/screens/admin/student360";
import { Student360Content } from "@/vx/screens/admin/student360-page";

export const runtime = "nodejs";

export const metadata = { title: "Student" };

/**
 * Student 360 opened directly (a link from another screen, a bookmark, a
 * reload). The design only ever draws it as a drawer over the Students list
 * (D02), so the page draws the same drawer over a quiet stand-in for the list;
 * closing returns to wherever the reader came from.
 */
export default async function StudentPage(props: PageProps<"/students/[id]">) {
  const { id } = await props.params;
  const search = await props.searchParams;
  return (
    <>
      <Student360Backdrop />
      <Student360Content id={id} search={search} />
    </>
  );
}
