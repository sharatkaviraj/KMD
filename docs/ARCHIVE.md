# Archives and restoring them

P11 (D-238). This page is for the person who keeps the school's records. Today
that is an administrator.

## What an archive is

An archive is a **copy** of everything VPPS One holds:

- every table in the `vppsone` schema, one JSON file per table, written as
  canonical text by Postgres;
- every document (`vppsone-documents`) and photograph (`vppsone-photos`), byte
  for byte;
- a `manifest.json` listing each table's row count, its Postgres digest (md5
  of the canonical rows) and the sha256 of its file; each object's sha256 and
  size; the schema version (the latest migration) and the app commit.

It lives in the private `vppsone-archives` bucket under `<archive id>/`, and the
catalogue row is in `vppsone.archives`. **Nothing is deleted to make an
archive.** The fee ledger and receipts are the fee app's (`public` schema).
They are not in this archive and are never removed by it; the fee app's own
backups cover them.

Why the objects are copied separately: a Supabase database backup does not
include Storage objects. An archive that held only the database would restore
every document row with no document behind it.

## Making one

1. Open **Scheduled jobs → Archives** (`/archives`).
2. Give it a name the school will recognise later, e.g. `2026-27 year end`, and
   press **Build the archive**. On dev it takes about a minute: 66 tables and a
   few thousand rows, plus the files.
3. When the card says **Ready**, press **Run a restore drill**. Until a drill
   passes, treat the archive as unproven.

## What the drill proves

For every table, the drill:

- downloads the file and checks its sha256 against the manifest;
- reloads the rows into a scratch table with the same columns and types, in a
  transaction that leaves nothing behind;
- checks the reloaded rows reproduce the row count and Postgres digest the
  archive recorded.

For every object, it downloads the copy and checks its sha256. It also writes
one object to a scratch prefix, reads it back and removes it.

A drill fails, naming what failed, if any of these is true:

- a file is missing;
- a file's bytes changed;
- rows do not reload to the same digest;
- an object's bytes changed;
- the stored manifest disagrees with the catalogue's.

Every drill is kept in `vppsone.restore_drills`.

`npm run verify:archive` builds a real archive on dev with the app's own
engine, drills it, then tampers with a copy of its manifest four ways. It
proves each tampering is caught, and removes everything it made.

## Keeping a copy off this project (the manual fallback)

The archive lives in the same Supabase project it copies. That protects
against mistakes in the data, not against losing the project. Until the school
decides on an automated off-site copy (a separate authorization), do this
after each year-end archive:

1. Press **Download the manifest** on the archive's card and keep it.
2. From the Supabase dashboard (Storage → `vppsone-archives` → the archive's
   folder), download the `tables/` and `objects/` folders.
3. Put all three in the school's own private Drive folder for records, named as
   the archive is. Restrict it to the record owner.
4. Check that the number of files matches `totals.tables + totals.objects` in
   the manifest.

## Restoring from an archive

Restoring touches only `vppsone`, never `public`. It is done deliberately, by a
person, into a project whose schema is at the archive's `schemaVersion` or
later:

1. **Records.** For each `tables/<name>.json`, load it into the table:
   `insert into vppsone.<name> select * from jsonb_populate_recordset(null::vppsone.<name>, '<file contents>'::jsonb)`,
   in dependency order (staff and fields before the rows that point at them).
   Append-only triggers refuse edits, not inserts.
   `vppsone.restore_drill_table()` is this same load into a scratch table, so a
   passing drill is the evidence these statements work for this archive.
2. **Objects.** Upload each `objects/<bucket>/<path>` back to `<bucket>` at
   `<path>`; the rows already name those paths.
3. **Check.** Compare row counts with the manifest, and run
   `npm run verify:access` before anyone signs in.

## Documents kept in Google Drive (D-333)

When student documents live in the school's Shared Drive, the nightly
`document-backup` job keeps a sealed copy of each in the private bucket
`vppsone-drive-backups`, and every archive copies that bucket too. Those
objects are encrypted for the school's recovery key: the drill proves their
bytes are intact (sha256), and `npm run recovery -- verify` with the private
key proves they open. See `docs/DRIVE-STORAGE.md`.

## Not covered

- Automated off-site copies of the archive itself (Drive, another provider).
  This needs the school's decision on owner, capacity and access.
- Scheduled archives. Archives are made by hand, at year end and before a
  cutover.
- The fee app's data, which has its own backups and is not copied here.
