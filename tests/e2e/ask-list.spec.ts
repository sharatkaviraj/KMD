import { expect, test } from "@playwright/test";

import {
  currentSessionLabel,
  db,
  removeRound,
  signIn,
} from "./support/harness";

/**
 * A list of specific children the office typed out.
 *
 * **The test is about the rows that do not match.** A list of six that quietly
 * becomes a round of three is the worst thing this feature can do: the office
 * believes it asked about everyone, and the ones it dropped are the ones whose
 * rows were already wrong (S-06).
 *
 * So the sheet uploaded here is deliberately broken in three different ways at
 * once, and every one of them has to come back **by the row number Excel shows
 * down the left** — the only number somebody can act on with the file open.
 */

let sessionLabel = "";
let present: string[] = [];
let leftTheSchool: string | null = null;
let roundId: string | null = null;

test.beforeAll(async () => {
  sessionLabel = await currentSessionLabel();

  const { data: enrolled, error } = await db()
    .from("enrolments")
    .select("class_id, student_id")
    .eq("session_label", sessionLabel)
    .eq("status", "enrolled");

  if (error) throw new Error(error.message);

  const byClass = new Map<string, string[]>();
  for (const row of enrolled ?? []) {
    const id = row.class_id as string;
    byClass.set(id, [...(byClass.get(id) ?? []), row.student_id as string]);
  }

  const [chosen] = [...byClass.entries()].sort((a, b) => b[1].length - a[1].length);
  if (!chosen || chosen[1].length < 3) {
    throw new Error("No class has three children — run npm run qa:seed");
  }

  const ids = [...chosen[1]].sort().slice(0, 3);

  const { data: students, error: feeError } = await db("public")
    .from("students")
    .select("id, admission_no")
    .in("id", ids);

  if (feeError) throw new Error(feeError.message);

  present = (students ?? [])
    .map((row) => row.admission_no as string | null)
    .filter((no): no is string => Boolean(no))
    .sort();

  if (present.length < 3) throw new Error("Three children with SR numbers are needed");

  // Somebody off the roll, so "not on this session's roll" is a real branch
  // rather than a hypothesis. Read, not created — rule 2 forbids writing here.
  const { data: gone } = await db("public")
    .from("students")
    .select("id, admission_no")
    .not("admission_no", "is", null)
    .not("id", "in", `(${(enrolled ?? []).map((r) => r.student_id).join(",")})`)
    .limit(1)
    .maybeSingle();

  leftTheSchool = (gone?.admission_no as string | null) ?? null;
});

test.afterAll(async () => {
  await removeRound(roundId);
});

test("every row of an uploaded list is matched or named", async ({ page }) => {
  await signIn(page, "office", "/collection/rounds/upload");

  /* ------------------------------------------- 1. the template downloads */

  const download = await page.request.get("/collection/rounds/template");
  expect(download.status(), "the template is not downloadable").toBe(200);

  const template = await download.text();
  // Without the BOM Excel opens Hindi in the notes column as mojibake, and a
  // template whose notes cannot hold Hindi is a template for one language.
  expect(template.charCodeAt(0), "no byte order mark: Excel will mangle Hindi").toBe(
    0xfeff,
  );

  /* --------------------------------------- 2. a sheet broken three ways */

  const rows = [
    `${present[0]},Someone,नंबर चाचा का है`,
    `${present[1]},Someone Else,"number is wrong, ring after four"`,
    "NOPE-404-NOT-A-CHILD,Nobody,",
    ",Nameless Row,a note with no SR number",
    `${present[0]},The Same Child Again,a duplicate row`,
    ...(leftTheSchool ? [`${leftTheSchool},Gone From The Roll,`] : []),
  ];

  const csv = `﻿SR No,Name (not read),Note to teacher\r\n${rows.join("\r\n")}\r\n`;

  await page.setInputFiles("#ask-file", {
    name: "ask-list.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });

  await page.getByRole("button", { name: /मिलान देखिए|Check the list/ }).click();

  /* ------------------------------------ 3. nothing is counted away */

  const matchedIds = page.locator("input[name=studentIds]");
  await expect(matchedIds, "the matched children never appeared").toHaveCount(2);

  const body = page.locator("body");

  // Each failure, by its Excel row number. Row 1 is the header, so the first
  // data row is row 2 — reporting row 0 or 1 gives a number nobody can use.
  await expect(body, "a row naming nobody was not reported").toContainText("NOPE-404");
  await expect(body, "a row with no SR number was not reported").toContainText(
    "Nameless Row",
  );
  await expect(body, "a duplicated child was not reported").toContainText(
    "The Same Child Again",
  );

  // **The invariant.** Six rows in, six accounted for — however many of them
  // are wrong. A count that does not add up is the bug this screen exists to
  // prevent, and it is the one assertion that would catch a silent drop.
  const named = await page.locator("li").filter({ hasText: /पंक्ति|Row/ }).count();
  expect(
    named + (await matchedIds.count()),
    "rows went missing between the sheet and the screen",
  ).toBe(rows.length);

  /* ----------------------------- 4. the round covers exactly those two */

  const title = `QA ask list ${Date.now()}`;
  await page.fill("#ask-title-hi", title);
  await page.fill("#ask-reason-hi", "QA — इन परिवारों का नंबर व्हाट्सएप पर नहीं है");
  await page.locator("input[name=fieldIds]").first().check();
  await page.getByRole("button", { name: /राउंड बनाएँ|Create the round/ }).click();

  await page.waitForURL(/\/collection\/rounds\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  const round = await readRound(title);
  expect(round, "no round row exists after creating one").not.toBeNull();
  roundId = round!.id;

  // An explicit list is the whole audience: every other dimension is ignored
  // when it is set, so nothing here may have quietly picked up a class.
  expect(round!.audience.studentIds).toHaveLength(2);
  expect(round!.audience.classIds).toEqual([]);

  // The note travelled, in the language it was typed in. A notes column that
  // cannot hold Hindi is the reason the template carries a BOM.
  expect(Object.values(round!.audience.notes)).toContain("नंबर चाचा का है");
});

async function readRound(title: string) {
  const { data, error } = await db()
    .from("collection_rounds")
    .select("id, audience")
    .eq("title_hi", title)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data as {
    id: string;
    audience: {
      studentIds: string[];
      classIds: string[];
      notes: Record<string, string>;
    };
  } | null;
}
