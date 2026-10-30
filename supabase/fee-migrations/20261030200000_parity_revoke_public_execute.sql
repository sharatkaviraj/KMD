-- ============================================================================
-- VPPS One fee-migration (One-only): take EXECUTE away from PUBLIC on the 45 fee
-- functions where the live fee database has already taken it away.
--
-- Why this differs from the fees app: it does not. It makes wtgxcptmucjerhufzjcf
-- match vgqyilgstjvgohrsiwkb. The 30 Oct schema parity check
-- (scripts/migrate/catalog-fingerprint.sql, docs/cutover/SCHEMA-PARITY.md) found
-- these 45 functions with `=X/postgres` (EXECUTE for PUBLIC, which anon is part
-- of) on wtgx and without it on live. Every other grantee row on these functions
-- (anon, authenticated, service_role, postgres) is already identical on the two,
-- so after this file the per-role EXECUTE grants for the fee schema are equal.
--
-- How wtgx got them: the masked replica (D-186) recreated functions with
-- `create function`, and Postgres's global default gives PUBLIC EXECUTE on every
-- new function (see 20261029030619's header for the same mechanism on live). The
-- fees app revoked them over several migrations that the replica never replayed.
--
-- Among them are the money RPCs (post_student_payment*, post_corrected_payment,
-- undo_recent_payment, reverse_receipt_admin, waive_late_fee, refunds) — callable
-- with the browser key on wtgx until now. Each still checks has_permission()
-- inside, so nothing was exposed, but the grant the guard was covering for goes.
-- This is plan §1.5's "sweep that revokes anon EXECUTE on dev's SECURITY DEFINER
-- functions", done against live's actual grant set instead of a guess.
--
-- Trigger functions are in the list: EXECUTE is checked when a trigger is
-- created, never when it fires, so revoking it changes nothing for the tables.
-- pg_cron runs as postgres (the owner), so the refresh jobs are unaffected.
--
-- Rollback: `grant execute on function <each> to public;` — not expected.
-- ============================================================================

begin;

revoke execute on function private.capture_audit_event() from public;
revoke execute on function private.current_staff_role() from public;
revoke execute on function private.enforce_max_active_conventional_discounts() from public;
revoke execute on function private.enforce_max_active_conventional_discounts_in_schema() from public;
revoke execute on function private.normalize_staff_role(text) from public;
revoke execute on function private.normalize_workbook_class_label(text, text) from public;
revoke execute on function private.prevent_append_only_mutation() from public;
revoke execute on function private.prevent_receipt_adjustment_mutation() from public;
revoke execute on function private.protect_receipt_money_columns() from public;
revoke execute on function private.set_actor_columns() from public;
revoke execute on function private.set_created_by_column() from public;
revoke execute on function private.set_updated_at() from public;
revoke execute on function private.sync_staff_profile_from_auth_user() from public;
revoke execute on function private.vpps_apply_chunk(text, jsonb) from public;
revoke execute on function public.active_session_label() from public;
revoke execute on function public.cancel_student_repayment_plan(uuid, text) from public;
revoke execute on function public.delete_academic_session_safe(uuid) from public;
revoke execute on function public.generate_schema_snapshot() from public;
revoke execute on function public.get_dashboard_fee_split(text) from public;
revoke execute on function public.get_dashboard_repayment_summary(text) from public;
revoke execute on function public.get_dashboard_summary(text, text) from public;
revoke execute on function public.get_student_directory_summary(text, uuid, uuid, text, text[], boolean) from public;
revoke execute on function public.get_student_segment_counts(text, uuid, uuid, text, text[], boolean) from public;
revoke execute on function public.has_any_permission(text[]) from public;
revoke execute on function public.import_student_batch_row(uuid, integer, text, uuid, text, date, text, text, text, text, text, uuid, student_status, text, integer, integer, integer, integer, jsonb, integer, integer, text, boolean) from public;
revoke execute on function public.import_student_batch_row(uuid, integer, text, uuid, text, date, text, text, text, text, text, uuid, student_status, text, integer, integer, integer, integer, jsonb, integer, integer, text, boolean, text, integer, integer) from public;
revoke execute on function public.post_corrected_payment(uuid, date, payment_mode, jsonb, uuid, text, text, text, text) from public;
revoke execute on function public.post_student_payment(uuid, date, payment_mode, integer, text, text, text, text, uuid) from public;
revoke execute on function public.post_student_payment_with_adjustments(uuid, date, payment_mode, integer, text, text, text, text, uuid, integer, integer) from public;
revoke execute on function public.preview_student_repayment_plan(uuid, text, text, integer, date) from public;
revoke execute on function public.process_refund_with_adjustment(uuid) from public;
revoke execute on function public.queue_workbook_materialized_view_refresh() from public;
revoke execute on function public.realign_recent_import_students_to_active_session(uuid) from public;
revoke execute on function public.refresh_defaulter_recovery_state(text, date) from public;
revoke execute on function public.refresh_financial_materialized_views(boolean) from public;
revoke execute on function public.refresh_workbook_materialized_views_if_requested() from public;
revoke execute on function public.reverse_receipt_admin(uuid, text) from public;
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.set_my_preferred_locale(text) from public;
revoke execute on function public.sync_repayment_plan_late_fees(text, boolean, date) from public;
revoke execute on function public.trigger_refresh_financial_views() from public;
revoke execute on function public.undo_recent_payment(uuid, text) from public;
revoke execute on function public.void_late_fee_waiver(uuid, text) from public;
revoke execute on function public.vpps_apply_chunk_proxy(text, jsonb) from public;
revoke execute on function public.waive_late_fee(uuid, integer, text, text, uuid, uuid, boolean) from public;

commit;
