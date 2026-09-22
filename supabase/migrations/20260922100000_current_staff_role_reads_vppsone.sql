-- ⚠ THIS MIGRATION CHANGES A FUNCTION THE FEE APP OWNS. ⚠
--
-- Everything else in this directory creates or alters objects in the `vppsone`
-- schema, which is rule 1. This one redefines `private.current_staff_role()`,
-- which belongs to School Fees — so read the whole header before changing it,
-- and **it must be applied to the live fee database at cutover** or VPPS One
-- will not be able to take a rupee there.
--
-- ## What was broken
--
-- An accountant in VPPS One could not post a payment. Not a configuration
-- problem and not a client problem: `post_student_payment_with_adjustments`
-- opens with `if not public.has_permission('payments:write')`, and
-- `has_permission` is
--
--     select auth.uid() is not null and case private.current_staff_role() … end
--
-- while `current_staff_role()` read **only** `public.users`. A VPPS One account
-- fails that both ways — through the cookie client because it has no
-- `public.users` row (D-6 deliberately keeps each person's role in
-- `vppsone.staff_profiles` so it is not recorded in two places that can
-- disagree), and through the service-role client because `auth.uid()` is null
-- there. Sixteen of the eighteen fee RPCs are gated this way; ten of them,
-- including posting, refunds and every repayment-plan action, have no
-- service-role arm to fall back on.
--
-- Tried, not inferred: a ₹100 post as `qa.fees` with a real session token and
-- again as service role both answered "You do not have permission to post
-- payments", and wrote no receipt.
--
-- ## Why this is the fix, and why it is small
--
-- **The fee database was already prepared for it.** `public.staff_role`
-- already contains all eight VPPS One roles — `office`,
-- `academic_coordinator` and `exam_coordinator` alongside the fee app's five —
-- in dev *and* in live, and `public.has_permission()` already has a case arm
-- for each of them. The only piece left undone was this function, which never
-- looked anywhere but `public.users`.
--
-- **It is purely additive.** The fee app's own users all have a `public.users`
-- row, so the first branch answers for every one of them exactly as before.
-- The second branch can only fire for an account that has no row there — which
-- is to say, only for VPPS One. No existing behaviour changes.
--
-- **It keeps the person.** The alternative considered was signing VPPS One's
-- fee RPC calls as one shared service identity in `public.users`. That works,
-- but then `auth.uid()` inside the function is the machine, so `created_by` on
-- every receipt records the machine rather than the accountant who took the
-- money. On a receipts table that is deliberately append-only, losing who did
-- it is too high a price. Here `auth.uid()` is still the real person and the
-- audit trail stays true.
--
-- **It does not widen what anybody may do.** The role still comes from
-- `vppsone.staff_profiles`, which is the only place this app records one, and
-- `has_permission` decides what it means. An `office` account resolves to the
-- `office` arm, which grants no `payments:*` at all — so "office reads fees,
-- cannot post" (D-180) still holds at the database, not just in the app.
--
-- The two enums carry the same eight labels, so the cast through `text` is
-- total; a label present in one and not the other would raise rather than
-- silently resolve to anything.
create or replace function private.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path to 'public', 'auth', 'private'
as $function$
  select coalesce(
    -- The fee app's own answer, unchanged and still first.
    (
      select u.role
      from public.users as u
      where u.id = auth.uid()
        and u.is_active = true
      limit 1
    ),
    -- VPPS One's answer, consulted only when the fee app has never heard of
    -- this person. `vppsone.staff_profiles` is where this app records a role
    -- and the only place it does.
    (
      select sp.role::text::public.staff_role
      from vppsone.staff_profiles as sp
      where sp.user_id = auth.uid()
        and sp.is_active = true
      limit 1
    )
  );
$function$;

comment on function private.current_staff_role() is
  'The signed-in person''s fee role. public.users first, then vppsone.staff_profiles for accounts the fee app has no row for. See the migration header: this function is owned by School Fees and must be applied to the live fee database at cutover.';
