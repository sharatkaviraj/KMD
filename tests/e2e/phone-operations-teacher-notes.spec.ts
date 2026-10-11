import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { db, signIn } from "./support/harness";

const studentId = "017b6e4f-d1e2-4433-a2c6-6fdf917f88a5";
const tag = "phoneops-20261011-teacher";
const entries: Array<Record<string, unknown>> = [];
const checkpoint = () => writeFileSync(path.resolve("../evidence/class-teacher-notes-ledger.json"), JSON.stringify({ tag, database: "wtgxcptmucjerhufzjcf", entries }, null, 2));
const owned = new Set<string>();
let baselineEmpty = false;

async function readTagged() {
  const result = await db().from("notes").select("id,student_id,body,visibility,tell_parents,status,needs_follow_up,follow_up_on,written_by,tags").eq("student_id", studentId).like("body", `${tag}%`);
  expect(result.error).toBeNull();
  return result.data ?? [];
}

test.beforeAll(async () => {
  const baseline = await readTagged(); expect(baseline).toEqual([]);
  baselineEmpty = true;
  entries.push({ phase: "baseline", studentId, notes: baseline }); checkpoint();
});
test.afterAll(async () => {
  if (!baselineEmpty) return;
  // Reconcile even if the browser lost the response, then delete exact IDs.
  const rows = await readTagged();
  rows.forEach(row => { expect(row.written_by).toBe("29d76340-1929-4848-ad4f-8a3ae5653a43"); owned.add(row.id); });
  if (process.env.PHONEOPS_PRESERVE_FIXTURES === "1") {
    entries.push({phase:"preserved-readback-no-cleanup",notes:rows,ownedNoteIds:[...owned]});checkpoint();return;
  }
  entries.push({ phase: "before-cleanup", notes: rows }); checkpoint();
  for (const id of owned) {
    const queued = await db().from("parent_message_queue").select("id").eq("note_id", id);
    expect(queued.error).toBeNull(); expect(queued.data).toEqual([]);
    const replies = await db().from("note_replies").delete().eq("note_id", id); expect(replies.error).toBeNull();
    const removed = await db().from("notes").delete().eq("id", id).eq("student_id", studentId); expect(removed.error).toBeNull();
  }
  entries.push({ phase: "after-cleanup", remaining: await readTagged(), ownedNoteIds: [...owned] }); checkpoint();
  expect(await readTagged()).toEqual([]);
});

test("phone teacher saves a private observation, reloads it, and another teacher cannot read it", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://localhost:3100", viewport: { width:390,height:844 }, isMobile:true,hasTouch:true });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(150_000);
  try {
    try { await signIn(page, "teacher", `/teach/notes?sheet=add&student=${studentId}`); }
    catch { throw new Error("QA teacher authentication or cold notes route could not complete; auth URL omitted from evidence."); }
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox", { name:"Child", exact:true }).selectOption(studentId);
    await dialog.getByRole("textbox", {name:"Note", exact:true}).fill(`${tag} private classroom observation`);
    await dialog.locator("button.pri").tap();
    const readers=dialog.getByRole("radiogroup",{name:"Who can read",exact:true});
    await readers.getByRole("radio").nth(1).tap();
    await expect(readers.getByRole("radio").nth(1)).toHaveAttribute("aria-checked","true");
    for(const control of await dialog.getByRole("switch").all()) await expect(control).toHaveAttribute("aria-checked","false");
    expect(await readTagged()).toEqual([]);
    await dialog.locator("button.pri").tap();
    await expect.poll(async()=> (await readTagged()).length,{timeout:90000}).toBe(1);
    const rows = await readTagged(); expect(rows).toHaveLength(1);
    const note = rows[0]; owned.add(note.id);
    expect(note).toMatchObject({ visibility:"private",tell_parents:false,student_id:studentId,needs_follow_up:false,written_by:"29d76340-1929-4848-ad4f-8a3ae5653a43" });
    entries.push({phase:"private-saved",note}); checkpoint();
    const queued = await db().from("parent_message_queue").select("id").eq("note_id", note.id); expect(queued.error).toBeNull();expect(queued.data).toEqual([]);
    await expect(page).toHaveURL(/step=saved/,{timeout:90000});
    await dialog.locator("button.pri").tap();
    await page.goto(`/teach/notes?note=${note.id}`);
    await expect(page.getByRole("complementary").getByText(`${tag} private classroom observation`, {exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole("complementary").getByText(`${tag} private classroom observation`, {exact:true})).toBeVisible();
    const other = await browser.newContext({baseURL:"http://localhost:3100",viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    try {
      const peer = await other.newPage();
      peer.setDefaultNavigationTimeout(150_000);
      try { await signIn(peer,"teacher2",`/teach/notes?note=${note.id}`); }
      catch { throw new Error("QA peer authentication or cold notes route could not complete; auth URL omitted from evidence."); }
      await expect(peer.getByText(`${tag} private classroom observation`,{exact:true})).toHaveCount(0);
      expect(await peer.evaluate(() => document.body.innerText.includes("private classroom observation"))).toBe(false);
      entries.push({phase:"peer-private-denied",noteId:note.id,peerPath:new URL(peer.url()).pathname});checkpoint();
    } finally {await other.close();}
  } finally {await context.close();}
});
