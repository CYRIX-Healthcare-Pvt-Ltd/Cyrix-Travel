/*
  te_0150 — a day is ended before the next one starts, and before it is claimed (the user, 12 Nov).

  About half of those who press Start my day never press End my day, and 5–6 a morning start the new day with the
  day before still open, which hides the "<day> trip" box for good.
    · "dont show start my day if not ended 11 nov": while the last day worked (started or photographed) is not
      ended, Start my day is refused — "End 11 Nov first" — and the app shows End 11 Nov in its place. The last day
      worked, not only yesterday: a Saturday not ended is ended on Monday (te_open_day; the box's Visit of <day>
      stays yesterday's only, te_late_day).
    · End 11 Nov keeps where the phone is, as End my day always has ("get end my day location also"). Pressed the
      next morning, the claim does not tie the last ride to it: "if end my day is long distance take last ride
      location only but just observation" — far from the last ride's To it is an observation, in yellow.
    · "without ending the day dont let them claim it": a claim with a day started or photographed and not ended is
      not sent — "End my day for 11 Nov first".
  From te_policy 'end_first_from' (te_rule_from: the test accounts from today; everybody once the date is set).
*/
insert into public.te_policy (key, value) values ('end_first_from', to_jsonb('2999-12-31'::text)) on conflict (key) do nothing;

-- The last day worked before today, not ended, while today is not started: the one to end first.
create or replace function public.te_open_day(p_emp uuid) returns date
 language sql stable security definer set search_path to 'public' as $$
  with t as (select (now() at time zone 'Asia/Kolkata')::date as today),
  w as (
    select max(x.day) d from (
      select s.day from te_day_starts s, t where s.employee_id = p_emp and s.day < t.today
      union all
      select v.day from te_visit_photos v, t where v.employee_id = p_emp and v.day < t.today) x)
  select w.d from w, t
   where w.d is not null
     and w.d >= coalesce(te_rule_from('end_first_from', p_emp), '2999-12-31')
     and not exists (select 1 from te_day_ends e where e.employee_id = p_emp and e.day = w.d)
     and not exists (select 1 from te_day_starts s where s.employee_id = p_emp and s.day = t.today)
     and not exists (select 1 from te_visit_photos v where v.employee_id = p_emp and v.day = t.today)
$$;
revoke all on function public.te_open_day(uuid) from public, anon, authenticated;

do $$
declare f text; a text; b text;
begin
  -- Start my day: the open day first.
  f := pg_get_functiondef('public.te_start_day(double precision, double precision, real, text)'::regprocedure);
  a := $q$  if exists (select 1 from te_day_starts where employee_id = me and day = today) then
    raise exception 'Your day is already started';
  end if;
$q$;
  if position(a in f) = 0 then raise exception 'te_start_day changed'; end if;
  execute replace(f, a, a || $q$  -- The last day worked, still open: ended first (te_0150).
  if te_open_day(me) is not null then
    raise exception 'End % first', to_char(te_open_day(me), 'FMDD Mon');
  end if;
$q$);

  -- End my day ends the open day when there is one (a Saturday, on Monday).
  f := pg_get_functiondef('public.te_end_day(double precision, double precision, real, text)'::regprocedure);
  a := $q$coalesce(te_late_day(current_employee_id()), (now() at time zone 'Asia/Kolkata')::date)$q$;
  if position(a in f) = 0 then raise exception 'te_end_day changed'; end if;
  execute replace(f, a, $q$coalesce(te_late_day(current_employee_id()), te_open_day(current_employee_id()), (now() at time zone 'Asia/Kolkata')::date)$q$);

  -- The app is told the open day.
  f := pg_get_functiondef('public.te_my_day()'::regprocedure);
  a := $q$'late_day', te_late_day(current_employee_id()))$q$;
  if position(a in f) = 0 then raise exception 'te_my_day changed'; end if;
  execute replace(f, a, $q$'late_day', te_late_day(current_employee_id()), 'open_day', te_open_day(current_employee_id()))$q$);

  -- The claim is told from when a day must be ended.
  f := pg_get_functiondef('public.te_claim_starts(uuid)'::regprocedure);
  a := $q$'end_from', te_rule_from('day_end_from', c.employee_id),$q$;
  if position(a in f) = 0 then raise exception 'te_claim_starts changed'; end if;
  execute replace(f, a, a || $q$
    'end_first_from', te_rule_from('end_first_from', c.employee_id),$q$);

  -- A day started or photographed and not ended is not claimed.
  f := pg_get_functiondef('public.te_submit(uuid)'::regprocedure);
  a := $q$  if not exists (select 1 from te_days where claim_id = p_claim) then raise exception 'Add at least one day first'; end if;
$q$;
  if position(a in f) = 0 then raise exception 'te_submit changed'; end if;
  execute replace(f, a, a || $q$  -- End my day for each day started or photographed (te_0150).
  select string_agg(to_char(d.day, 'FMDD Mon'), ', ' order by d.day) into missing
    from te_days d
   where d.claim_id = p_claim and d.day >= coalesce(te_rule_from('end_first_from', c.employee_id), '2999-12-31')
     and (exists (select 1 from te_day_starts s where s.employee_id = c.employee_id and s.day = d.day)
          or exists (select 1 from te_visit_photos v where v.employee_id = c.employee_id and v.day = d.day))
     and not exists (select 1 from te_day_ends e where e.employee_id = c.employee_id and e.day = d.day);
  if missing is not null then raise exception 'End my day for % first', missing; end if;
$q$);
end $$;

-- Pushed 12 Nov: for everybody from 12 Nov (the user: "make changes to all"; 11 Nov and before never block a claim).
update public.te_policy set value = to_jsonb('2026-11-12'::text) where key = 'end_first_from';
