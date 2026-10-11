-- D-261: fee collectors take money at the Payment Desk (fees:collect); the back
-- office (closing the day, reversals, bank books, refunds, bulk entry,
-- pausing reminders) moves to a new fees:accounts held by the accountant and
-- the admin. Rows only; additive.
insert into vppsone.role_permissions (role, permission) values
  ('admin', 'fees:accounts'),
  ('accountant', 'fees:accounts'),
  ('fee_collector', 'fees:collect')
on conflict do nothing;
