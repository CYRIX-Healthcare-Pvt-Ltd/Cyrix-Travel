/*
  te_0159 — The home circle, a Setting (the user, 14 Nov: "we need to change 500m to 3 km", then "add Home circle").
  Within this many km of the saved home, a Start or End my day is "Home"; beyond it, "away from home". 3 km to begin
  (was 500 m in the app). Every start and end the app reads now carries 'home_limit' (metres) beside 'home_m', so the
  app, the claim's observations and SW Admin's Watch all follow SW Admin → Travel Expense → Settings → Home circle, km.
  The Home ↔ Work commute rule (300 m) is a different rule and is not changed.
*/
insert into public.te_policy (key, value) values ('home_km', '3'::jsonb) on conflict (key) do nothing;

create or replace function public.te_home_limit_m()
returns numeric language sql stable security definer set search_path to 'public' as $f$
  select coalesce((te_pol('home_km') #>> '{}')::numeric, 3) * 1000
$f$;
revoke all on function public.te_home_limit_m() from public, anon;
grant execute on function public.te_home_limit_m() to authenticated;

do $mig$
declare f text; d text; n text;
begin
  -- Each start and end: its home circle with it.
  foreach f in array array['te_my_day', 'te_my_starts', 'te_my_ends', 'te_claim_starts'] loop
    d := pg_get_functiondef(('public.' || f)::regproc);
    n := regexp_replace(d,
      '(''home_m'', \(select round\(te_m\(h\.lat, h\.lng, ([se])\.lat, \2\.lng\)\) from travel_homes h where h\.employee_id = \2\.employee_id\))',
      '\1, ''home_limit'', te_home_limit_m()', 'g');
    if n = d then raise exception '%: nothing replaced', f; end if;
    execute n;
  end loop;

  -- Watch: "Day not started from home" by the same circle (it was 1 km).
  d := pg_get_functiondef('public.te_watch'::regproc);
  n := replace(d, '))) > 1
      and (p.to_name ilike ''%home%''', '))) > te_home_limit_m() / 1000.0
      and (p.to_name ilike ''%home%''');
  n := replace(n, 'h.lng) / 2), 2))) <= 1))
    union all', 'h.lng) / 2), 2))) <= te_home_limit_m() / 1000.0))
    union all');
  if n = d then raise exception 'te_watch: nothing replaced'; end if;
  execute n;

  -- The setting: SW Admin only, 0.1 to 20 km.
  d := pg_get_functiondef('public.te_set_policy'::regproc);
  n := replace(d, '  update te_policy set value = p_value, updated_at = now() where key = p_key;',
    '  if p_key = ''home_km'' then
    if not is_sw_admin() then raise exception ''Only SW Admin sets the home circle''; end if;
    if jsonb_typeof(p_value) <> ''number'' or (p_value #>> ''{}'')::numeric not between 0.1 and 20 then
      raise exception ''Give the home circle from 0.1 to 20 km'';
    end if;
  end if;
  update te_policy set value = p_value, updated_at = now() where key = p_key;');
  if n = d then raise exception 'te_set_policy: nothing replaced'; end if;
  execute n;
end $mig$;
