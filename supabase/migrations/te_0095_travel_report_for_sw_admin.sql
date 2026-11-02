/*
  te_0095 — SW Admin's travel report (the user, 2 Nov: "for sw admin, they need a report ie example map km, they claimed
  km. bcz we want to check how much % they claimed in average … from your end try to get data that we need to squeeze the
  team members faking or claming excess claims"; "it should have function name, ecode name etc basic datas, reporting
  manager"). Over a period's days on claims sent in: each person's bike and car km against the map's, and the signs
  worth a look, each a line SW Admin can read:
    speed         two of a day's visit photos further apart than the time between them allows (te_0089, as the claim
                  shows it; the user: "10 km difference but image took in 2 mins")
    shared_phone  a visit photo on a phone another person also took visit photos on
    same_spot     a GPS point exactly that of another photo: a phone's own fix never repeats to the centimetre, a
                  fake-GPS app's saved point does
    clock         the phone's clock ahead of the server's
    other_phone   a visit photo on a phone the person does not usually use
    late          a photo uploaded 6 h or more after its time (or the phone's clock set back)
    no_photo      a ride whose photo was skipped
    at_limit      km claimed at the very top of what the map allows
    twice         the same ride twice in a day
    auto_high     an auto fare 1.4 times what autos usually cost there, no bill bearing it out (te_0051, as the claim shows it)
    no_map        a bike or car ride with no map km to check it against
    home          the home moved
    cut           an amount an approver cut
  With p_detail, every bike and car ride and every sign as well (a person's page, the Excel). SW Admin's alone.
*/
create or replace function public.te_km_report(p_from date, p_to date, p_employee uuid default null, p_detail boolean default false)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  tol numeric := coalesce((te_pol('km_tolerance_pct') #>> '{}')::numeric, 10);
  near_m numeric := coalesce((te_pol('photo_near_m') #>> '{}')::numeric, 500);
  speeds jsonb := '{"bike": 60, "car": 80, "bus": 60, "train": 100, "metro": 80, "auto": 40, "taxi": 80, "taxi_bike": 60}'::jsonb
    || coalesce(te_pol('photo_speeds'), '{}'::jsonb);
  auto_min numeric := coalesce((te_pol('auto_min_fare') #>> '{}')::numeric, 30);
  out jsonb;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin sees the travel report'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Pick a From date on or before the To date'; end if;

  with dd as (
    select d.id, d.day, c.employee_id, c.number
    from te_days d join te_claims c on c.id = d.claim_id
    where d.day between p_from and p_to and c.status <> 'draft' and (p_employee is null or c.employee_id = p_employee)
  ), rr as (
    select r.id, r.seq, r.mode, r.from_lat, r.from_lng, r.to_lat, r.to_lng, r.claimed_km, r.map_km, r.fare, r.amount,
      r.purpose, r.project, r.photo_skip, dd.day, dd.employee_id, dd.number,
      coalesce(nullif(split_part(r.from_name, ',', 1), ''), '?') || ' → ' || coalesce(nullif(split_part(r.to_name, ',', 1), ''), '?') as way
    from te_rides r join dd on dd.id = r.day_id
  ), km as (
    select rr.*, coalesce(rr.map_km > 0 and rr.claimed_km is not null, false) as checked,
      -- The most the map allows, to a tenth outward, as the day's form works it out (kmRange).
      ceil(round(rr.map_km * (1 + tol / 100) * 10000) / 1000) / 10 as top
    from rr where rr.mode in ('bike', 'car')
  ), pa as (
    select p.id, p.employee_id, p.day, p.shot_at, p.taken_at, p.lat, p.lng, p.accuracy, p.device_id, p.device,
      coalesce(nullif(split_part(p.place, ',', 1), ''), 'Photo') || ' ' || to_char(p.shot_at at time zone 'Asia/Kolkata', 'FMHH12:MI am') as at
    from te_visit_photos p
    where p.removed_at is null and exists (select 1 from dd where dd.employee_id = p.employee_id and dd.day = p.day)
  ), ph as (
    -- te_0089's check: the day's photos in turn, a location worse than 500 m left out.
    select pa.*, row_number() over (partition by pa.employee_id, pa.day order by pa.shot_at, pa.id) as n
    from pa where pa.accuracy is null or pa.accuracy <= 500
  ), near as (
    -- The ride a photo was taken at the end of: the nearest To within the photo distance.
    select distinct on (ph.id) ph.id, r.seq
    from ph join rr r on r.employee_id = ph.employee_id and r.day = ph.day
    where r.to_lat is not null and r.to_lng is not null and te_km(ph.lat, ph.lng, r.to_lat, r.to_lng) * 1000 <= near_m
    order by ph.id, te_km(ph.lat, ph.lng, r.to_lat, r.to_lng), r.seq
  ), pair as (
    select a.id, a.employee_id, a.day, a.at as a_at, b.at as b_at, te_km(a.lat, a.lng, b.lat, b.lng)::numeric as line,
      -- The server's time when both went up within 10 minutes of being taken, else the phone's.
      greatest(1, extract(epoch from case when a.taken_at - a.shot_at <= interval '10 minutes' and b.taken_at - b.shot_at <= interval '10 minutes'
        then b.taken_at - a.taken_at else b.shot_at - a.shot_at end) / 60) as mins,
      na.seq as ia, nb.seq as ib, coalesce(nb.seq > na.seq, false) as ridden
    from ph a join ph b on b.employee_id = a.employee_id and b.day = a.day and b.n = a.n + 1
    left join near na on na.id = a.id left join near nb on nb.id = b.id
    where te_km(a.lat, a.lng, b.lat, b.lng) >= 2
  ), fast as (
    -- The rides between the two places (the day's, when the photos are not at a ride's end), at the fastest of them.
    select p.employee_id, p.day, p.a_at, p.b_at, p.mins,
      greatest(p.line, case when p.ridden then coalesce(sum(coalesce(r.claimed_km, r.map_km,
        case when r.from_lat is not null and r.to_lat is not null then te_km(r.from_lat, r.from_lng, r.to_lat, r.to_lng)::numeric end, 0)), 0) else 0 end) as km,
      case when count(r.id) = 0 then (select max(v::numeric) from jsonb_each_text(speeds) s(k, v))
           else coalesce(max((speeds ->> r.mode)::numeric), 0) end as lim,
      coalesce(bool_or(r.mode = 'flight'), false) as flight
    from pair p left join rr r on r.employee_id = p.employee_id and r.day = p.day and (not p.ridden or (r.seq > p.ia and r.seq <= p.ib))
    group by p.id, p.employee_id, p.day, p.a_at, p.b_at, p.mins, p.line, p.ridden
  ), usual as (
    -- The phone a person takes most of their photos on.
    select distinct on (employee_id) employee_id, device_id, max(device) as device
    from pa where device_id is not null
    group by employee_id, device_id
    order by employee_id, count(*) desc, max(shot_at) desc
  ), shared as (
    select q.device_id from te_visit_photos q
    where q.removed_at is null and q.day between p_from and p_to and q.device_id is not null
    group by q.device_id having count(distinct q.employee_id) > 1
  ), spot as (
    select distinct on (b.id) b.employee_id, b.day, b.at, a.shot_at as a_shot, a.employee_id as a_emp
    from pa b join te_visit_photos a on a.lat = b.lat and a.lng = b.lng and a.id <> b.id
    where b.accuracy <= 30 and a.accuracy <= 30 and a.removed_at is null
      and (a.employee_id <> b.employee_id or abs(extract(epoch from b.shot_at - a.shot_at)) > 3600)
    order by b.id, a.shot_at desc
  ), twice as (
    select distinct b.id
    from rr a join rr b on b.employee_id = a.employee_id and b.day = a.day and b.seq > a.seq
    where a.from_lat is not null and a.to_lat is not null and b.from_lat is not null and b.to_lat is not null
      and te_km(a.from_lat, a.from_lng, b.from_lat, b.from_lng) <= 0.2 and te_km(a.to_lat, a.to_lng, b.to_lat, b.to_lng) <= 0.2
  ), item as (
    select dd.id, dd.employee_id, dd.day from dd
    union all select rr.id, rr.employee_id, rr.day from rr
    union all select x.id, dd.employee_id, dd.day from te_expenses x join dd on dd.id = x.day_id
    union all select h.id, dd.employee_id, dd.day from te_hotels h join dd on dd.id = h.day_id
  ), flag as (
    select f.employee_id, f.day, 'speed'::text as kind,
      format('%s → %s: %s km in %s min, %s km/h (limit %s)', f.a_at, f.b_at, round(f.km, 1), round(f.mins), round(f.km * 60 / f.mins), round(f.lim)) as what,
      null::numeric as amount
    from fast f where f.lim > 0 and not f.flight and f.km * 60 / f.mins > f.lim
    union all
    select p.employee_id, p.day, 'shared_phone', format('%s — the same phone took photos for %s', p.at, (
        select string_agg(distinct e.full_name || ' (' || e.ecode || ')', ', ') from te_visit_photos q join employees e on e.id = q.employee_id
        where q.device_id = p.device_id and q.employee_id <> p.employee_id and q.removed_at is null and q.day between p_from and p_to)), null
    from pa p join shared s on s.device_id = p.device_id
    union all
    select s.employee_id, s.day, 'same_spot', format('%s — exactly the GPS point of a photo of %s%s', s.at,
        to_char(s.a_shot at time zone 'Asia/Kolkata', 'FMDD Mon, FMHH12:MI am'),
        case when s.a_emp <> s.employee_id then ' by ' || (select e.full_name || ' (' || e.ecode || ')' from employees e where e.id = s.a_emp) else '' end), null
    from spot s
    union all
    select p.employee_id, p.day, 'clock', format('%s — the phone''s clock %s min ahead', p.at, round(extract(epoch from p.shot_at - p.taken_at) / 60)), null
    from pa p where p.shot_at > p.taken_at + interval '15 minutes'
    union all
    select p.employee_id, p.day, 'other_phone', format('%s — on %s, usually %s', p.at, coalesce(p.device, 'another phone'), coalesce(u.device, 'another phone')), null
    from pa p join usual u on u.employee_id = p.employee_id where p.device_id is not null and p.device_id <> u.device_id
    union all
    select p.employee_id, p.day, 'late', format('%s — uploaded %s later', p.at,
        case when p.taken_at - p.shot_at >= interval '48 hours' then round(extract(epoch from p.taken_at - p.shot_at) / 86400) || ' days'
             else round(extract(epoch from p.taken_at - p.shot_at) / 3600) || ' h' end), null
    from pa p where p.taken_at > p.shot_at + interval '6 hours'
    union all
    select r.employee_id, r.day, 'no_photo', format('%s — no photo: %s', r.way, r.photo_skip), null
    from rr r where r.photo_skip is not null
    union all
    select k.employee_id, k.day, 'at_limit', format('%s — map %s km, claimed %s km', k.way, round(k.map_km, 1), round(k.claimed_km, 1)),
      k.amount * (k.claimed_km - k.map_km) / nullif(k.claimed_km, 0)
    from km k where k.checked and k.claimed_km > k.map_km + 0.05 and k.claimed_km >= k.top - 0.05
    union all
    select r.employee_id, r.day, 'twice', format('%s — a second time the same day', r.way), r.amount
    from rr r join twice t on t.id = r.id
    union all
    select r.employee_id, r.day, 'auto_high', format('%s — auto ₹%s for %s km, usually about ₹%s', r.way, round(r.fare), round(r.map_km, 1), round(x.usual / 5) * 5),
      r.fare - x.usual
    from rr r
    cross join lateral (select te_auto_norm(r.id) as norm) n
    cross join lateral (select greatest(auto_min, (n.norm ->> 'per_km')::numeric * r.map_km) as usual) x
    where r.mode = 'auto' and r.fare > 0 and r.map_km > 0 and n.norm is not null and r.fare > x.usual * 1.4
      and not exists (select 1 from te_bills b where b.owner_id = r.id and abs(b.ocr_amount - r.fare) <= 1)
    union all
    select k.employee_id, k.day, 'no_map', format('%s — no map km', k.way), null
    from km k where not k.checked
    union all
    select m.employee_id, (m.at at time zone 'Asia/Kolkata')::date, 'home',
      format('Home moved %s km', round(coalesce(m.km, te_km(m.from_lat, m.from_lng, m.to_lat, m.to_lng)::numeric), 1)), null
    from te_home_moves m
    where m.from_lat is not null and (m.at at time zone 'Asia/Kolkata')::date between p_from and p_to and m.employee_id in (select employee_id from dd)
    union all
    select i.employee_id, i.day, 'cut', format('%s: ₹%s → ₹%s%s%s', coalesce(nullif(j.label, ''), 'Amount'), round(j.old_amount), round(coalesce(j.new_amount, 0)),
        coalesce(' — ' || nullif(trim(j.reason), ''), ''), coalesce(' (' || (select e.full_name from employees e where e.id = j.by_id) || ')', '')),
      j.old_amount - coalesce(j.new_amount, 0)
    from te_adjustments j join item i on i.id = j.item_id
    where coalesce(j.old_amount, 0) > coalesce(j.new_amount, 0)
  ), kmp as (
    select employee_id, count(*) as rides, count(*) filter (where checked) as checked,
      sum(map_km) filter (where checked) as map_km, sum(claimed_km) filter (where checked) as claimed_km, sum(amount) as amount,
      sum(amount * (claimed_km - map_km) / nullif(claimed_km, 0)) filter (where checked and claimed_km > map_km) as extra_amount,
      count(*) filter (where checked and claimed_km > map_km * 1.1) as over10
    from km group by employee_id
  ), fc as (
    select employee_id, kind, count(*) as n, sum(amount) as amount from flag group by employee_id, kind
  )
  select jsonb_build_object(
    'tolerance', tol,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'ecode', e.ecode, 'name', e.full_name, 'function', e.function_name, 'designation', e.designation,
        'grade', e.grade, 'location', e.location,
        'manager', (select m.full_name || ' (' || m.ecode || ')' from employees m where m.id = e.reporting_manager_id),
        'rides', coalesce(k.rides, 0), 'checked', coalesce(k.checked, 0),
        'map_km', round(coalesce(k.map_km, 0), 1), 'claimed_km', round(coalesce(k.claimed_km, 0), 1),
        'amount', round(coalesce(k.amount, 0)), 'extra_amount', round(coalesce(k.extra_amount, 0)), 'over10', coalesce(k.over10, 0),
        'signs', coalesce((select jsonb_object_agg(c.kind, c.n) from fc c where c.employee_id = e.id), '{}'::jsonb),
        'cut', coalesce((select round(c.amount) from fc c where c.employee_id = e.id and c.kind = 'cut'), 0)
      ) order by e.full_name)
      from (select distinct employee_id from dd) x join employees e on e.id = x.employee_id left join kmp k on k.employee_id = e.id), '[]'::jsonb),
    'rides', case when p_detail then coalesce((select jsonb_agg(jsonb_build_object(
        'employee_id', k.employee_id, 'day', k.day, 'number', k.number, 'way', k.way, 'mode', k.mode, 'purpose', k.purpose, 'project', k.project,
        'map_km', k.map_km, 'claimed_km', k.claimed_km, 'top', case when k.checked then k.top end, 'amount', k.amount
      ) order by k.employee_id, k.day, k.seq) from km k), '[]'::jsonb) end,
    'signs', case when p_detail then coalesce((select jsonb_agg(jsonb_build_object(
        'employee_id', f.employee_id, 'day', f.day, 'kind', f.kind, 'what', f.what, 'amount', round(f.amount)
      ) order by f.employee_id, f.day, f.kind) from flag f), '[]'::jsonb) end
  ) into out;
  return out;
end $function$;
revoke all on function public.te_km_report(date, date, uuid, boolean) from public, anon;
grant execute on function public.te_km_report(date, date, uuid, boolean) to authenticated;
