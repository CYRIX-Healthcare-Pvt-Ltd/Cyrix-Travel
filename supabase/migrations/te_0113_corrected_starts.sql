/*
  te_0113 — a day's start moved by SW Admin (the user, 4 Nov: Amalraj P V E2482 and Sankeerth R E2346 pressed Start my
  day at the hospital, "can you change start my day as home location"): the start says so, and Watch does not time the
  ride from it — the press time is when they were at the hospital, not when they left home.
*/
alter table public.te_day_starts add column if not exists fixed_note text;
alter table public.te_day_starts add column if not exists fixed_at timestamptz;

update public.te_day_starts s set fixed_note = 'Pressed at the hospital; moved to home by SW Admin', fixed_at = now()
  from public.employees e
 where e.id = s.employee_id and e.ecode in ('E2482', 'E2346') and s.day = '2026-11-04' and s.fixed_note is null;

do $$
declare f text;
  was text := $q$from te_day_starts s join real r on r.id = s.employee_id where s.day between f and t$q$;
begin
  f := pg_get_functiondef('public.te_watch(date, date)'::regprocedure);
  if position(was in f) = 0 then raise exception 'te_watch changed'; end if;
  execute replace(f, was, was || ' and s.fixed_note is null');
end $$;
