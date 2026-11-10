/*
  te_0147 — Three things from the 10 Nov review of this month's claims (the user: "add the red mark only", "A visit photo
  can be backdated", "Visit photos taken from a Windows computer").

  1. A visit photo's time. The phone says when it sends (p_sent_at), so its clock is set against ours. A photo sent as
     it is taken from a phone whose clock is over 5 minutes out is refused — a date set back made the visit another
     day's. One that waited on the phone is kept at its time put right by the phone's error, the error kept beside it.
  2. Visit photos from a phone or tablet only: a computer's place is a guess from its network. The test accounts are let
     through, for trying the camera at a desk.
  3. The Watch: "Photo saved late" was the wrong way round and never showed — now 2 hours after the photo's own time
     amber, 12 hours or a wrong phone clock red; and a past day with rides and no End my day is red, from 10 Nov.
*/
alter table public.te_visit_photos add column if not exists clock_off_s integer;

drop function if exists public.te_photo_add(text, double precision, double precision, real, timestamptz, text, text, text, text, date);
create function public.te_photo_add(p_path text, p_lat double precision, p_lng double precision, p_acc real, p_shot_at timestamptz, p_place text, p_sha256 text,
  p_device_id text default null, p_device text default null, p_day date default null, p_sent_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare me uuid := current_employee_id(); v te_visit_photos; off_s integer; shot timestamptz := p_shot_at;
begin
  if me is null then raise exception 'Sign in again'; end if;
  if not coalesce((te_pol('visit_photos'))::text::boolean, false) then raise exception 'Visit photos are switched off'; end if;
  if split_part(p_path, '/', 1) <> me::text then raise exception 'Not your folder'; end if;
  -- A phone or tablet only (te_0147).
  if p_device ~* '^(windows|mac|linux|chrome ?os|chromium)' and not te_is_test(me) then
    raise exception 'Visit photos are taken on a phone. Open Cyra on your phone';
  end if;
  -- A close fix only, as Start my day (te_0139).
  if p_acc is null or p_acc > 500 then
    raise exception 'Your location is not exact enough (± % m). Take the photo again', coalesce(round(p_acc)::text, '?');
  end if;
  -- The phone's clock against ours (te_0147).
  if p_sent_at is not null and abs(extract(epoch from (now() - p_sent_at))) > 300 then
    if p_sent_at - p_shot_at <= interval '10 minutes' then
      raise exception 'Your phone''s date or time is wrong. Set it to automatic, then take the photo again';
    end if;
    off_s := round(extract(epoch from (now() - p_sent_at)));
    shot := p_shot_at + make_interval(secs => off_s);
  end if;
  if shot > now() + interval '5 minutes' then raise exception 'The phone''s clock is ahead. Set the right time, then take the photo again'; end if;
  if shot < now() - interval '2 days' then raise exception 'This photo is too old to add'; end if;
  if p_sha256 is not null and exists (select 1 from te_visit_photos where employee_id = me and sha256 = p_sha256) then raise exception 'This photo is added already'; end if;
  if p_day is not null and (p_day is distinct from te_late_day(me) or p_day <> (shot at time zone 'Asia/Kolkata')::date - 1) then
    raise exception 'The trip of % is closed. Start your day', to_char(p_day, 'FMDD Mon');
  end if;
  if exists (select 1 from te_day_ends e where e.employee_id = me and e.day = coalesce(p_day, (shot at time zone 'Asia/Kolkata')::date) and e.at < shot) then
    raise exception '% is ended in the app. A photo after it can''t be added', to_char(coalesce(p_day, (shot at time zone 'Asia/Kolkata')::date), 'FMDD Mon');
  end if;
  insert into te_visit_photos (employee_id, day, shot_at, lat, lng, accuracy, place, path, sha256, device_id, device, clock_off_s)
  values (me, coalesce(p_day, (shot at time zone 'Asia/Kolkata')::date), shot, p_lat, p_lng, p_acc, nullif(btrim(p_place), ''), p_path, p_sha256,
    left(nullif(btrim(p_device_id), ''), 64), left(nullif(btrim(p_device), ''), 80), off_s)
  returning * into v;
  return to_jsonb(v);
end $function$;
revoke all on function public.te_photo_add(text, double precision, double precision, real, timestamptz, text, text, text, text, date, timestamptz) from public, anon;
grant execute on function public.te_photo_add(text, double precision, double precision, real, timestamptz, text, text, text, text, date, timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.te_watch(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if session_user <> 'postgres' and not is_sw_admin() then raise exception 'Only SW Admin sees this'; end if;
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
    -- A photo that reached us long after the time it says (te_0147): shot_at is the phone's own clock, taken_at ours.
    -- No signal at the hospital, or a phone's date set back: 2 hours on amber, 12 hours on, or a phone clock found wrong, red.
    select p.employee_id, p.day, null, null, 'photo_late',
      case when p.taken_at - p.shot_at >= interval '12 hours' or p.clock_off_s is not null then 'red' else 'amber' end,
      coalesce(split_part(p.place, ',', 1), 'Visit photo') || ': photo says ' || to_char(p.shot_at at time zone 'Asia/Kolkata', 'FMDD Mon FMHH12:MI am')
        || ', reached us ' || to_char(p.taken_at at time zone 'Asia/Kolkata', 'FMDD Mon FMHH12:MI am')
        || coalesce(' · the phone''s clock was ' || round(abs(p.clock_off_s) / 3600.0, 1) || ' h ' || case when p.clock_off_s > 0 then 'behind' else 'ahead' end, ''),
      null, jsonb_build_object('lat', p.lat, 'lng', p.lng)
    from te_visit_photos p join real r on r.id = p.employee_id
    where p.day between f and t and p.removed_at is null and p.taken_at is not null
      and (p.taken_at - p.shot_at >= interval '2 hours' or p.clock_off_s is not null)
    union all
    -- A home placed on the map, with how far it is from the first photo of each day in the period.
    select h.employee_id, (h.set_at at time zone 'Asia/Kolkata')::date, null, null, 'home_map', 'amber',
      'Home placed on the map ' || to_char(h.set_at at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM')
      || coalesce(', ' || (select round(6371 * 2 * asin(sqrt(power(sin(radians(p.lat - h.lat) / 2), 2) + cos(radians(h.lat)) * cos(radians(p.lat)) * power(sin(radians(p.lng - h.lng) / 2), 2)))::numeric, 1)
        || ' km from the first visit photo (' || left(p.place, 40) || ')' from te_visit_photos p where p.employee_id = h.employee_id and p.day between f and t and p.removed_at is null order by p.shot_at limit 1), ''), null, jsonb_build_object('lat', h.lat, 'lng', h.lng)
    from travel_homes h join real r on r.id = h.employee_id where h.how = 'map' and (h.set_at at time zone 'Asia/Kolkata')::date between f and t
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
            from te_visit_photos v join real r on r.id = v.employee_id where v.day between f and t and v.removed_at is null and coalesce(v.accuracy, 0) <= 1000
            union all
            select s.employee_id, s.day, 'Start of day', s.at, true, s.lat, s.lng
            from te_day_starts s join real r on r.id = s.employee_id where s.day between f and t and s.fixed_note is null and coalesce(s.accuracy, 0) <= 1000
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
    union all
    -- A past day with rides and no End my day (te_0147; the user, 10 Nov: "add the red mark only"), from 10 Nov.
    select dd.employee_id, dd.day, dd.number, dd.status, 'day_unended', 'red',
      'No End my day' || coalesce('; last ride to "' || split_part((select x.to_name from te_rides x where x.day_id = dd.id order by x.seq desc limit 1), ',', 1) || '"', ''), null, null
    from dd
    where dd.day >= greatest(coalesce(nullif(te_pol('day_end_from') #>> '{}', '')::date, '2999-01-01'), date '2026-11-10')
      and dd.day < (now() at time zone 'Asia/Kolkata')::date
      and exists (select 1 from te_rides x where x.day_id = dd.id)
      and not exists (select 1 from te_day_ends s where s.employee_id = dd.employee_id and s.day = dd.day)
    union all
    -- The same trip on another person's claim (te_0134).
    select dd.employee_id, dd.day, dd.number, dd.status, 'shared', 'red',
      initcap(x.mode) || ' ' || split_part(coalesce(x.from_name, ''), ',', 1) || ' → ' || split_part(coalesce(x.to_name, ''), ',', 1)
        || ': ₹' || round(coalesce(x.amount, x.fare, 0)) || ' here · '
        || case when sr.v->>'kind' = 'ticket' then 'one ticket for both likely, with ' else 'shared likely with ' end
        || (sr.v->>'name') || ' (' || (sr.v->>'ecode') || ') ' || coalesce('on ' || (sr.v->>'number'), 'on a claim not sent yet')
        || ' for ₹' || round((sr.v->>'amount')::numeric)
        || ' · photos together ' || to_char((sr.v->>'mine_at')::timestamptz at time zone 'Asia/Kolkata', 'FMHH12:MI am')
        || ' and ' || to_char((sr.v->>'other_at')::timestamptz at time zone 'Asia/Kolkata', 'FMHH12:MI am'),
      coalesce(x.amount, x.fare), jsonb_build_object('lat', x.from_lat, 'lng', x.from_lng)
    from (select distinct claim_id from dd) k
    cross join lateral jsonb_array_elements(coalesce(te_shared_rides(k.claim_id), '[]'::jsonb)) sr(v)
    join te_rides x on x.id = (sr.v->>'ride')::uuid join dd on dd.id = x.day_id
    union all
    -- Paid at another time than the ride (te_0135).
    select w.employee_id, w.day, w.number, w.status, 'paid_time', 'red',
      initcap(w.mode) || ' ' || split_part(coalesce(w.from_name, ''), ',', 1) || ' → ' || split_part(coalesce(w.to_name, ''), ',', 1)
        || ': ₹' || round(w.fare) || ' paid ' || to_char(w.paid_at at time zone 'Asia/Kolkata', 'FMDD Mon FMHH12:MI am')
        || ', the ride ' || case when w.st is null and w.en is null then 'on ' || to_char(w.day, 'FMDD Mon')
           else concat_ws(' – ', to_char(w.st at time zone 'Asia/Kolkata', 'FMDD Mon FMHH12:MI am'), to_char(w.en at time zone 'Asia/Kolkata', 'FMDD Mon FMHH12:MI am')) || ' by its photos' end,
      w.fare, jsonb_build_object('lat', w.to_lat, 'lng', w.to_lng)
    from (
      select dd.employee_id, dd.day, dd.number, dd.status, x.mode, x.from_name, x.to_name, x.to_lat, x.to_lng, x.fare, b.paid_at, st.at st, en.at en
      from te_bills b join te_rides x on b.owner_kind = 'ride' and x.id = b.owner_id join dd on dd.id = x.day_id
      cross join lateral (
        select case when x.seq = (select min(y.seq) from te_rides y where y.day_id = x.day_id)
          -- The first ride starts at Start my day; any ride else at the day's first photo where it starts.
          then coalesce((select s.at from te_day_starts s where s.employee_id = dd.employee_id and s.day = dd.day order by s.at limit 1), ph.at)
          else ph.at end at
        from (select v.shot_at at from te_visit_photos v where v.employee_id = dd.employee_id and v.day = dd.day and v.lat is not null
                and x.from_lat is not null and te_km(v.lat, v.lng, x.from_lat, x.from_lng) <= 1 order by v.shot_at limit 1) ph0
        right join (select 1) one on true
        cross join lateral (select ph0.at) ph
      ) st
      left join lateral (
        select v.shot_at at from te_visit_photos v where v.employee_id = dd.employee_id and v.day = dd.day and v.lat is not null
          and x.to_lat is not null and te_km(v.lat, v.lng, x.to_lat, x.to_lng) <= 1 and v.shot_at >= coalesce(st.at, '-infinity')
        order by v.shot_at limit 1
      ) en on true
      where b.paid_at is not null and x.fare > 0 and x.mode not in ('bike', 'car')
    ) w
    where (w.paid_at at time zone 'Asia/Kolkata')::date not in (w.day, w.day + 1)
       or w.paid_at < w.st - interval '2 hours' or w.paid_at > w.en + interval '2 hours'
  )
  select jsonb_build_object(
    'counts', coalesce((select jsonb_object_agg(kind, n) from (select kind, count(*) n from sign group by kind) k), '{}'),
    'people', coalesce((select jsonb_agg(p order by p.red desc, p.n desc, p.name) from (
      select r.ecode, r.full_name name, r.fn "function", r.manager, count(*) n, count(*) filter (where s.weight = 'red') red,
        jsonb_agg(jsonb_build_object('kind', s.kind, 'weight', s.weight, 'day', s.day, 'claim', coalesce(s.number, (select k.number from dd k where k.employee_id = s.employee_id and k.day = s.day limit 1)),
          'status', coalesce(s.status, (select k.status from dd k where k.employee_id = s.employee_id and k.day = s.day limit 1)), 'detail', s.detail, 'amount', s.amount, 'point', s.point)
          order by case s.weight when 'red' then 0 when 'amber' then 1 else 2 end, s.day desc) signs
      from sign s join real r on r.id = s.employee_id group by r.ecode, r.full_name, r.fn, r.manager) p), '[]'),
    'at', now()) into out;
  return out;
end $function$;
