/*
  te_0082: Visit photos (the user, 28 Oct: "when he reaches a hospital … he can take a photo of the facility, so no
  upload option only camera and in that photo date, time a location should be watermarked … comparing image location
  n map selected location, it should automatically attach, the date of the image n claim should be same").
  - A purpose ticks "Photo needed"; a ride for it, to a place that is not Home, needs a photo taken that day within
    photo_near_m of where the ride went, or "Photo not possible" with a reason (photo_skips a month; past it SW Admin
    chooses block or send, the manager deciding).
  - SW Admin switches the whole of it on or off (visit_photos); off, nothing is asked and the tab hides.
  - The photo's facts are ours: our clock when it arrived beside the phone's at the shutter, the place and its
    accuracy. Read only through these functions; the pictures in the private bucket te-visits, one folder a person.
*/
alter table te_purposes add column if not exists photo_needed boolean not null default false;
alter table te_rides add column if not exists photo_skip text;

insert into te_policy (key, value) values
  ('visit_photos', 'true'), ('photo_near_m', '500'), ('photo_skips', '3'), ('photo_after', '"block"'), ('photo_keep_days', '90')
on conflict (key) do nothing;

create table if not exists te_visit_photos (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  day date not null,
  shot_at timestamptz not null,
  taken_at timestamptz not null default now(),
  lat double precision not null, lng double precision not null, accuracy real,
  place text, path text not null unique, sha256 text,
  removed_at timestamptz
);
create index if not exists te_visit_photos_emp_day on te_visit_photos (employee_id, day);
alter table te_visit_photos enable row level security;

-- Metres between two points (haversine).
create or replace function public.te_m(a_lat float8, a_lng float8, b_lat float8, b_lng float8) returns float8
 language sql immutable set search_path to 'public' as $$
  select 6371000 * 2 * asin(sqrt(power(sin(radians(b_lat - a_lat) / 2), 2) + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)))
$$;

create or replace function public.te_visit_setup() returns jsonb
 language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'on', coalesce((te_pol('visit_photos'))::text::boolean, false),
    'near_m', coalesce((te_pol('photo_near_m'))::text::numeric, 500),
    'skips', coalesce((te_pol('photo_skips'))::text::int, 3),
    'after', coalesce(te_pol('photo_after') #>> '{}', 'block'),
    'keep_days', coalesce((te_pol('photo_keep_days'))::text::int, 90),
    'needs', (select coalesce(jsonb_agg(label order by sort), '[]') from te_purposes where photo_needed and is_active))
$$;

-- The learned hospital nearest a spot, within 500 m, for the photo's watermark.
create or replace function public.te_visit_place(p_lat float8, p_lng float8) returns text
 language sql stable security definer set search_path to 'public' as $$
  select f.name from te_facilities f where not coalesce(f.hidden, false) and te_m(p_lat, p_lng, f.lat, f.lng) <= 500
  order by te_m(p_lat, p_lng, f.lat, f.lng) limit 1
$$;

-- Who may look at a person's photos: the person, SW/ACC Admin, the Travel Desk, and whoever can see a claim of theirs.
create or replace function public.te_can_see_visits(p_emp uuid) returns boolean
 language sql stable security definer set search_path to 'public' as $$
  select p_emp = current_employee_id() or te_is_admin() or te_is_desk()
    or exists (select 1 from te_claims c where c.employee_id = p_emp and c.status <> 'draft' and te_can_see(c.id))
$$;

-- The sent claim a photo stands on, if any: a ride that day that went within reach of it.
create or replace function public.te_photo_on(p_photo uuid) returns text
 language sql stable security definer set search_path to 'public' as $$
  select coalesce(k.number, 'draft') from te_visit_photos v
    join te_claims k on k.employee_id = v.employee_id
    join te_days d on d.claim_id = k.id and d.day = v.day
    join te_rides r on r.day_id = d.id
   where v.id = p_photo and r.to_lat is not null
     and te_m(v.lat, v.lng, r.to_lat, r.to_lng) <= coalesce((te_pol('photo_near_m'))::text::numeric, 500)
   order by (k.status = 'draft'), k.submitted_at limit 1
$$;

create or replace function public.te_photo_add(p_path text, p_lat float8, p_lng float8, p_acc real, p_shot_at timestamptz, p_place text, p_sha256 text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare me uuid := current_employee_id(); v te_visit_photos;
begin
  if me is null then raise exception 'Sign in again'; end if;
  if not coalesce((te_pol('visit_photos'))::text::boolean, false) then raise exception 'Visit photos are switched off'; end if;
  if split_part(p_path, '/', 1) <> me::text then raise exception 'Not your folder'; end if;
  if p_shot_at > now() + interval '5 minutes' then raise exception 'The phone''s clock is ahead. Set the right time, then take the photo again'; end if;
  if p_shot_at < now() - interval '2 days' then raise exception 'This photo is too old to add'; end if;
  if p_sha256 is not null and exists (select 1 from te_visit_photos where employee_id = me and sha256 = p_sha256) then raise exception 'This photo is added already'; end if;
  insert into te_visit_photos (employee_id, day, shot_at, lat, lng, accuracy, place, path, sha256)
  values (me, (p_shot_at at time zone 'Asia/Kolkata')::date, p_shot_at, p_lat, p_lng, p_acc, nullif(btrim(p_place), ''), p_path, p_sha256)
  returning * into v;
  return to_jsonb(v);
end $$;

create or replace function public.te_my_photos(p_from date, p_to date) returns jsonb
 language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'day', v.day, 'shot_at', v.shot_at, 'taken_at', v.taken_at, 'lat', v.lat, 'lng', v.lng,
    'accuracy', v.accuracy, 'place', v.place, 'path', case when v.removed_at is null then v.path end, 'on', te_photo_on(v.id)) order by v.shot_at desc), '[]')
  from te_visit_photos v where v.employee_id = current_employee_id() and v.day between p_from and p_to
$$;

-- A photo goes until a sent claim stands on it; its picture is then removed by the caller (the bucket lets only a photo with no row go).
create or replace function public.te_photo_delete(p_id uuid) returns text
 language plpgsql security definer set search_path to 'public' as $$
declare v te_visit_photos; on_ text := te_photo_on(p_id);
begin
  select * into v from te_visit_photos where id = p_id and employee_id = current_employee_id();
  if v.id is null then raise exception 'That photo is not there any more'; end if;
  if on_ is not null and on_ <> 'draft' then raise exception 'It is on %, sent already', on_; end if;
  delete from te_visit_photos where id = p_id;
  return v.path;
end $$;


create or replace function public.te_set_purpose_photo(p_id int, p_on boolean) returns void
 language plpgsql security definer set search_path to 'public' as $$
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  update te_purposes set photo_needed = p_on where id = p_id;
  if not found then raise exception 'That purpose is not there any more'; end if;
end $$;

-- A purpose no ride or day has named yet can go; after that it is switched off instead (the user, 28 Oct: "add edit delete").
create or replace function public.te_delete_purpose(p_id int) returns void
 language plpgsql security definer set search_path to 'public' as $$
declare lbl text; n int;
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  select label into lbl from te_purposes where id = p_id;
  if lbl is null then raise exception 'That purpose is not there any more'; end if;
  if lbl ~* 'breakdown' then raise exception 'Keep the breakdown purpose — its rides ask for the ticket ID by it'; end if;
  select (select count(*) from te_rides where purpose = lbl) + (select count(*) from te_days where purpose = lbl) into n;
  if n > 0 then raise exception '% is used on % rides or days. Untick In use instead', lbl, n; end if;
  delete from te_purposes where id = p_id;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('te-visits', 'te-visits', false, 3145728, array['image/jpeg'])
on conflict (id) do nothing;
drop policy if exists te_visits_put on storage.objects;
drop policy if exists te_visits_get on storage.objects;
drop policy if exists te_visits_del on storage.objects;
create policy te_visits_put on storage.objects for insert to authenticated
  with check (bucket_id = 'te-visits' and (storage.foldername(name))[1] = current_employee_id()::text);
create policy te_visits_get on storage.objects for select to authenticated
  using (bucket_id = 'te-visits' and te_can_see_visits(((storage.foldername(name))[1])::uuid));
create policy te_visits_del on storage.objects for delete to authenticated
  using (bucket_id = 'te-visits' and (storage.foldername(name))[1] = current_employee_id()::text
    and not exists (select 1 from te_visit_photos v where v.path = name));

revoke execute on function public.te_m(float8, float8, float8, float8), public.te_visit_setup(), public.te_visit_place(float8, float8),
  public.te_can_see_visits(uuid), public.te_photo_on(uuid), public.te_photo_add(text, float8, float8, real, timestamptz, text, text),
  public.te_my_photos(date, date), public.te_photo_delete(uuid), public.te_set_purpose_photo(int, boolean), public.te_delete_purpose(int) from public, anon;
grant execute on function public.te_m(float8, float8, float8, float8), public.te_visit_setup(), public.te_visit_place(float8, float8),
  public.te_can_see_visits(uuid), public.te_photo_on(uuid), public.te_photo_add(text, float8, float8, real, timestamptz, text, text),
  public.te_my_photos(date, date), public.te_photo_delete(uuid), public.te_set_purpose_photo(int, boolean), public.te_delete_purpose(int) to authenticated;

CREATE OR REPLACE FUNCTION public.te_claim(p_claim uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c te_claims; out jsonb; me uuid := current_employee_id();
begin
  if not te_can_see(p_claim) then raise exception 'That claim is not yours to see'; end if;
  select * into c from te_claims where id = p_claim;
  select jsonb_build_object(
    'claim', to_jsonb(c) || jsonb_build_object(
      'name', e.full_name, 'ecode', e.ecode,
      'manager', (select full_name from employees where id = e.reporting_manager_id),
      'coordinator', (select full_name from employees where id = coalesce(c.coordinator_id, te_claim_coordinator(c.id))),
      'cost_centre', nullif(btrim(coalesce(e.function_name, '')), ''),
      -- What it takes from the person's advances (te_0063), worked out, and the Advance meter.
      'advance', te_claim_advance(c.id),
      'advance_box', te_advance_box(c.id),
      'mine', c.employee_id = me,
      'can_edit', te_can_edit(p_claim),
      'can_decide', (c.status = 'with_manager' and (e.reporting_manager_id = me or te_is_admin()))
        or (c.status = 'with_coordinator' and (te_claim_coordinator(c.id) = me or te_is_admin()))
        or (c.status = 'with_desk' and te_is_desk()),
      'is_desk', te_is_desk(),
      'is_manager', e.reporting_manager_id = me),
    'rule', to_jsonb(te_rule(c.grade)),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'day', d.day, 'place', d.place, 'district', d.district, 'purpose', d.purpose,
        'da_kind', d.da_kind, 'da_amount', d.da_amount, 'continues_day', d.continues_day, 'remarks', d.remarks,
        'place_lat', d.place_lat, 'place_lng', d.place_lng, 'da_auto', d.da_auto, 'dep_off', d.dep_off,
        -- An auto ride carries what autos usually cost a km around where it started (te_0051).
        'rides', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('auto_norm', case when r.mode = 'auto' then te_auto_norm(r.id) end) order by r.seq) from te_rides r where r.day_id = d.id), '[]'),
        'tickets', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('earlier', (
          select coalesce(jsonb_agg(jsonb_build_object('day', d2.day, 'name', e2.full_name, 'mine', k2.employee_id = c.employee_id) order by d2.day), '[]')
          from te_tickets t2 join te_days d2 on d2.id = t2.day_id join te_claims k2 on k2.id = d2.claim_id join employees e2 on e2.id = k2.employee_id
          where t2.ticket_no = t.ticket_no and d2.day < d.day))) from te_tickets t where t.day_id = d.id), '[]'),
        'hotel', (select to_jsonb(h) || jsonb_build_object('shared_ecode', (select ecode from employees where id = h.shared_with),
                    'shared_name', (select full_name from employees where id = h.shared_with)) from te_hotels h where h.day_id = d.id),
        'room_by', (select jsonb_build_object('name', x.full_name, 'ecode', x.ecode, 'amount', h.amount, 'number', k.number)
                    from te_hotels h join te_days dd on dd.id = h.day_id join te_claims k on k.id = dd.claim_id join employees x on x.id = k.employee_id
                    where h.shared_with = c.employee_id and dd.day = d.day and k.id <> c.id limit 1),
        'expenses', coalesce((select jsonb_agg(to_jsonb(x)) from te_expenses x where x.day_id = d.id), '[]')
      ) order by d.day) from te_days d where d.claim_id = c.id), '[]'),
    'bills', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'owner_kind', b.owner_kind, 'owner_id', b.owner_id,
        'path', b.path, 'name', b.name, 'ocr_amount', b.ocr_amount, 'ocr_date', b.ocr_date, 'ocr_billno', b.ocr_billno,
        -- Possibly the same bill again (te_0032): the same bill number and amount read off it, or the same
        -- picture within 12 of 256 bits; a bill from before keeps its coarse picture, held to 2 of 64. Which
        -- bill it looks like, too (te_0036), so two alike on one claim are told as one pair.
        'twin', case when (tw.o).id is not null then te_bill_label(tw.o) end,
        'twin_owner', (tw.o).owner_id, 'twin_claim', (tw.o).claim_id,
        'refs', b.refs, 'company', te_booking_card(te_bill_company(b))))
      from te_bills b
      left join lateral (select o from te_bills o
                 where o.id <> b.id and b.owner_kind <> 'report' and o.owner_kind <> 'report' and (
                   (b.ocr_billno is not null and b.ocr_amount is not null and o.ocr_billno = b.ocr_billno and o.ocr_amount = b.ocr_amount)
                   or (b.phash2 is not null and o.phash2 is not null and bit_count(('x' || b.phash2)::bit(256) # ('x' || o.phash2)::bit(256)) <= 12)
                   or ((b.phash2 is null or o.phash2 is null) and b.phash is not null and o.phash is not null and bit_count((b.phash # o.phash)::bit(64)) <= 2))
                 limit 1) tw(o) on true
      where b.claim_id = c.id), '[]'),
    'km_month', (select jsonb_build_object(
        'bike', coalesce(sum(r.claimed_km) filter (where r.mode = 'bike'), 0),
        'car', coalesce(sum(r.claimed_km) filter (where r.mode = 'car'), 0),
        'auto', coalesce(sum(r.fare) filter (where r.mode = 'auto'), 0),
        'phone', (select coalesce(sum(x.amount), 0) from te_expenses x join te_days dx on dx.id = x.day_id join te_claims kx on kx.id = dx.claim_id
                  where kx.employee_id = c.employee_id and kx.month = c.month and x.category = 'Phone'))
      from te_rides r join te_days d on d.id = r.day_id join te_claims k on k.id = d.claim_id
      where k.employee_id = c.employee_id and k.month = c.month),
    -- Where the person moved their home (te_0041), for the approvers: each move once, on the claim being made when it
    -- happened — the moves since the person's previous claim was sent, up to this one's sending (te_0073).
    'home_moves', coalesce((select jsonb_agg(jsonb_build_object('at', m.at, 'km', m.km, 'first', m.from_lat is null, 'how', m.how) order by m.at)
      from te_home_moves m where m.employee_id = c.employee_id and m.from_lat is not null
        and m.at <= coalesce(c.submitted_at, now())
        and m.at > coalesce((select max(o.submitted_at) from te_claims o where o.employee_id = c.employee_id and o.id <> c.id
                              and o.submitted_at < coalesce(c.submitted_at, now())), '-infinity')), '[]'),
    -- Bookings the company made for this person in the claim's month that no bill on any claim carries (te_0042).
    'company_unlinked', coalesce((select jsonb_agg(te_booking_card(x.booking_id) order by x.travel_date)
      from (select distinct on (k.booking_id) k.booking_id, k.travel_date from te_company_bookings k
            where k.action in ('BOOKING', 'Date_Change', 'OFFLINE_MODIFICATION')
              and k.travel_date >= c.month and k.travel_date < (c.month + interval '1 month')
              and te_booking_for(k.passengers, k.passenger_ids, e.full_name, e.ecode)
              and not exists (select 1 from te_bills bb where k.booking_id = any(bb.refs) or (k.pnr is not null and k.pnr = any(bb.refs)))
            order by k.booking_id) x), '[]'),
    -- How the home in use was set: by standing there, or on the map (te_0053), for the approvers.
    'home', (select jsonb_build_object('how', h.how, 'set_at', h.set_at) from travel_homes h where h.employee_id = c.employee_id),
    'deputations', coalesce((select jsonb_agg(jsonb_build_object('state', x.state, 'from_day', x.from_day, 'to_day', x.to_day) order by x.from_day)
      from te_deputations x where x.employee_id = c.employee_id and x.status = 'approved'
        and x.from_day < (c.month + interval '1 month')::date and x.to_day >= c.month), '[]'),
    'policy', (select jsonb_object_agg(key, value) from te_policy),
    'purposes', (select jsonb_agg(label order by sort, label) from te_purposes where is_active),
    'office_purposes', (select coalesce(jsonb_agg(label), '[]') from te_purposes where not gives_da),
    -- Visit photos (te_0082): the setup, the person's photos of the claim's month, and "Photo not possible" on their other claims that month.
    'photo_setup', te_visit_setup(),
    'visit_photos', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'day', v.day, 'shot_at', v.shot_at, 'taken_at', v.taken_at, 'lat', v.lat, 'lng', v.lng,
      'accuracy', v.accuracy, 'place', v.place, 'path', case when v.removed_at is null then v.path end) order by v.shot_at)
      from te_visit_photos v where v.employee_id = c.employee_id and v.day >= c.month and v.day < (c.month + interval '1 month')::date), '[]'),
    'photo_skips_other', (select count(*) from te_rides r join te_days d on d.id = r.day_id join te_claims k on k.id = d.claim_id
      where k.employee_id = c.employee_id and k.month = c.month and k.id <> c.id and coalesce(btrim(r.photo_skip), '') <> ''),
    -- Who acted as what (te_0044): a Travel Desk or coordinator step says so beside the name; the
    -- reporting manager's does not. An amount changed or a claim sent back takes the stage it was at.
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'at', v.at, 'action', v.action, 'to_status', v.to_status,
        'note', v.note, 'actor', a.full_name,
        'role', case
          when v.action = 'coordinator_approved' then 'Coordinator'
          when v.action in ('desk_approved', 'paid', 'advance') then 'Travel Desk'
          when v.action in ('adjusted', 'returned') then (
            select case p.to_status when 'with_desk' then 'Travel Desk' when 'with_coordinator' then 'Coordinator' end
            from te_events p where p.claim_id = v.claim_id and p.to_status is not null and (p.at, p.id) < (v.at, v.id)
            order by p.at desc, p.id desc limit 1)
        end) order by v.at, v.id)
      from te_events v left join employees a on a.id = v.actor_id where v.claim_id = c.id), '[]'),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('item_id', j.item_id, 'unit', j.unit, 'old_value', j.old_value, 'new_value', j.new_value,
        'old_amount', j.old_amount, 'new_amount', j.new_amount, 'reason', j.reason, 'by', b.full_name, 'at', j.at) order by j.at)
      from te_adjustments j left join employees b on b.id = j.by_id where j.claim_id = c.id), '[]')
  ) into out
  from employees e where e.id = c.employee_id;
  return out;
end $function$;

CREATE OR REPLACE FUNCTION public.te_save_day(p_claim uuid, p_day jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c te_claims; r te_grade_rules; did uuid := (p_day->>'id')::uuid; x jsonb; amt numeric; n int := 0;
  other text;
begin
  select * into c from te_claims where id = p_claim;
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be changed now'; end if;
  if (p_day->>'day')::date < c.month or (p_day->>'day')::date >= (c.month + interval '1 month') then
    raise exception 'That date is not in this month''s claim';
  end if;
  r := te_rule(c.grade);
  if p_day->>'da_kind' = 'deputation' and te_dep_on(c.employee_id, (p_day->>'day')::date) is null then
    raise exception '% is not in an approved deputation — choose another DA', to_char((p_day->>'day')::date, 'FMDD Mon');
  end if;
  -- One claim a day, so one DA a day (the user, 23 Oct): a date already in another of this person's claims is refused.
  select coalesce(k.number, 'your ' || to_char(k.month, 'FMMon') || ' draft') into other
    from te_days d join te_claims k on k.id = d.claim_id
   where k.employee_id = c.employee_id and k.id <> p_claim and d.day = (p_day->>'day')::date limit 1;
  if other is not null then
    raise exception '% is already claimed in % — one claim a day', to_char((p_day->>'day')::date, 'FMDD Mon'), other;
  end if;
  other := null;
  insert into te_days (id, claim_id, day, place, district, purpose, da_kind, da_amount, continues_day, remarks, place_lat, place_lng, da_auto, dep_off)
  values (did, p_claim, (p_day->>'day')::date, p_day->>'place', p_day->>'district', p_day->>'purpose',
    coalesce(p_day->>'da_kind', 'none'), te_da(c.grade, coalesce(p_day->>'da_kind', 'none'), p_day->>'purpose'),
    nullif(p_day->>'continues_day', '')::date, p_day->>'remarks',
    nullif(p_day->>'place_lat', '')::float8, nullif(p_day->>'place_lng', '')::float8, nullif(p_day->>'da_auto', ''), nullif(p_day->>'dep_off', ''))
  on conflict (id) do update set day = excluded.day, place = excluded.place, district = excluded.district,
    purpose = excluded.purpose, da_kind = excluded.da_kind, da_amount = excluded.da_amount,
    continues_day = excluded.continues_day, remarks = excluded.remarks,
    place_lat = excluded.place_lat, place_lng = excluded.place_lng, da_auto = excluded.da_auto, dep_off = excluded.dep_off;

  delete from te_rides where day_id = did and id not in (select (v->>'id')::uuid from jsonb_array_elements(coalesce(p_day->'rides', '[]')) v);
  for x in select * from jsonb_array_elements(coalesce(p_day->'rides', '[]')) loop
    n := n + 1;
    amt := case x->>'mode'
      when 'bike' then coalesce((x->>'claimed_km')::numeric, 0) * coalesce(r.bike_rate, 5)
      when 'car'  then coalesce((x->>'claimed_km')::numeric, 0) * coalesce(r.car_rate, 11)
      else coalesce((x->>'fare')::numeric, 0) end;
    insert into te_rides (id, day_id, seq, from_name, from_lat, from_lng, to_name, to_lat, to_lng, mode, claimed_km, map_km, fare, amount, note, inter, same_ticket, ticket_date, return_leg, purpose, project, photo_skip)
    values ((x->>'id')::uuid, did, n, x->>'from_name', (x->>'from_lat')::float8, (x->>'from_lng')::float8,
      x->>'to_name', (x->>'to_lat')::float8, (x->>'to_lng')::float8, x->>'mode',
      nullif(x->>'claimed_km', '')::numeric, nullif(x->>'map_km', '')::numeric, nullif(x->>'fare', '')::numeric, round(amt, 2), x->>'note', nullif(x->>'inter', '')::boolean, case when jsonb_typeof(x->'same_ticket') = 'object' then x->'same_ticket' end, nullif(x->>'ticket_date', '')::date, case when jsonb_typeof(x->'return_leg') = 'object' then x->'return_leg' end,
      nullif(btrim(x->>'purpose'), ''), nullif(btrim(x->>'project'), ''), nullif(btrim(x->>'photo_skip'), ''))
    on conflict (id) do update set seq = excluded.seq, from_name = excluded.from_name, from_lat = excluded.from_lat,
      from_lng = excluded.from_lng, to_name = excluded.to_name, to_lat = excluded.to_lat, to_lng = excluded.to_lng,
      mode = excluded.mode, claimed_km = excluded.claimed_km, map_km = excluded.map_km, fare = excluded.fare,
      amount = excluded.amount, note = excluded.note, inter = excluded.inter, same_ticket = excluded.same_ticket, ticket_date = excluded.ticket_date, return_leg = excluded.return_leg,
      purpose = excluded.purpose, project = excluded.project, photo_skip = excluded.photo_skip;
  end loop;

  delete from te_tickets where day_id = did and id not in (select (v->>'id')::uuid from jsonb_array_elements(coalesce(p_day->'tickets', '[]')) v);
  insert into te_tickets (id, day_id, ticket_no, service_report, place)
  select (v->>'id')::uuid, did, trim(v->>'ticket_no'), nullif(trim(v->>'service_report'), ''), nullif(trim(v->>'place'), '')
  from jsonb_array_elements(coalesce(p_day->'tickets', '[]')) v where coalesce(trim(v->>'ticket_no'), '') <> ''
  on conflict (id) do update set ticket_no = excluded.ticket_no, service_report = excluded.service_report, place = excluded.place;

  -- One hotel night. A room a colleague already claimed with this person cannot be claimed again (policy: no split claims).
  -- A night the company paid claims ₹0 and is kept (te_0043).
  if p_day->'hotel' is not null and jsonb_typeof(p_day->'hotel') = 'object' and (coalesce((p_day->'hotel'->>'amount')::numeric, 0) > 0
     or exists (select 1 from te_hotels hh where hh.id = (p_day->'hotel'->>'id')::uuid and hh.company_booking is not null)
     or exists (select 1 from te_bills bb where bb.owner_id = (p_day->'hotel'->>'id')::uuid and te_bill_company(bb) is not null)) then
    select e.full_name || ' (' || e.ecode || ')' into other
    from te_hotels h join te_days d on d.id = h.day_id join te_claims k on k.id = d.claim_id join employees e on e.id = k.employee_id
    where h.shared_with = c.employee_id and d.day = (p_day->>'day')::date and k.id <> p_claim limit 1;
    if other is not null then raise exception 'This room is already claimed by % for that night', other; end if;
    insert into te_hotels (id, day_id, name, note, amount, occupancy, metro, shared_with)
    values ((p_day->'hotel'->>'id')::uuid, did, p_day->'hotel'->>'name', nullif(btrim(p_day->'hotel'->>'note'), ''), (p_day->'hotel'->>'amount')::numeric,
      coalesce(p_day->'hotel'->>'occupancy', 'single'), coalesce((p_day->'hotel'->>'metro')::boolean, false),
      (select id from employees where ecode = upper(trim(p_day->'hotel'->>'shared_ecode'))))
    on conflict (day_id) do update set id = excluded.id, name = excluded.name, note = excluded.note,
      amount = case when te_hotels.company_booking is not null then te_hotels.amount else excluded.amount end,
      occupancy = excluded.occupancy, metro = excluded.metro, shared_with = excluded.shared_with;
  else
    delete from te_hotels where day_id = did;
  end if;

  delete from te_expenses where day_id = did and id not in (select (v->>'id')::uuid from jsonb_array_elements(coalesce(p_day->'expenses', '[]')) v);
  insert into te_expenses (id, day_id, category, description, amount)
  select (v->>'id')::uuid, did, v->>'category', v->>'description', coalesce((v->>'amount')::numeric, 0)
  from jsonb_array_elements(coalesce(p_day->'expenses', '[]')) v where coalesce((v->>'amount')::numeric, 0) > 0
  on conflict (id) do update set category = excluded.category, description = excluded.description, amount = excluded.amount;

  -- Bills whose row is gone go with it; a service report with its ticket (te_0037).
  delete from te_bills b where b.claim_id = p_claim and b.owner_id not in (
    select id from te_rides where day_id in (select id from te_days where claim_id = p_claim)
    union select id from te_hotels where day_id in (select id from te_days where claim_id = p_claim)
    union select id from te_expenses where day_id in (select id from te_days where claim_id = p_claim)
    union select id from te_tickets where day_id in (select id from te_days where claim_id = p_claim))
    and b.created_at < now() - interval '1 day';
  -- Each ticket's hospital learned for everyone (te_0038).
  perform te_learn_places(did, coalesce(p_day->'tickets', '[]'));
  -- A ride or night the company booked claims nothing (te_0042).
  perform te_apply_company(p_claim);
  update te_claims set updated_at = now() where id = p_claim;
  return did;
end $function$;

CREATE OR REPLACE FUNCTION public.te_submit(p_claim uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c te_claims; due date; late int := 0; steps jsonb := te_pol('late_pct'); over numeric := (te_pol('bill_over'))::text::numeric; missing text;
  near_m numeric := coalesce((te_pol('photo_near_m'))::text::numeric, 500); lim int := coalesce((te_pol('photo_skips'))::text::int, 3); used int;
begin
  select * into c from te_claims where id = p_claim;
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be sent now'; end if;
  if not exists (select 1 from te_days where claim_id = p_claim) then raise exception 'Add at least one day first'; end if;
  -- Bills the policy asks for, each named (the user, 19 Oct: "don't know in which is having error").
  select string_agg(item, '; ' order by ord, item) into missing from (
    select d.day as ord, to_char(d.day, 'FMDD Mon') || ' · ' || case r.mode when 'taxi_bike' then 'Uber / Taxi bike' when 'taxi' then 'Uber / Taxi car' else initcap(r.mode) end || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1) as item
    from te_rides r join te_days d on d.id = r.day_id
    where d.claim_id = p_claim and r.same_ticket is null and r.mode not in ('bike', 'car') and (r.amount > over or r.mode = 'taxi_bike') and not exists (select 1 from te_bills b where b.owner_id = r.id)
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · Hotel night' from te_hotels h join te_days d on d.id = h.day_id
    where d.claim_id = p_claim and h.amount > over and not exists (select 1 from te_bills b where b.owner_id = h.id)
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · ' || x.category from te_expenses x join te_days d on d.id = x.day_id
    where d.claim_id = p_claim and (x.amount > over or x.category in ('Courier', 'Tools')) and not exists (select 1 from te_bills b where b.owner_id = x.id)
  ) s;
  if missing is not null then raise exception 'Attach the bill for %', missing; end if;
  -- A breakdown call names its ticket (te_0060).
  select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
    into missing
    from te_rides r join te_days d on d.id = r.day_id
   where d.claim_id = p_claim and r.purpose ilike '%breakdown%'
     and not exists (select 1 from te_tickets t where t.id = r.id and btrim(t.ticket_no) <> '');
  if missing is not null then raise exception 'Enter the ticket ID for %', missing; end if;
  -- Remarks on every flight, train and hotel night (te_0042; the user, 21 Oct).
  select string_agg(item, '; ' order by ord, item) into missing from (
    select d.day as ord, to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1) as item
    from te_rides r join te_days d on d.id = r.day_id
    where d.claim_id = p_claim and r.mode in ('flight', 'train') and coalesce(btrim(r.note), '') = ''
    union all
    select d.day, to_char(d.day, 'FMDD Mon') || ' · Hotel night' from te_hotels h join te_days d on d.id = h.day_id
    where d.claim_id = p_claim and coalesce(btrim(h.note), '') = ''
  ) s;
  if missing is not null then raise exception 'Write the remarks for %', missing; end if;
  -- Visit photos (te_0082): a ride for a purpose needing one has its photo that day within reach, or "Photo not possible" with a reason.
  if coalesce((te_pol('visit_photos'))::text::boolean, false) then
    select string_agg(to_char(d.day, 'FMDD Mon') || ' · ' || initcap(r.mode) || ' ride ' || split_part(coalesce(r.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(r.to_name, '—'), ',', 1), '; ' order by d.day, r.seq)
      into missing
      from te_rides r join te_days d on d.id = r.day_id
     where d.claim_id = p_claim and r.purpose in (select label from te_purposes where photo_needed)
       and r.to_lat is not null and lower(btrim(split_part(coalesce(r.to_name, ''), ',', 1))) <> 'home'
       and coalesce(btrim(r.photo_skip), '') = ''
       and not exists (select 1 from te_visit_photos v where v.employee_id = c.employee_id and v.day = d.day and te_m(v.lat, v.lng, r.to_lat, r.to_lng) <= near_m);
    if missing is not null then raise exception 'Take the visit photo, or choose Photo not possible, for %', missing; end if;
    if coalesce(te_pol('photo_after') #>> '{}', 'block') = 'block' then
      select count(*) into used from te_rides r join te_days d on d.id = r.day_id join te_claims k on k.id = d.claim_id
       where k.employee_id = c.employee_id and k.month = c.month and coalesce(btrim(r.photo_skip), '') <> '' and (k.id = p_claim or k.status <> 'draft');
      if used > lim then raise exception 'Photo not possible is chosen % times in %. The limit is % a month', used, to_char(c.month, 'FMMonth'), lim; end if;
    end if;
  end if;
  -- Late: due by the 5th of the next month; 1, 2, 3 months after that take 10, 20, 30 percent; later is refused.
  due := (c.month + interval '1 month')::date + ((te_pol('submit_by_day'))::text::int - 1);
  if current_date > due then
    late := ((extract(year from age(current_date, due)) * 12 + extract(month from age(current_date, due)))::int) + 1;
    if late > jsonb_array_length(steps) then raise exception 'This month is more than % months late and cannot be claimed', jsonb_array_length(steps); end if;
    late := (steps->>(late - 1))::int;
  end if;
  update te_claims set status = 'with_manager', submitted_at = now(), late_pct = late, return_note = null,
    number = coalesce(number, te_number(nextval('te_claim_seq')::int)),
    updated_at = now()
  where id = p_claim returning number into c.number;
  return c.number;
end $function$;
