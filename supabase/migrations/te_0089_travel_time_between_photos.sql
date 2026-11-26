/*
  te_0089 — the travel time between a day's visit photos (the user, 30 Oct: "do the travel time check between photos";
  "sw admin can change km/h"): the km claimed between two photos over the time between them, set against the km/h each
  way of travel can do. Too fast is an observation the person sees too and can still save. SW Admin turns it on or off
  and sets the km/h; a flight is never checked.
*/
insert into te_policy (key, value) values
  ('photo_speed_on', 'true'::jsonb),
  ('photo_speeds', '{"bike": 60, "car": 80, "bus": 60, "train": 100, "metro": 80, "auto": 40, "taxi": 80, "taxi_bike": 60}'::jsonb)
on conflict (key) do nothing;

create or replace function public.te_set_policy(p_key text, p_value jsonb)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  if p_key in ('visit_photos', 'photo_near_m', 'photo_skips', 'photo_after', 'photo_keep_days', 'photo_speed_on', 'photo_speeds') and not is_sw_admin() then
    raise exception 'Only SW Admin sets visit photos';
  end if;
  if p_key = 'photo_speeds' and (jsonb_typeof(p_value) <> 'object' or exists (
       select 1 from jsonb_each(p_value) e
        where e.key not in ('bike', 'car', 'bus', 'train', 'metro', 'auto', 'taxi', 'taxi_bike')
           or jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric not between 5 and 300)) then
    raise exception 'Give each a speed from 5 to 300 km/h';
  end if;
  update te_policy set value = p_value, updated_at = now() where key = p_key;
  if not found then raise exception 'No such setting'; end if;
end $function$;

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
    'speeds', coalesce(te_pol('photo_speeds'), '{}'::jsonb))
$function$;
