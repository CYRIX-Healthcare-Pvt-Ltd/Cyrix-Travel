/*
  te_0108 — late night work and the photo at home (the user, 4 Nov).

  "Visit of 3 Nov": after midnight, until the new day is started (no time limit: "Time limit 6am not needed"), a visit
  photo can be kept on the day before, with its real time; such a photo does not start the new day. It is offered when
  the day before was started or has photos, and today has neither a start nor a photo of its own.

  The ride home needs its photo like any other ride ("last ride to image mandatory like other rides"), for days from
  home_photo_from (4 Nov, for everyone: "start from today for all").
*/
insert into te_policy (key, value) values ('home_photo_from', '"2026-11-04"') on conflict (key) do nothing;

-- The day before, while its trip may still go on; else null.
create or replace function public.te_late_day(p_emp uuid) returns date
 language sql stable security definer set search_path to 'public' as $$
  select y from (select (now() at time zone 'Asia/Kolkata')::date - 1 as y, (now() at time zone 'Asia/Kolkata')::date as t) d
   where (exists (select 1 from te_day_starts s where s.employee_id = p_emp and s.day = d.y)
          or exists (select 1 from te_visit_photos v where v.employee_id = p_emp and v.day = d.y))
     and not exists (select 1 from te_day_starts s where s.employee_id = p_emp and s.day = d.t)
     and not exists (select 1 from te_visit_photos v where v.employee_id = p_emp and v.day = d.t)
$$;
revoke all on function public.te_late_day(uuid) from public, anon, authenticated;

create or replace function public.te_my_day()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'required', coalesce(te_rule_from('day_start_from', current_employee_id()) <= (now() at time zone 'Asia/Kolkata')::date, false),
    'start', (select jsonb_build_object('at', s.at, 'lat', s.lat, 'lng', s.lng, 'place', s.place,
                'home_m', (select round(te_m(h.lat, h.lng, s.lat, s.lng)) from travel_homes h where h.employee_id = s.employee_id))
              from te_day_starts s where s.employee_id = current_employee_id() and s.day = (now() at time zone 'Asia/Kolkata')::date),
    'late_day', te_late_day(current_employee_id()))
$$;

-- p_day: the day before, for a visit of its trip after midnight.
drop function if exists public.te_photo_add(text, double precision, double precision, real, timestamp with time zone, text, text, text, text);
create or replace function public.te_photo_add(p_path text, p_lat float8, p_lng float8, p_acc real, p_shot_at timestamptz, p_place text, p_sha256 text,
  p_device_id text default null, p_device text default null, p_day date default null)
 returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare me uuid := current_employee_id(); v te_visit_photos;
begin
  if me is null then raise exception 'Sign in again'; end if;
  if not coalesce((te_pol('visit_photos'))::text::boolean, false) then raise exception 'Visit photos are switched off'; end if;
  if split_part(p_path, '/', 1) <> me::text then raise exception 'Not your folder'; end if;
  if p_shot_at > now() + interval '5 minutes' then raise exception 'The phone''s clock is ahead. Set the right time, then take the photo again'; end if;
  if p_shot_at < now() - interval '2 days' then raise exception 'This photo is too old to add'; end if;
  if p_sha256 is not null and exists (select 1 from te_visit_photos where employee_id = me and sha256 = p_sha256) then raise exception 'This photo is added already'; end if;
  if p_day is not null and (p_day is distinct from te_late_day(me) or p_day <> (p_shot_at at time zone 'Asia/Kolkata')::date - 1) then
    raise exception 'The trip of % is closed. Start your day', to_char(p_day, 'FMDD Mon');
  end if;
  insert into te_visit_photos (employee_id, day, shot_at, lat, lng, accuracy, place, path, sha256, device_id, device)
  values (me, coalesce(p_day, (p_shot_at at time zone 'Asia/Kolkata')::date), p_shot_at, p_lat, p_lng, p_acc, nullif(btrim(p_place), ''), p_path, p_sha256,
    left(nullif(btrim(p_device_id), ''), 64), left(nullif(btrim(p_device), ''), 80))
  returning * into v;
  return to_jsonb(v);
end $$;
revoke all on function public.te_photo_add(text, double precision, double precision, real, timestamp with time zone, text, text, text, text, date) from public, anon;
grant execute on function public.te_photo_add(text, double precision, double precision, real, timestamp with time zone, text, text, text, text, date) to authenticated;

create or replace function public.te_visit_setup()
 returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object(
    'on', coalesce((te_pol('visit_photos'))::text::boolean, false),
    'near_m', coalesce((te_pol('photo_near_m'))::text::numeric, 500),
    'skips', coalesce((te_pol('photo_skips'))::text::int, 3),
    'after', coalesce(te_pol('photo_after') #>> '{}', 'block'),
    'keep_days', coalesce((te_pol('photo_keep_days'))::text::int, 90),
    'needs', (select coalesce(jsonb_agg(label order by sort), '[]') from te_purposes where photo_needed and is_active),
    'speed_on', coalesce((te_pol('photo_speed_on'))::text::boolean, true),
    'speeds', coalesce(te_pol('photo_speeds'), '{}'::jsonb),
    'home_from', te_rule_from('home_photo_from', current_employee_id()))
$function$;

-- The ride home is matched and asked for like the others from home_photo_from: the two live definitions, home let in.
do $$
declare f text;
begin
  f := pg_get_functiondef('public.te_rides_without_photo(uuid)'::regprocedure);
  if position($q$and x.to_lat is not null and lower(btrim(split_part(coalesce(x.to_name, ''), ',', 1))) <> 'home'$q$ in f) = 0 then raise exception 'te_rides_without_photo changed'; end if;
  f := replace(f, $q$and x.to_lat is not null and lower(btrim(split_part(coalesce(x.to_name, ''), ',', 1))) <> 'home'$q$,
    $q$and x.to_lat is not null and (lower(btrim(split_part(coalesce(x.to_name, ''), ',', 1))) <> 'home' or d.day >= coalesce(te_rule_from('home_photo_from', owner), '2999-12-31'))$q$);
  execute f;
  f := pg_get_functiondef('public.te_submit(uuid)'::regprocedure);
  if position($q$and r.to_lat is not null and lower(btrim(split_part(coalesce(r.to_name, ''), ',', 1))) <> 'home'$q$ in f) = 0 then raise exception 'te_submit changed'; end if;
  f := replace(f, $q$and r.to_lat is not null and lower(btrim(split_part(coalesce(r.to_name, ''), ',', 1))) <> 'home'$q$,
    $q$and r.to_lat is not null and (lower(btrim(split_part(coalesce(r.to_name, ''), ',', 1))) <> 'home' or d.day >= coalesce(te_rule_from('home_photo_from', c.employee_id), '2999-12-31'))$q$);
  execute f;
end $$;
