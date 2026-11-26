/*
  te_0143 — The km band of te_0142 is set in Travel Expense → Settings (the user, 9 Nov: "here add that"): every
  started "Km band" of map km allows "Km allowed over the map a band" more without a Google Maps screenshot; 10 and 1
  to begin with, so te_0142's rule stands until they are changed. The person is not told the limit.
*/
insert into public.te_policy (key, value) values ('km_band_km', '10'), ('km_band_extra_km', '1')
on conflict (key) do nothing;

create or replace function public.te_km_allowed(p_map numeric)
returns numeric language sql stable set search_path to 'public' as $f$
  select round(p_map + (floor(p_map / b.every) + 1) * b.extra, 1)
  from (select greatest(coalesce((te_pol('km_band_km') #>> '{}')::numeric, 10), 0.1) as every,
               greatest(coalesce((te_pol('km_band_extra_km') #>> '{}')::numeric, 1), 0) as extra) b
$f$;

-- The two band settings take sensible numbers only; the rest as te_0103.
create or replace function public.te_set_policy(p_key text, p_value jsonb)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  if p_key in ('visit_photos', 'photo_near_m', 'photo_skips', 'photo_after', 'photo_keep_days', 'photo_speed_on', 'photo_speeds') and not is_sw_admin() then
    raise exception 'Only SW Admin sets visit photos';
  end if;
  if p_key = 'home_changes_month' then
    if not is_sw_admin() then raise exception 'Only SW Admin sets home changes a month'; end if;
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 1 and 31 then
      raise exception 'Give a number from 1 to 31';
    end if;
  end if;
  if p_key = 'km_band_km' and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 1 and 100) then
    raise exception 'Give a km band from 1 to 100';
  end if;
  if p_key = 'km_band_extra_km' and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 0 and 50) then
    raise exception 'Give the km from 0 to 50';
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
