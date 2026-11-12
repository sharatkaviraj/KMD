/** In-memory PostgreSQL proof of "Did this answer help?" (D-584):
 * supabase/migrations/*_parent_helper_ratings.sql against the hand-offs table
 * exactly as *_parent_helper_handoffs.sql made it, with synthetic neighbours.
 * No URL, credentials or hosted database accepted: pass a local installed
 * @electric-sql/pglite directory (CI installs it in a disposable folder).
 * Every name and number here is made up (rule 6).
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const migrations = join(import.meta.dirname, "../../supabase/migrations");
const one = (suffix) => {
  const found = readdirSync(migrations).filter((name) => name.endsWith(suffix));
  assert.equal(found.length, 1, `one ${suffix} migration`);
  return readFileSync(join(migrations, found[0]), "utf8");
};
const table = /create table vppsone\.parent_helper_handoffs \([\s\S]*?\n\);/.exec(one("_parent_helper_handoffs.sql"));
assert.ok(table, "the hand-offs table as step 2 made it");

const db = new PGlite();
await db.exec(`
create schema vppsone;
create role anon; create role authenticated; create role service_role;
create table vppsone.staff_profiles(id uuid primary key);
create table vppsone.parent_replies(id uuid primary key);
${table[0]}
`);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const handoff = (n, over = {}) => ({ id: id(n), parent_reply_id: id(100 + n), target: "class_teacher", topic: "message_teacher", ...over });
async function insert(row) {
  await db.query("insert into vppsone.parent_replies(id) values ($1) on conflict do nothing", [row.parent_reply_id]);
  const cols = ["id", "parent_reply_id", "parent_e164", "language", "target", "topic", "about_name", ...Object.keys(row).filter((key) => !["id", "parent_reply_id", "target", "topic"].includes(key))];
  const values = [row.id, row.parent_reply_id, "+919000000001", "en", row.target, row.topic, "Aarav", ...cols.slice(7).map((key) => row[key])];
  await db.query(`insert into vppsone.parent_helper_handoffs(${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, values);
}
const rejects = async (sql, params, rule) => {
  await assert.rejects(db.query(sql, params), (error) => String(error.message).includes(rule), rule);
};

// A hand-off made before the change.
await insert(handoff(1));
await db.exec(one("_parent_helper_ratings.sql"));
const before = (await db.query("select rating_asked_at, rating, rated_at, follow_up_of from vppsone.parent_helper_handoffs where id = $1", [id(1)])).rows[0];
assert.deepEqual({ ...before }, { rating_asked_at: null, rating: null, rated_at: null, follow_up_of: null });
console.log("PASS: a hand-off from before is untouched: nothing asked, nothing rated");

// Asked once: the run that sets rating_asked_at is the one that sends the question.
const claim = "update vppsone.parent_helper_handoffs set rating_asked_at = now() where id = $1 and rating_asked_at is null returning id";
assert.equal((await db.query(claim, [id(1)])).rows.length, 1);
assert.equal((await db.query(claim, [id(1)])).rows.length, 0);
console.log("PASS: the question is claimed once per hand-off");

// The guarded writes setRating makes: a yes only over nothing, a no over nothing or a yes.
const yes = "update vppsone.parent_helper_handoffs set rating = 'helped', rated_at = now() where id = $1 and rating is null returning id";
const no = "update vppsone.parent_helper_handoffs set rating = 'not_helped', rated_at = now() where id = $1 and (rating is null or rating = 'helped') returning id";
assert.equal((await db.query(yes, [id(1)])).rows.length, 1);
assert.equal((await db.query(yes, [id(1)])).rows.length, 0);
assert.equal((await db.query(no, [id(1)])).rows.length, 1);
assert.equal((await db.query(yes, [id(1)])).rows.length, 0);
assert.equal((await db.query(no, [id(1)])).rows.length, 0);
assert.equal((await db.query("select rating from vppsone.parent_helper_handoffs where id = $1", [id(1)])).rows[0].rating, "not_helped");
console.log("PASS: a yes is kept once, a no may follow it, and nothing replaces a no");

// Only the two answers, and never one without the other.
await rejects("update vppsone.parent_helper_handoffs set rating = 'maybe' where id = $1", [id(1)], "parent_helper_handoffs_rating_known");
await rejects("update vppsone.parent_helper_handoffs set rated_at = null where id = $1", [id(1)], "parent_helper_handoffs_rating_together");
await insert(handoff(2));
await rejects("update vppsone.parent_helper_handoffs set rating = 'helped' where id = $1", [id(2)], "parent_helper_handoffs_rating_together");
console.log("PASS: a rating is helped or not_helped, and always comes with its time");

// The office's hand-off for the no: one per rated hand-off, never itself rated.
await insert(handoff(3, { target: "office", topic: "not_helped", complaint: true, follow_up_of: id(1) }));
await db.query("insert into vppsone.parent_replies(id) values ($1)", [id(104)]);
await rejects(
  "insert into vppsone.parent_helper_handoffs(id, parent_reply_id, parent_e164, language, target, topic, about_name, follow_up_of) values ($1, $2, '+919000000001', 'en', 'office', 'not_helped', 'Aarav', $3)",
  [id(4), id(104), id(1)],
  "parent_helper_handoffs_one_follow_up",
);
await rejects("update vppsone.parent_helper_handoffs set rating_asked_at = now() where id = $1", [id(3)], "parent_helper_handoffs_follow_up_not_rated");
await rejects("update vppsone.parent_helper_handoffs set rating = 'helped', rated_at = now() where id = $1", [id(3)], "parent_helper_handoffs_follow_up_not_rated");
await rejects("update vppsone.parent_helper_handoffs set follow_up_of = id where id = $1", [id(2)], "parent_helper_handoffs_follow_up_not_self");
console.log("PASS: one office hand-off per no, never rated itself, never its own follow-up");

// Removing the first hand-off keeps the office's record of the no.
await db.query("delete from vppsone.parent_helper_handoffs where id = $1", [id(1)]);
assert.equal((await db.query("select follow_up_of from vppsone.parent_helper_handoffs where id = $1", [id(3)])).rows[0].follow_up_of, null);
console.log("PASS: the office's hand-off outlives the one it followed");

// Each new column is described where the next person will look.
const comments = (await db.query("select count(*)::int n from pg_description d join pg_attribute a on a.attrelid = d.objoid and a.attnum = d.objsubid where d.objoid = 'vppsone.parent_helper_handoffs'::regclass and a.attname in ('rating_asked_at', 'rating', 'rated_at', 'follow_up_of')")).rows[0].n;
assert.equal(comments, 4);
console.log("PASS: every new column says what it is for");
