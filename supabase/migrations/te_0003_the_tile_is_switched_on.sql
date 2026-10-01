/*
  te_0003 — the tile is switched on.

  te_0002 put the module's row in switched off, so that it could be given to
  the test accounts before there was anything at app.cyrix.in/travel to open.
  The app is deployed and the portal forwards /travel to it, so the row goes
  on: the portal shows the tile to the people who hold the module, and the
  software administrator's module list — which offers active modules only —
  gains Travel Expense, so it can be given to the engineers and to the
  managers who approve them.

  Nobody gains access by this. Who may use the module is who holds it in
  employee_modules, and this changes no row there.
*/
update public.app_modules set is_active = true where code = 'travel';
