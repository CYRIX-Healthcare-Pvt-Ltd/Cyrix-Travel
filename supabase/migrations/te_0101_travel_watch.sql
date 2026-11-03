/*
  te_0101 — Watch, under SW Admin's Reports (the user, 3 Nov, the demo's first day: "field eng started using expense
  modules. lets see where they manipulate", then "can you make it in sw admin? like new refresh new summary"): the
  same checks as that first look, run on drafts as well as sent claims, real people only (no test accounts).

  Signs, each with its weight:
    bill_low      red    a bill reads well under what is claimed against it (₹1 read for ₹2,000)
    home_unset    red    a ride from "home" with no home saved in My profile
    home_map      amber  the home was placed on the map, not "I'm here"; with how far it is from the day's first photo
    home_moved    amber  the home moved in the period, and by how much
  A sign about a place carries its point, which the page names and links to the map (the user, 3 Nov: "where is that
  Koyilandy details?").
    other_big     amber  an Other expense of ₹1,000 or more
    fare_high     amber  an auto or taxi over 1.5 times the policy fare: the minimum fare for the first km (1.5), then the fare a km
    km_over       red    claimed km more than the allowed % over the map
    no_photo_near amber  a ride's destination with no visit photo within 1 km that day (rides home not counted)
    photo_late    amber  a visit photo saved 15 minutes or more after it was taken
    too_fast      red    a visit photo (or the day's start) to the next faster than the policy's car km/h
    short_visit   amber  under 10 minutes at a place, the road time to the next photo taken off
    long_gap      amber  4 hours or more at a place, the same way
    day_unstarted amber  a day with rides and no Start my day (from te_policy day_start_from)
    start_away    amber  a day's first ride starts over 1 km from home when the last ride before it ended at home
  Null dates: all time. (A bill attached to nothing was dropped the same day: saving a day deletes such a bill, so it
  is only ever a day still being typed in, not a sign.)
*/
-- The minimum auto fare covers the first 1.5 km; ₹15 a km after it (the user, 3 Nov).
insert into public.te_policy (key, value) values ('auto_min_km', to_jsonb(1.5)) on conflict (key) do nothing;

create or replace function public.te_watch(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f date := coalesce(p_from, '2000-01-01');
  t date := coalesce(p_to, '2999-12-31');
  tol numeric := coalesce((te_pol('km_tolerance_pct') #>> '{}')::numeric, 10);
  auto_km numeric := coalesce((te_pol('auto_per_km') #>> '{}')::numeric, 15);
  auto_min numeric := coalesce((te_pol('auto_min_fare') #>> '{}')::numeric, 30);
  fast numeric := coalesce((select max(e.value #>> '{}')::numeric from jsonb_each(te_pol('photo_speeds')) e where e.key not in ('train', 'flight')), 80);
  auto_min_km numeric := coalesce((te_pol('auto_min_km') #>> '{}')::numeric, 1.5);
  out jsonb;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin sees this'; end if;
  with real as (
    select x.id, x.ecode, x.full_name, nullif(btrim(x.function_name), '') fn, te_person_label(x.reporting_manager_id) manager
    from employees x where x.ecode not in ('E6666', 'E7777', 'E8888', 'E9999') and x.full_name not ilike '%- test%'
  ), dd as (
    select d.*, c.employee_id, c.number, c.status from te_days d join te_claims c on c.id = d.claim_id
    join real r on r.id = c.employee_id where d.day between f and t
  ), sign as (
    -- A bill reading well under its amount.
    select dd.employee_id, dd.day, dd.number, dd.status, 'bill_low' kind, 'red' weight,
      coalesce(e.category, 'Expense') || ': ₹' || round(e.amount) || ' claimed, bill reads ₹' || round(b.ocr_amount, 2) detail, e.amount amount, null::jsonb point
    from te_bills b join te_expenses e on b.owner_kind = 'expense' and e.id = b.owner_id join dd on dd.id = e.day_id
    where b.ocr_amount is not null and e.amount >= 100 and b.ocr_amount < e.amount * 0.5
    union all
    select dd.employee_id, dd.day, dd.number, dd.status, 'bill_low', 'red',
      initcap(x.mode) || ' ' || coalesce(x.from_name, '') || ' → ' || coalesce(x.to_name, '') || ': ₹' || round(x.amount) || ' claimed, bill reads ₹' || round(b.ocr_amount, 2) || coalesce(' · ₹' || round(x.amount / nullif(coalesce(x.claimed_km, x.map_km), 0), 1) || '/km', ''), x.amount, null
    from te_bills b join te_rides x on b.owner_kind = 'ride' and x.id = b.owner_id join dd on dd.id = x.day_id
    where b.ocr_amount is not null and x.amount >= 100 and b.ocr_amount < x.amount * 0.5
    union all
    select dd.employee_id, dd.day, dd.number, dd.status, 'bill_low', 'red',
      'Room stay ' || coalesce(h.name, '') || ': ₹' || round(h.amount) || ' claimed, bill reads ₹' || round(b.ocr_amount, 2), h.amount, null
    from te_bills b join te_hotels h on b.owner_kind = 'hotel' and h.id = b.owner_id join dd on dd.id = h.day_id
    where b.ocr_amount is not null and h.amount >= 100 and b.ocr_amount < h.amount * 0.5
    union all
    -- From "home" with no home saved.
    select dd.employee_id, dd.day, dd.number, dd.status, 'home_unset', 'red',
      initcap(x.mode) || ' from "' || x.from_name || '" → ' || coalesce(x.to_name, '') || ', ' || coalesce(x.claimed_km, x.map_km) || ' km, ₹' || coalesce(round(x.amount), 0) || coalesce(' · ₹' || round(x.amount / nullif(coalesce(x.claimed_km, x.map_km), 0), 1) || '/km', '') || ' — no home saved in My profile', x.amount, jsonb_build_object('lat', x.from_lat, 'lng', x.from_lng)
    from te_rides x join dd on dd.id = x.day_id
    where x.from_name ilike '%home%' and not exists (select 1 from travel_homes h where h.employee_id = dd.employee_id)
    union all
    -- A day that starts away from home when the ride before it ended at home (the user, 3 Nov: "yesterday i closed
    -- the claim at home, but today i started not from home, so that also in observation").
    select dd.employee_id, dd.day, dd.number, dd.status, 'start_away', 'amber',
      'Started from "' || coalesce(x.from_name, '') || '", ' || round((6371 * 2 * asin(sqrt(power(sin(radians(x.from_lat - h.lat) / 2), 2) + cos(radians(h.lat)) * cos(radians(x.from_lat)) * power(sin(radians(x.from_lng - h.lng) / 2), 2))))::numeric, 1)
        || ' km from home; ' || to_char(p.day, 'DD Mon') || ' ended at home', x.amount, jsonb_build_object('lat', x.from_lat, 'lng', x.from_lng)
    from dd
    join travel_homes h on h.employee_id = dd.employee_id
    join lateral (select x.* from te_rides x where x.day_id = dd.id order by x.seq limit 1) x on true
    join lateral (select pd.day, px.to_name, px.to_lat, px.to_lng from te_rides px join te_days pd on pd.id = px.day_id join te_claims pc on pc.id = pd.claim_id
                  where pc.employee_id = dd.employee_id and pd.day < dd.day order by pd.day desc, px.seq desc limit 1) p on true
    where x.from_lat is not null and 6371 * 2 * asin(sqrt(power(sin(radians(x.from_lat - h.lat) / 2), 2) + cos(radians(h.lat)) * cos(radians(x.from_lat)) * power(sin(radians(x.from_lng - h.lng) / 2), 2))) > 1
      and (p.to_name ilike '%home%' or (p.to_lat is not null and 6371 * 2 * asin(sqrt(power(sin(radians(p.to_lat - h.lat) / 2), 2) + cos(radians(h.lat)) * cos(radians(p.to_lat)) * power(sin(radians(p.to_lng - h.lng) / 2), 2))) <= 1))
    union all
    -- More than the allowed % over the map.
    select dd.employee_id, dd.day, dd.number, dd.status, 'km_over', 'red',
      initcap(x.mode) || ' ' || coalesce(x.from_name, '') || ' → ' || coalesce(x.to_name, '') || ': ' || x.claimed_km || ' km claimed, map ' || x.map_km || ' km' || coalesce(' · ₹' || round(x.amount / nullif(coalesce(x.claimed_km, x.map_km), 0), 1) || '/km', ''), x.amount, null
    from te_rides x join dd on dd.id = x.day_id
    where x.map_km > 0 and x.claimed_km > x.map_km * (1 + tol / 100)
    union all
    -- An auto or taxi well over the policy's fare a km (₹200 for 5.8 km by auto, 3 Nov).
    select dd.employee_id, dd.day, dd.number, dd.status, 'fare_high', 'amber',
      initcap(replace(x.mode, '_', ' ')) || ' ' || coalesce(x.from_name, '') || ' → ' || coalesce(x.to_name, '') || ': ₹' || round(x.amount) || ' for '
        || coalesce(x.claimed_km, x.map_km) || ' km' || coalesce(' · ₹' || round(x.amount / nullif(coalesce(x.claimed_km, x.map_km), 0), 1) || '/km', '') || ', policy fare ₹' || round(auto_min + greatest(coalesce(x.claimed_km, x.map_km) - auto_min_km, 0) * auto_km), x.amount, null
    from te_rides x join dd on dd.id = x.day_id
    where x.mode in ('auto', 'taxi', 'taxi_bike') and coalesce(x.claimed_km, x.map_km) > 0 and x.amount > auto_min
      and x.amount > (auto_min + greatest(coalesce(x.claimed_km, x.map_km) - auto_min_km, 0) * auto_km) * 1.5
    union all
    -- A big Other expense.
    select dd.employee_id, dd.day, dd.number, dd.status, 'other_big', 'amber',
      'Other ₹' || round(e.amount) || coalesce(': ' || left(e.description, 120), ''), e.amount, null
    from te_expenses e join dd on dd.id = e.day_id where e.category = 'Other' and e.amount >= 1000
    union all
    -- A destination with no visit photo near it that day.
    select dd.employee_id, dd.day, dd.number, dd.status, 'no_photo_near', 'amber',
      initcap(x.mode) || ' to ' || coalesce(x.to_name, '?') || coalesce(' (“' || x.photo_skip || '”)', '') || ' — no visit photo within 1 km that day', x.amount, jsonb_build_object('lat', x.to_lat, 'lng', x.to_lng)
    from te_rides x join dd on dd.id = x.day_id
    where x.to_lat is not null and coalesce(x.to_name, '') not ilike '%home%' and not coalesce(x.commute, false)
      and not exists (select 1 from te_visit_photos p where p.employee_id = dd.employee_id and p.day = dd.day and p.removed_at is null
        and 6371 * 2 * asin(sqrt(power(sin(radians(p.lat - x.to_lat) / 2), 2) + cos(radians(x.to_lat)) * cos(radians(p.lat)) * power(sin(radians(p.lng - x.to_lng) / 2), 2))) <= 1)
    union all
    -- A photo saved long after it was taken.
    select p.employee_id, p.day, null, null, 'photo_late', 'amber',
      coalesce(p.place, 'Visit photo') || ': taken ' || to_char(p.taken_at at time zone 'Asia/Kolkata', 'HH12:MI AM') || ', saved ' || to_char(p.shot_at at time zone 'Asia/Kolkata', 'HH12:MI AM'), null, jsonb_build_object('lat', p.lat, 'lng', p.lng)
    from te_visit_photos p join real r on r.id = p.employee_id
    where p.day between f and t and p.removed_at is null and p.taken_at is not null and p.shot_at - p.taken_at >= interval '15 minutes'
    union all
    -- A home placed on the map, with how far it is from the first photo of each day in the period.
    select h.employee_id, (h.set_at at time zone 'Asia/Kolkata')::date, null, null, 'home_map', 'amber',
      'Home placed on the map ' || to_char(h.set_at at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM')
      || coalesce(', ' || (select round(6371 * 2 * asin(sqrt(power(sin(radians(p.lat - h.lat) / 2), 2) + cos(radians(h.lat)) * cos(radians(p.lat)) * power(sin(radians(p.lng - h.lng) / 2), 2)))::numeric, 1)
        || ' km from the first visit photo (' || left(p.place, 40) || ')' from te_visit_photos p where p.employee_id = h.employee_id and p.day between f and t and p.removed_at is null order by p.shot_at limit 1), ''), null, jsonb_build_object('lat', h.lat, 'lng', h.lng)
    from travel_homes h join real r on r.id = h.employee_id where h.how = 'map'
    union all
    -- The home moved in the period.
    select m.employee_id, (m.at at time zone 'Asia/Kolkata')::date, null, null, 'home_moved', 'amber',
      'Home moved ' || round(m.km, 1) || ' km (' || case m.how when 'map' then 'on the map' else 'I''m here' end || ') ' || to_char(m.at at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM'), null, jsonb_build_object('lat', m.to_lat, 'lng', m.to_lng)
    from te_home_moves m join real r on r.id = m.employee_id
    where m.km is not null and m.km >= 1 and (m.at at time zone 'Asia/Kolkata')::date between f and t
    union all
    /*
      From one visit photo, or the day's start (te_0104), to the next (the user, 3 Nov): too fast for the km between them;
      a short visit or a long gap, the time at a place being the time to the next photo less the road time, the straight
      line × 1.3 at 30 km/h, 40 km/h from 10 km (the user, 3 Nov: "if in bike … 60km, we can reach by 90 mins").
    */
    select z.employee_id, z.day, null, null, z.kind, z.weight, z.detail, null, z.point from (
      select y.employee_id, y.day,
        case when y.km >= 2 and y.km / greatest(y.mins, 1) * 60 > fast then 'too_fast'
             when not y.a_start and y.km >= 0.3 and y.stay < 10 then 'short_visit'
             when not y.a_start and y.stay >= 240 then 'long_gap' end kind,
        case when y.km >= 2 and y.km / greatest(y.mins, 1) * 60 > fast then 'red' else 'amber' end weight,
        case when y.km >= 2 and y.km / greatest(y.mins, 1) * 60 > fast
          then split_part(y.a_place, ',', 1) || ' ' || to_char(y.a_at at time zone 'Asia/Kolkata', 'FMHH12:MI am') || ' → ' || split_part(y.b_place, ',', 1) || ' ' || to_char(y.b_at at time zone 'Asia/Kolkata', 'FMHH12:MI am')
            || ': ' || round(y.km::numeric, 1) || ' km in ' || round(y.mins::numeric) || ' min = ' || round((y.km / greatest(y.mins, 1) * 60)::numeric) || ' km/h, limit ' || fast
          else 'About ' || case when y.stay >= 60 then floor(y.stay / 60) || ' h ' || round(y.stay::numeric % 60) || ' m' else greatest(round(y.stay::numeric), 0) || ' min' end || ' at ' || split_part(y.a_place, ',', 1) || ' (photo ' || to_char(y.a_at at time zone 'Asia/Kolkata', 'FMHH12:MI am') || ', next ' || split_part(y.b_place, ',', 1) || ' '
            || to_char(y.b_at at time zone 'Asia/Kolkata', 'FMHH12:MI am') || ', ~' || round(y.road_min::numeric) || ' min road for ' || round((y.km * 1.3)::numeric, 1) || ' km)' end detail,
        case when y.km >= 2 and y.km / greatest(y.mins, 1) * 60 > fast then jsonb_build_object('lat', y.b_lat, 'lng', y.b_lng)
          else jsonb_build_object('lat', y.a_lat, 'lng', y.a_lng) end point
      from (
        select x.*, x.mins - x.road_min stay from (select x0.*, x0.km * 1.3 / (case when x0.km * 1.3 >= 10 then 40 else 30 end) * 60 road_min from (
          select p.employee_id, p.day, p.place a_place, p.at a_at, p.is_start a_start, p.lat a_lat, p.lng a_lng,
            lead(p.place) over w b_place, lead(p.at) over w b_at, lead(p.lat) over w b_lat, lead(p.lng) over w b_lng,
            te_m(p.lat, p.lng, lead(p.lat) over w, lead(p.lng) over w) / 1000 km,
            extract(epoch from lead(p.at) over w - p.at) / 60 mins
          from (
            select v.employee_id, v.day, coalesce(v.place, 'Visit photo') place, v.shot_at at, false is_start, v.lat, v.lng
            from te_visit_photos v join real r on r.id = v.employee_id where v.day between f and t and v.removed_at is null
            union all
            select s.employee_id, s.day, 'Start of day', s.at, true, s.lat, s.lng
            from te_day_starts s join real r on r.id = s.employee_id where s.day between f and t
          ) p
          window w as (partition by p.employee_id, p.day order by p.at)
        ) x0) x where x.b_at is not null
      ) y
    ) z where z.kind is not null
    union all
    -- A day with rides and no Start my day (te_0104), from the day it is asked for.
    select dd.employee_id, dd.day, dd.number, dd.status, 'day_unstarted', 'amber',
      'No Start my day' || coalesce('; first ride from "' || split_part((select x.from_name from te_rides x where x.day_id = dd.id order by x.seq limit 1), ',', 1) || '"', ''), null, null
    from dd
    where dd.day >= coalesce(nullif(te_pol('day_start_from') #>> '{}', '')::date, '2999-01-01')
      and exists (select 1 from te_rides x where x.day_id = dd.id)
      and not exists (select 1 from te_day_starts s where s.employee_id = dd.employee_id and s.day = dd.day)
  )
  select jsonb_build_object(
    'counts', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from sign group by kind) k), '{}'),
    'people', coalesce((select jsonb_agg(p order by p.red desc, p.n desc, p.name) from (
      select r.ecode, r.full_name name, r.fn "function", r.manager, count(*) n, count(*) filter (where s.weight = 'red') red,
        jsonb_agg(jsonb_build_object('kind', s.kind, 'weight', s.weight, 'day', s.day, 'claim', s.number, 'status', s.status, 'detail', s.detail, 'amount', s.amount, 'point', s.point)
          order by case s.weight when 'red' then 0 when 'amber' then 1 else 2 end, s.day desc) signs
      from sign s join real r on r.id = s.employee_id group by r.ecode, r.full_name, r.fn, r.manager) p), '[]'),
    'at', now()) into out;
  return out;
end $$;
revoke all on function public.te_watch(date, date) from public, anon;
grant execute on function public.te_watch(date, date) to authenticated;
