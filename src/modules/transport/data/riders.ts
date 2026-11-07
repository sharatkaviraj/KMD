import "server-only";

import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";

/*
 * Who rides a bus (D-550): every child on the roll this session with a
 * transport route. Fees decides the route; One reads it.
 *
 * The read goes through `public.students` on One's admin client with the
 * session named in the URL, so the projection fetch picks the source itself:
 * the real year reads One's nightly copy of Fees' roster
 * (`fees_bridge_students`), a TEST session the local table. The caller has
 * already checked `transport:view`; this is not a door.
 */

export type RiderRow = { id: string; name: string; admissionNo: string | null; classId: string; routeId: string };

type Row = {
  id: string;
  full_name: string | null;
  admission_no: string | null;
  transport_route_id: string | null;
  class: { id: string; session_label: string } | { id: string; session_label: string }[] | null;
};

const PAGE = 1000;

export async function readRiders(sessionLabel: string): Promise<RiderRow[]> {
  const out: RiderRow[] = [];
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data, error } = await createAdminClient()
      .schema(FEE_SCHEMA)
      .from("students")
      .select("id, full_name, admission_no, transport_route_id, class:classes!inner(id, session_label)")
      .eq("class.session_label", sessionLabel)
      .eq("status", "active")
      .not("transport_route_id", "is", null)
      .order("id")
      .range(from, from + PAGE - 1)
      .returns<Row[]>();
    if (error) throw new Error("transport_riders_unreadable");
    for (const row of data) {
      const cls = Array.isArray(row.class) ? row.class[0] : row.class;
      if (!cls || cls.session_label !== sessionLabel || !row.transport_route_id) continue;
      out.push({
        id: row.id,
        name: (row.full_name ?? "").trim() || "—",
        admissionNo: row.admission_no?.trim() || null,
        classId: cls.id,
        routeId: row.transport_route_id,
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}
