-- D-644 (16 Nov 2026): dblink, so One can read its own copy of the Fees
-- app's data through the read-only login (see 20261116025632_fees_copy_link).
-- dblink_connect_u stays owned by supabase_admin and is never granted.
create extension if not exists dblink with schema extensions;
