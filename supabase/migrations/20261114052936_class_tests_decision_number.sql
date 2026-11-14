-- Class tests are D-609. The first apply of 20261114044459 named them D-608,
-- which is the sign-in decision; this sets the two table comments right.
comment on table vppsone.class_tests is
  'A test a teacher takes for her class, any day, out of any marks (D-609). Never a column on a result by itself; counts_in names the school exam whose sheet may be filled from it, with the teacher''s check.';
comment on table vppsone.class_test_marks is
  'One child''s mark in one class test (D-609). NULL value with absent false is a cleared box: blank, never a zero.';
