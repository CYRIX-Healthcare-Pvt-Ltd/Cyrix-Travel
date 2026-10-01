/*
  te_0002 — the module's row, switched off, so it can be given to the test accounts.

  employee_modules points at app_modules, so nobody can be given Travel
  Expense until its row exists. It goes in inactive: the portal shows no tile
  for it until the app is deployed and the row is switched on. The user,
  1 Oct: "starting, we can test with dummy id" — E8888 (the engineer) and
  E9999 (his manager) get it.
*/
insert into public.app_modules (code, name, description, path, icon, sort_order, is_active)
values ('travel', 'Travel Expense', 'Record a trip leg by leg and claim its travel.', '/travel', 'Navigation', 60, false)
on conflict (code) do nothing;

insert into public.employee_modules (employee_id, module_code)
select e.id, 'travel' from public.employees e where e.ecode in ('E8888', 'E9999')
on conflict do nothing;
