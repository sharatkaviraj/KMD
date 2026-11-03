-- ============================================================================
-- VPPS One fee-migration (One-only): every online-payment switch starts OFF on
-- One's database (go-live Phase E, plan §7.6; critique0 #21).
--
-- Why this differs from the fees app: on the fees app these are live settings
-- the office has been switching since 28 Oct. On One's database they are
-- One's own (scripts/migrate/lib/import-rules.mjs keeps every
-- `online_payment_*` key out of the mirror), and One takes no online money
-- until cutover step C7. The replica carried two of them 'true'
-- (online_payment_waive_late_fees, online_payment_staff_whatsapp_enabled);
-- both go 'false' here, and the five that were missing are written 'false' so
-- every one reads as a decision, not an absence. The values each takes at C7,
-- and the order they are switched on in, are in docs/cutover/RAZORPAY.md.
--
-- The seven are ONLINE_SWITCH_KEYS (src/modules/payments/domain/online/switches.ts),
-- the only keys setOnlineSwitchAction writes. The staff-alert switch is not
-- one of them (Phase 8) but is turned off too: nothing in One sends staff
-- alerts yet, and it must not start the day Phase 8 lands.
-- `online_payment_order_max_rupees` keeps its value (100000, the fees app's).
--
-- Each is registered in vppsone.one_owned_fee_settings, so a load or a
-- reconcile never treats One's value as drift from the fees app's.
--
-- Rollback: none needed; setting a switch is done on the online-payments
-- screen (/fees/payments/online) by a real admin, once fee writes are open.
-- ============================================================================

insert into public.app_settings (key, value, updated_at)
select key, 'false', now()
from (values
  ('online_payment_links_enabled'),
  ('online_payment_checkout_enabled'),
  ('online_payment_auto_posting_enabled'),
  ('online_payment_receipts_enabled'),
  ('online_payment_checkout_all_sessions'),
  ('online_payment_checkout_modal_enabled'),
  ('online_payment_waive_late_fees'),
  ('online_payment_staff_whatsapp_enabled')
) as k(key)
on conflict (key) do update set value = 'false', updated_at = now()
where public.app_settings.value is distinct from 'false';

insert into vppsone.one_owned_fee_settings (source_table, row_key, column_name, reason)
select 'app_settings', key, 'value',
       'An online-payment switch (go-live Phase E): One''s own, off until cutover step C7 (docs/cutover/RAZORPAY.md).'
from (values
  ('online_payment_links_enabled'),
  ('online_payment_checkout_enabled'),
  ('online_payment_auto_posting_enabled'),
  ('online_payment_receipts_enabled'),
  ('online_payment_checkout_all_sessions'),
  ('online_payment_checkout_modal_enabled'),
  ('online_payment_waive_late_fees'),
  ('online_payment_staff_whatsapp_enabled'),
  ('online_payment_order_max_rupees')
) as k(key)
on conflict do nothing;
