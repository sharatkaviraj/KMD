import { Student360Content } from "@/vx/screens/admin/student360-page";

export const runtime = "nodejs";

/**
 * Student 360 opened from the Students list: the same card as
 * `/students/[id]`, drawn over the list instead of in place of it (D02).
 */
export default async function StudentDrawer(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await props.params;
  const search = await props.searchParams;
  return <Student360Content id={id} search={search} />;
}
