/* te_0155 — a day not ended stays open until it is ended, and no visit photo is taken while it is open
   (the user, 13 Nov: E1997 started 12 Nov, never ended it, took a visit photo on 13 Nov without pressing
   anything, and the app showed Start my day instead of End 12 Nov).
   · te_open_day no longer lets a photo taken today hide the open day: only today's Start my day did that, and
     Start my day is refused while a day is open, so the open day now shows until it is ended.
   · te_photo_add refuses today's photo while a day is open: "End 12 Nov first". A late-night "Visit of <day>"
     photo (p_day given) is that open day's own and is still taken. */
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
     and w.d >= coalesce(te_end_first_from(p_emp), '2999-12-31')
     and not exists (select 1 from te_day_ends e where e.employee_id = p_emp and e.day = w.d)
     and not exists (select 1 from te_day_starts s where s.employee_id = p_emp and s.day = t.today)
$$;
revoke all on function public.te_open_day(uuid) from public, anon, authenticated;

do $$
declare f text; a text;
begin
  f := pg_get_functiondef('public.te_photo_add(text, double precision, double precision, real, timestamptz, text, text, text, text, date, timestamptz)'::regprocedure);
  a := $q$  if exists (select 1 from te_day_ends e where e.employee_id = me$q$;
  if position(a in f) = 0 then raise exception 'te_photo_add changed'; end if;
  execute replace(f, a, $q$  -- A day not ended is ended before today's photos (te_0155).
  if p_day is null and te_open_day(me) is not null then
    raise exception 'End % first', to_char(te_open_day(me), 'FMDD Mon');
  end if;
$q$ || a);
end $$;
