import { expect, test } from "@playwright/test";

import {
  currentSessionLabel,
  db,
  removeRound,
  signIn,
} from "./support/harness";

/**
 * Turning a round into links, and saying who it will not reach.
 *
 * **The assertion that matters is the one about the class that is left out.**
 * A round that reports "2 links made" while quietly covering none of a third
 * class is the failure this whole screen exists to prevent: the office
 * believes it asked everyone, and finds out in a fortnight that it did not.
 *
 * So the round is built over three classes chosen for three *different*
 * outcomes — one ready, one ready, one held up because its teacher has no
 * number — and every one of the three is asserted separately, against the
 * database rather than against the screen agreeing with itself.
 */

const FIELD_KEY = "guardian_phone";

let sessionLabel = "";
let fieldId = "";
let ready: { id: string; label: string; children: number }[] = [];
let blocked: { id: string; label: string; children: number } | null = null;
let roundId: string | null = null;

test.beforeAll(async () => {
  sessionLabel = await currentSessionLabel();

  const { data: field, error: fieldError } = await db()
    .from("collection_fields")
    .select("id")
    .eq("key", FIELD_KEY)
    .eq("is_active", true)
    .maybeSingle();

  if (fieldError) throw new Error(fieldError.message);
  if (!field) throw new Error(`No active "${FIELD_KEY}" field — run npm run seed:dev`);
  fieldId = field.id as string;

  // Who is class teacher of what, and whether a link could be sent to them.
  const { data: teachers, error } = await db()
    .from("class_teachers")
    .select("class_id, staff_profile_id")
    .eq("session_label", sessionLabel)
    .is("effective_to", null);

  if (error) throw new Error(error.message);

  const { data: profiles, error: profileError } = await db()
    .from("staff_profiles")
    .select("id, display_name, phone, whatsapp_phone, is_active");

  if (profileError) throw new Error(profileError.message);

  const reachable = new Map(
    (profiles ?? [])
      .filter((row) => row.is_active)
      .map((row) => [
        row.id as string,
        /^\d{10}$/.test(
          (((row.whatsapp_phone ?? row.phone) as string | null) ?? "").replace(/\D/g, ""),
        ),
      ]),
  );

  const { data: enrolled, error: rollError } = await db()
    .from("enrolments")
    .select("class_id, student_id")
    .eq("session_label", sessionLabel)
    .eq("status", "enrolled");

  if (rollError) throw new Error(rollError.message);

  const sizeOf = new Map<string, number>();
  for (const row of enrolled ?? []) {
    const id = row.class_id as string;
    sizeOf.set(id, (sizeOf.get(id) ?? 0) + 1);
  }

  const { data: classes } = await db("public")
    .from("classes")
    .select("id, class_name")
    .order("sort_order");

  const nameOf = new Map(
    (classes ?? []).map((row) => [row.id as string, row.class_name as string]),
  );

  // Exactly one class teacher, so the group is not blocked as "many owners".
  const ownerCount = new Map<string, string[]>();
  for (const row of teachers ?? []) {
    const id = row.class_id as string;
    ownerCount.set(id, [...(ownerCount.get(id) ?? []), row.staff_profile_id as string]);
  }

  const withOneTeacher = [...ownerCount.entries()]
    .filter(([classId, owners]) => owners.length === 1 && (sizeOf.get(classId) ?? 0) > 0)
    .map(([classId, owners]) => ({
      id: classId,
      label: nameOf.get(classId) ?? classId,
      children: sizeOf.get(classId) ?? 0,
      reachable: reachable.get(owners[0]) === true,
    }));

  ready = withOneTeacher.filter((row) => row.reachable).slice(0, 2);
  blocked = withOneTeacher.find((row) => !row.reachable) ?? null;

  if (ready.length < 2 || !blocked) {
    throw new Error(
      "Need two classes whose teacher has a number and one whose teacher does not — run npm run qa:seed",
    );
  }
});

test.afterAll(async () => {
  // Not a cascade — see removeRound(). B-41.
  await removeRound(roundId);
});

/**
 * **B-40, and why the number was a symptom.**
 *
 * This journey measured 58.2 s against the suite's 60 s default, so the same
 * build passed and failed on consecutive runs and the failure read like a
 * regression in whatever had been merged that day. The timeout went up.
 *
 * Then B-41 turned out to be the cause: three teardowns left three requests
 * each behind on the shared dev database, `listRequests()` reads the lot with
 * a query per row, and every journey that touches `/collection` had been
 * getting slower for a fortnight. With the leak fixed and the leftovers
 * removed, this test runs in **10.6 s** and the whole suite in 1.8 minutes
 * rather than 12.4.
 *
 * The ceiling stays raised, because it is still the longest journey here —
 * six page loads, a resume and a deliberate three-second wait — and headroom
 * on the longest one is cheap. It is not raised in `playwright.config.ts`:
 * the default is what would catch the next test that starts taking a minute,
 * which is exactly the signal that was almost lost this time.
 */
test.setTimeout(120_000);

test("a round becomes one link per class, and names the class it cannot reach", async ({
  page,
}) => {
  await signIn(page, "office", "/collection/rounds");

  /* ----------------------------------- 1. a round over three classes */

  const classIds = [...ready.map((row) => row.id), blocked!.id];
  const title = `QA fan-out ${Date.now()}`;

  const { data: round, error } = await db()
    .from("collection_rounds")
    .insert({
      session_label: sessionLabel,
      title_hi: title,
      audience: {
        classIds,
        houses: [],
        routeIds: [],
        search: "",
        gaps: [],
        allEnrolled: false,
        studentIds: [],
        notes: {},
        from: null,
      },
      reason_hi: "QA — जाँच",
      recipient_mode: "class_teacher",
      status: "draft",
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  roundId = round.id as string;

  const { error: fieldError } = await db()
    .from("collection_round_fields")
    .insert({ round_id: roundId, field_id: fieldId, sort_order: 0 });

  if (fieldError) throw new Error(fieldError.message);

  /* ------------------------ 2. the plan says what it cannot reach, first */

  await page.goto(`/collection/rounds/${roundId}`);

  // **Stated, never inferred from two totals disagreeing.** These children are
  // in a class whose teacher has no number — they are not ungrouped, and the
  // wording has to tell the office which problem it is looking at.
  await expect(
    page.getByText(String(blocked!.children), { exact: false }).first(),
    "the round does not say how many children no link would reach",
  ).toBeVisible();

  await expect(
    page.getByText(blocked!.label, { exact: false }).first(),
    "the class that cannot be reached is not named",
  ).toBeVisible();

  /* ------------------------------------------- 3. make the links */

  await page.getByRole("button", { name: /लिंक बनाएँ|Make the links/ }).click();

  await expect
    .poll(() => countLinks(), { message: "no links were made", timeout: 25_000 })
    // One per ready class, plus the office's own link over the lot.
    .toBe(ready.length + 1);

  const links = await readLinks();

  for (const group of ready) {
    const link = links.find((row) => row.audience_label === group.label);
    expect(link, `no link for ${group.label}`).toBeTruthy();
    expect(link!.assigned_staff_id, `${group.label} has no recipient`).toBeTruthy();
    expect(link!.members, `${group.label} froze the wrong number of children`).toBe(
      group.children,
    );
  }

  // **The class that was held up has no link at all.** Not an empty one, not
  // one with no recipient — none, because a link nobody can be sent is a
  // roster frozen for nothing.
  expect(
    links.some((row) => row.audience_label === blocked!.label),
    "a link was made for a class whose teacher cannot be sent one",
  ).toBe(false);

  // The office's own link covers exactly what the class links cover between
  // them — not the whole audience, which would include the class left out.
  const master = links.find((row) => row.audience_kind === "master");
  expect(master, "no master link").toBeTruthy();
  expect(master!.assigned_staff_id, "the master link has an owner").toBeNull();
  expect(master!.members).toBe(ready.reduce((sum, row) => sum + row.children, 0));

  /* ----------------------------- 4. running it again creates nothing */

  await page.reload();
  await page.getByRole("button", { name: /लिंक बनाएँ|Make the rest|बाकी लिंक/ }).click();

  // Resume is the same code path as the first run, so running it twice has to
  // be a no-op — and the unique index is what makes a double tap safe.
  await page.waitForTimeout(3000);
  expect(await countLinks(), "a second run minted duplicate links").toBe(
    ready.length + 1,
  );

  /* ---------------------------------- 5. a draft link is not a link yet */

  const token = links[0].token;
  const anonymous = await page.context().browser()!.newContext();
  const visitor = await anonymous.newPage();

  expect(
    (await visitor.goto(`/r/${token}`))?.status(),
    "a draft link answers something other than 404",
  ).toBe(404);

  /* ------------------------------------------- 6. turn them on */

  await page.reload();
  await page.getByRole("button", { name: /लिंक चालू|Turn the links on/ }).click();

  await expect
    .poll(async () => (await readLinks()).every((row) => row.status === "open"), {
      timeout: 20_000,
    })
    .toBe(true);

  const live = await visitor.goto(`/r/${token}`);
  expect(live?.status(), "an opened link still does not answer").toBe(200);

  await expect(
    visitor.getByRole("listitem"),
    "the opened link loaded no roster",
  ).not.toHaveCount(0);

  await anonymous.close();
});

async function readLinks() {
  const { data, error } = await db()
    .from("collection_requests")
    .select("id, token, audience_kind, audience_label, status, assigned_staff_id")
    .eq("round_id", roundId!);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as {
    id: string;
    token: string;
    audience_kind: string;
    audience_label: string;
    status: string;
    assigned_staff_id: string | null;
  }[];

  const withMembers = await Promise.all(
    rows.map(async (row) => {
      const { count } = await db()
        .from("collection_request_members")
        .select("student_id", { count: "exact", head: true })
        .eq("request_id", row.id);

      return { ...row, members: count ?? 0 };
    }),
  );

  return withMembers;
}

async function countLinks() {
  const { count, error } = await db()
    .from("collection_requests")
    .select("id", { count: "exact", head: true })
    .eq("round_id", roundId!);

  if (error) throw new Error(error.message);
  return count ?? 0;
}
