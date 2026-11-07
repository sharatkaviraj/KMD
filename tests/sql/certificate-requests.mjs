// Synthetic in-memory SQL only. No network or environment connection string.
// Teacher asks, approver signs, teacher downloads: the rules the database holds.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const db = new PGlite();
const sql = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
await db.exec(sql("./certificate-requests-fixture.sql"));
await db.exec(sql("../../supabase/migrations/20261107172553_certificate_requests.sql"));
await db.exec(sql("../../supabase/migrations/20261107172557_certificate_requests_role_permissions.sql"));

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [realAdmin, testAdmin, teacher, otherTeacher, office, realTeacher] = [1, 2, 3, 4, 5, 6].map(id);
const [classA, classB, s1, s2, s3] = [11, 12, 21, 22, 23].map(id);
const T = "TEST-2026-27";
await db.exec(`
insert into vppsone.staff_profiles(id,role,is_test_account,short_name) values
 ('${realAdmin}','admin',false,'Admin'),('${testAdmin}','admin',true,'QA Admin'),('${teacher}','teacher',true,'QA Teacher'),
 ('${otherTeacher}','teacher',true,'QA Other'),('${office}','office',true,'QA Office'),('${realTeacher}','teacher',false,'Teacher');
insert into vppsone.class_teachers values ('${teacher}','${classA}','${T}','2026-04-01',null);
insert into vppsone.teaching_assignments values ('${otherTeacher}','${classB}','${T}');
insert into vppsone.enrolments(student_id,class_id,session_label,status,left_on) values
 ('${s1}','${classA}','${T}','enrolled',null),('${s2}','${classB}','${T}','enrolled',null),('${s3}','${classA}','${T}','left','2026-10-30');
insert into vppsone.fees_identity_students values ('${s1}','Synthetic Child One','T-001','Synthetic Parent','2014-05-01'),('${s2}','Synthetic Child Two','T-002',null,null);
insert into vppsone.fees_identity_classes values ('${classA}','${T}','7','A'),('${classB}','${T}','8','B');
`);

const one = async (text, params) => (await db.query(text, params)).rows[0]?.r;
const create = (actor, student, kind, command, purpose = null, extras = {}, note = null, confined = false) =>
  one("select vppsone.school_certificate_request_create($1,$2,$3,$4,$5,$6,$7,$8,$9) r", [actor, student, T, kind, command, purpose, JSON.stringify(extras), note, confined]);
const list = (actor, scope, student = null, session = T) => one("select vppsone.school_certificate_requests_list($1,$2,$3,$4,false) r", [actor, session, scope, student]);

// The permission rows the app's matrix reads.
const granted = (await db.query("select role::text||'='||permission p from vppsone.role_permissions where permission in ('certificates:request','certificates:approve') order by 1")).rows.map((r) => r.p);
assert.deepEqual(granted, ["admin=certificates:approve", "admin=certificates:request", "teacher=certificates:request"]);
console.log("PASS: admins approve, teachers and admins ask");

// Asking.
const first = await create(teacher, s1, "study", id(101), "Scholarship application", {}, "Parent asked today");
assert.equal(first.existing, false);
assert.equal(first.request.state, "waiting");
assert.equal(first.request.class_id, classA);
assert.equal((await create(teacher, s1, "study", id(101), "Scholarship application", {}, "Parent asked today")).existing, true, "a retry replays");
const again = await create(teacher, s1, "study", id(102), "Bank account");
assert.equal(again.existing, true, "a second ask finds the open request");
assert.equal(again.request.id, first.request.id);
await assert.rejects(create(otherTeacher, s1, "study", id(103)), /certificate_request:forbidden/, "another class's teacher");
await assert.rejects(create(teacher, s3, "study", id(104)), /certificate_request:not_enrolled/, "a child who has left");
await assert.rejects(create(teacher, s1, "tc", id(105)), /certificate_request:invalid_kind/, "a TC stays with the office");
await assert.rejects(create(teacher, s1, "character", id(106)), /certificate_request:conduct_required/);
await assert.rejects(create(teacher, s1, "character", id(107), null, { conduct: "superb" }), /certificate_request:invalid_extras/);
await assert.rejects(create(teacher, s1, "dob", id(108), null, { conduct: "good" }), /certificate_request:invalid_extras/);
await assert.rejects(create(teacher, s1, "study", id(109), "<script>"), /certificate_request:invalid_purpose/);
await assert.rejects(create(realTeacher, s1, "study", id(110)), /certificate_request:forbidden/, "a real account in the TEST session");
assert.equal((await create(teacher, s1, "study", id(111), null, {}, null, true)).existing, true, "a confined deployment works in TEST");
await assert.rejects(one("select vppsone.school_certificate_request_create($1,$2,'2026-27','study',$3,null,'{}',null,true) r", [teacher, s1, id(112)]), /certificate_request:forbidden/, "a confined deployment and a live session");
await assert.rejects(create(teacher, s2, "study", id(113)), /certificate_request:forbidden/);
assert.equal((await create(otherTeacher, s2, "study", id(114))).existing, false, "a subject teacher of the class may ask");
const character = await create(teacher, s1, "character", id(115), null, { conduct: "very_good" });
assert.equal(character.request.extras.conduct, "very_good");
await assert.rejects(create(teacher, s1, "study", id(101), "Another purpose"), /certificate_request:command_reused/, "one command, one ask");
console.log("PASS: asking is scoped to the teacher's classes, TEST with TEST, one open request per document, replay-safe");

// Reading.
const mine = await list(teacher, "mine");
assert.equal(mine.length, 2);
assert.ok(mine.every((row) => row.mine && row.state === "waiting" && row.fatherName === null), "a teacher never gets the approver's extra facts");
assert.equal((await list(teacher, "student", s1)).length, 2);
await assert.rejects(list(otherTeacher, "student", s1), /certificate_request:forbidden/);
await assert.rejects(list(teacher, "approver"), /certificate_request:forbidden/);
await assert.rejects(list(office, "approver"), /certificate_request:forbidden/, "the office cannot approve until Staff -> Roles says so");
const queue = await list(testAdmin, "approver");
assert.equal(queue.length, 3);
assert.equal(queue.find((row) => row.studentId === s1 && row.kind === "study").fatherName, "Synthetic Parent");
assert.equal(queue.find((row) => row.studentId === s1 && row.kind === "study").requestedByName, "QA Teacher");
assert.equal(queue.find((row) => row.studentId === s1 && row.kind === "study").classLabel, "7 A");
assert.equal((await list(realAdmin, "approver")).length, 3, "the real admin oversees TEST too");
assert.deepEqual(await list(testAdmin, "approver", null, "2026-27").catch((e) => String(e)).then((v) => (Array.isArray(v) ? "rows" : v)).then((v) => /forbidden/.test(v)), true, "a test admin cannot read the live queue");
console.log("PASS: each screen reads only its own requests; father's name and birth date only for an approver");

// Approving.
const issue = async (actor, student, kind, purpose, extras = {}, ready = true, status = "prepared") => (await db.query(
  `insert into vppsone.school_certificate_issues(student_id,session_label,kind,serial,status,artifact_state,snapshot,issued_by,storage_path,artifact_sha256)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
  [student, T, kind, `TEST/VPPS/X/${T}/${Math.floor(Math.random() * 9999)}`, status, ready ? "ready" : "preparing",
    JSON.stringify({ purpose, extras, school: { name: "Synthetic", signaturePolicy: "facsimile", signatureAsset: "principal-2026", seal: "school-seal-2026" } }),
    actor, ready ? `certificates/${T}/${student}/x.pdf` : null, ready ? "a".repeat(64) : null])).rows[0].id;
const approve = (actor, request, issueId) => one("select vppsone.school_certificate_request_approve($1,$2,$3,false) r", [actor, request, issueId]);
const studyIssue = await issue(testAdmin, s1, "study", "Scholarship application");
await assert.rejects(approve(office, first.request.id, studyIssue), /certificate_request:forbidden/);
await assert.rejects(approve(teacher, first.request.id, studyIssue), /certificate_request:forbidden/);
await assert.rejects(approve(testAdmin, first.request.id, await issue(testAdmin, s1, "dob", "Scholarship application")), /certificate_request:issue_mismatch/, "another document");
await assert.rejects(approve(testAdmin, first.request.id, await issue(testAdmin, s1, "study", "Bank account")), /certificate_request:issue_mismatch/, "another purpose");
await assert.rejects(approve(testAdmin, first.request.id, await issue(realAdmin, s1, "study", "Scholarship application")), /certificate_request:issue_mismatch/, "issued by someone else");
await assert.rejects(approve(testAdmin, first.request.id, await issue(testAdmin, s1, "study", "Scholarship application", {}, false)), /certificate_request:issue_mismatch/, "not stored yet");
const approved = await approve(testAdmin, first.request.id, studyIssue);
assert.equal(approved.state, "approved");
assert.equal(approved.issue_id, studyIssue);
assert.equal((await approve(testAdmin, first.request.id, studyIssue)).state, "approved", "a retry is the same approval");
await assert.rejects(approve(testAdmin, first.request.id, await issue(testAdmin, s1, "study", "Scholarship application")), /certificate_request:decided/);
const ready = (await list(teacher, "mine")).find((row) => row.id === first.request.id);
assert.equal(ready.issueReady, true);
assert.equal(ready.signed, true);
assert.equal(ready.decidedByName, "QA Admin");
const charIssue = await issue(testAdmin, s1, "character", null, { conduct: "good" });
await assert.rejects(approve(testAdmin, character.request.id, charIssue), /certificate_request:issue_mismatch/, "the conduct the teacher chose");
console.log("PASS: only an approver links a matching document they issued themselves; approval is final and replay-safe");

// Withdrawing and declining.
const withdraw = (actor, request) => one("select vppsone.school_certificate_request_withdraw($1,$2,false) r", [actor, request]);
const decline = (actor, request, reason) => one("select vppsone.school_certificate_request_decline($1,$2,$3,false) r", [actor, request, reason]);
await assert.rejects(withdraw(otherTeacher, character.request.id), /certificate_request:forbidden/);
assert.equal((await withdraw(teacher, character.request.id)).state, "withdrawn");
assert.equal((await withdraw(teacher, character.request.id)).state, "withdrawn");
await assert.rejects(approve(testAdmin, character.request.id, charIssue), /certificate_request:decided/);
await assert.rejects(withdraw(teacher, first.request.id), /certificate_request:decided/);
const dob = await create(teacher, s1, "dob", id(120));
await assert.rejects(decline(teacher, dob.request.id, "Not needed"), /certificate_request:forbidden/);
await assert.rejects(decline(testAdmin, dob.request.id, "no"), /certificate_request:reason_required/);
assert.equal((await decline(testAdmin, dob.request.id, "Date of birth is not in the register yet")).state, "declined");
assert.equal((await decline(testAdmin, dob.request.id, "Date of birth is not in the register yet")).state, "declined");
assert.equal((await list(teacher, "mine")).find((row) => row.id === dob.request.id).declineReason, "Date of birth is not in the register yet");
assert.equal((await list(teacher, "student", s1)).some((row) => row.state === "withdrawn"), false);
assert.equal((await create(teacher, s1, "dob", id(121))).existing, false, "a declined document can be asked for again");
console.log("PASS: the asker withdraws, an approver declines with a reason, and either is final");

// Downloading.
const documentFor = (actor, request, command = null) => one("select vppsone.school_certificate_request_document($1,$2,$3,false) r", [actor, request, command]);
await assert.rejects(documentFor(otherTeacher, first.request.id), /certificate_request:forbidden/);
await assert.rejects(documentFor(teacher, dob.request.id), /certificate_request:not_ready/);
const doc = await documentFor(teacher, first.request.id, id(130));
assert.equal(doc.issueId, studyIssue);
await documentFor(teacher, first.request.id, id(130));
await documentFor(teacher, first.request.id);
assert.equal((await db.query("select count(*)::int n from vppsone.school_certificate_events where issue_id=$1 and kind='download_requested'", [studyIssue])).rows[0].n, 1, "one event per command, none for a plain read");
await assert.rejects(documentFor(testAdmin, first.request.id, id(130)), /certificate_request:command_reused/);
assert.equal((await documentFor(testAdmin, first.request.id)).issueId, studyIssue, "an approver may open it too");
await db.query("update vppsone.school_certificate_issues set status='superseded' where id=$1", [studyIssue]);
const replacement = (await db.query(`insert into vppsone.school_certificate_issues(student_id,session_label,kind,serial,status,artifact_state,snapshot,issued_by,storage_path,artifact_sha256,supersedes)
  values($1,$2,'study','TEST/VPPS/STUDY/R',  'prepared','ready','{}',$3,'certificates/r.pdf',$4,$5) returning id`, [s1, T, testAdmin, "b".repeat(64), studyIssue])).rows[0].id;
assert.equal((await documentFor(teacher, first.request.id)).issueId, replacement, "a corrected copy stands in");
assert.equal((await list(teacher, "mine")).find((row) => row.id === first.request.id).issueId, replacement);
await db.query("update vppsone.school_certificate_issues set status='cancelled' where id=$1", [replacement]);
await assert.rejects(documentFor(teacher, first.request.id), /certificate_request:not_ready/, "a cancelled copy is gone");
await db.exec(`update vppsone.staff_profiles set is_active=false where id='${teacher}'`);
await assert.rejects(documentFor(teacher, first.request.id), /certificate_request:forbidden/);
await db.exec(`update vppsone.staff_profiles set is_active=true where id='${teacher}'`);
console.log("PASS: downloads go to the asker or an approver, follow corrections, stop at cancellation and are recorded once");

// What was asked never changes.
await assert.rejects(db.query("update vppsone.school_certificate_requests set purpose='Changed' where id=$1", [first.request.id]), /certificate_request:immutable/);
await assert.rejects(db.query("delete from vppsone.school_certificate_requests where id=$1", [first.request.id]), /certificate_request:immutable/);
await assert.rejects(db.query("update vppsone.school_certificate_requests set state='declined',decline_reason='Changed mind' where id=$1", [first.request.id]), /certificate_request:decided/);
await assert.rejects(db.query("insert into vppsone.school_certificate_requests(student_id,session_label,class_id,kind,requested_by,command_id,state) values($1,$2,$3,'study',$4,$5,'approved')", [s2, T, classB, teacher, id(140)]), /school_certificate_request_(decided|issue)/);
console.log("PASS: a request is immutable and its answer final");
