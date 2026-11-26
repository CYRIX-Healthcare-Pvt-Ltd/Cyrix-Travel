/*
  te_0121 — A ride to Home in the middle of the day needs its visit photo, like a hospital (the user, 4 Nov: "this is a
  loop hole isnt? i can choose devi to home without pic"). The day's last ride is left out: End my day stands for it,
  as Start my day does for the first ride's From. From today for everyone ("start from today for all").
*/
insert into te_policy (key, value) values ('home_mid_photo_from', '"2026-11-04"') on conflict (key) do update set value = excluded.value;

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
    'home_from', (te_pol('home_mid_photo_from')) #>> '{}')
$function$;

do $$
declare f text;
  x_old text := $q$and x.to_lat is not null and lower(btrim(split_part(coalesce(x.to_name, ''), ',', 1))) <> 'home'$q$;
  r_old text := $q$and r.to_lat is not null and lower(btrim(split_part(coalesce(r.to_name, ''), ',', 1))) <> 'home'$q$;
  x_new text := $q$and x.to_lat is not null and (lower(btrim(split_part(coalesce(x.to_name, ''), ',', 1))) <> 'home'
       or (d.day >= coalesce((te_pol('home_mid_photo_from') #>> '{}')::date, '2999-12-31') and exists (select 1 from te_rides y where y.day_id = x.day_id and y.seq > x.seq)))$q$;
  r_new text := $q$and r.to_lat is not null and (lower(btrim(split_part(coalesce(r.to_name, ''), ',', 1))) <> 'home'
       or (d.day >= coalesce((te_pol('home_mid_photo_from') #>> '{}')::date, '2999-12-31') and exists (select 1 from te_rides y where y.day_id = r.day_id and y.seq > r.seq)))$q$;
begin
  f := pg_get_functiondef('public.te_rides_without_photo(uuid)'::regprocedure);
  if position(x_old in f) = 0 then raise exception 'te_rides_without_photo changed'; end if;
  execute replace(f, x_old, x_new);
  f := pg_get_functiondef('public.te_submit(uuid)'::regprocedure);
  if position(r_old in f) = 0 then raise exception 'te_submit changed'; end if;
  execute replace(f, r_old, r_new);
end $$;
