-- D-261 (11 Oct 2026, Janmejay): fee collectors post payments and print the
-- receipt. Applied to schoolfees-dev on 2026-10-11. NOT applied to the live fee
-- database (vgqyilgstjvgohrsiwkb): run it there only at the cutover, with the
-- owner's go-ahead, or fee collectors on VPPS One will be refused by
-- post_student_payment_with_adjustments ("You do not have permission…").
--
-- The only change from the function as it stands is two entries in the
-- fee_collector array: 'payments:write' and 'receipts:print'. Diff it against
-- live's definition before running; if live's body differs anywhere else,
-- carry those two entries into live's body instead of pasting this one.
CREATE OR REPLACE FUNCTION public.has_permission(p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'private'
AS $function$
  select auth.uid() is not null
    and case private.current_staff_role()
      when 'admin'::public.staff_role then true
      when 'accountant'::public.staff_role then p_permission = any (
        array[
          'dashboard:view',
          'students:view',
          'fees:view',
          'payments:view',
          'payments:write',
          'payments:waive_late_fee',
          'finance:view',
          'ledger:view',
          'receipts:view',
          'receipts:print',
          'defaulters:view',
          'imports:view',
          'reports:view',
          'settings:view'
        ]
      )
      when 'teacher'::public.staff_role then p_permission = any (
        array[
          'dashboard:view',
          'students:view',
          'students:edit_basic',
          'fees:view',
          'payments:view',
          'finance:view',
          'ledger:view',
          'receipts:view',
          'defaulters:view',
          'imports:view',
          'reports:view',
          'settings:view',
          'students:view_own_classes',
          'students:view_sensitive_own_classes',
          'timetable:view',
          'attendance:mark_own_classes',
          'notes:write_own_classes',
          'marks:enter_own',
          'reports:send_parent'
        ]
      )
      when 'fee_collector'::public.staff_role then p_permission = any (
        array[
          'dashboard:view',
          'students:view',
          'fees:view',
          'payments:view',
          'payments:write',
          'finance:view',
          'ledger:view',
          'receipts:view',
          'receipts:print',
          'defaulters:view',
          'contacts:write',
          'imports:view',
          'reports:view',
          'settings:view'
        ]
      )
      when 'view_only'::public.staff_role then p_permission = any (
        array[
          'dashboard:view',
          'students:view',
          'defaulters:view',
          'receipts:view'
        ]
      )
      when 'office'::public.staff_role then p_permission = any (
        array[
          'dashboard:view',
          'students:view',
          'students:view_own_classes',
          'students:view_all',
          'students:view_sensitive_all',
          'students:view_sensitive_own_classes',
          'students:edit_basic',
          'calendar:manage',
          'timetable:view',
          'attendance:mark_any',
          'attendance:view_all',
          'attendance:approve_corrections',
          'notes:view_all',
          'collection:create',
          'marks:view_all',
          'reports:academic',
          'exports:academic'
        ]
      )
      when 'academic_coordinator'::public.staff_role then p_permission = any (
        array[
          'dashboard:view',
          'students:view',
          'students:view_own_classes',
          'students:view_all',
          'students:view_sensitive_own_classes',
          'staff:assign',
          'calendar:manage',
          'timetable:view',
          'timetable:publish',
          'substitutions:manage',
          'attendance:mark_any',
          'attendance:view_all',
          'attendance:approve_corrections',
          'notes:view_all',
          'marks:view_all',
          'reports:academic'
        ]
      )
      when 'exam_coordinator'::public.staff_role then p_permission = any (
        array[
          'dashboard:view',
          'students:view',
          'students:view_own_classes',
          'students:view_all',
          'timetable:view',
          'attendance:view_all',
          'notes:view_all',
          'collection:create',
          'marks:enter_own',
          'marks:view_all',
          'assessments:manage',
          'assessments:lock',
          'reports:academic',
          'reports:send_parent',
          'exports:academic'
        ]
      )
      else false
    end;
$function$;
