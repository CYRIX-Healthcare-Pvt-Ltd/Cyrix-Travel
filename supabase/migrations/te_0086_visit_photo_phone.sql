/*
  te_0086 — which phone took a visit photo (the user, 30 Oct: "i told my friend to login to my id and take visit pic ...
  do we have option to lock or show it in observation?" — observation first). The app gives each phone its own id on
  first use and sends it, with the phone's model, with every visit photo; te_claim returns them and the person's usual
  phone (most of their photos), and a photo from another phone is an observation for the approver.
*/
alter table public.te_visit_photos add column if not exists device_id text, add column if not exists device text;

drop function if exists public.te_photo_add(text, double precision, double precision, real, timestamp with time zone, text, text);
create or replace function public.te_photo_add(p_path text, p_lat float8, p_lng float8, p_acc real, p_shot_at timestamptz, p_place text, p_sha256 text,
  p_device_id text default null, p_device text default null)
 returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare me uuid := current_employee_id(); v te_visit_photos;
begin
  if me is null then raise exception 'Sign in again'; end if;
  if not coalesce((te_pol('visit_photos'))::text::boolean, false) then raise exception 'Visit photos are switched off'; end if;
  if split_part(p_path, '/', 1) <> me::text then raise exception 'Not your folder'; end if;
  if p_shot_at > now() + interval '5 minutes' then raise exception 'The phone''s clock is ahead. Set the right time, then take the photo again'; end if;
  if p_shot_at < now() - interval '2 days' then raise exception 'This photo is too old to add'; end if;
  if p_sha256 is not null and exists (select 1 from te_visit_photos where employee_id = me and sha256 = p_sha256) then raise exception 'This photo is added already'; end if;
  insert into te_visit_photos (employee_id, day, shot_at, lat, lng, accuracy, place, path, sha256, device_id, device)
  values (me, (p_shot_at at time zone 'Asia/Kolkata')::date, p_shot_at, p_lat, p_lng, p_acc, nullif(btrim(p_place), ''), p_path, p_sha256,
    left(nullif(btrim(p_device_id), ''), 64), left(nullif(btrim(p_device), ''), 80))
  returning * into v;
  return to_jsonb(v);
end $$;
revoke all on function public.te_photo_add(text, double precision, double precision, real, timestamp with time zone, text, text, text, text) from public, anon;
grant execute on function public.te_photo_add(text, double precision, double precision, real, timestamp with time zone, text, text, text, text) to authenticated;

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
      'accuracy', v.accuracy, 'place', v.place, 'path', case when v.removed_at is null then v.path end, 'device_id', v.device_id, 'device', v.device) order by v.shot_at)
      from te_visit_photos v where v.employee_id = c.employee_id and v.day >= c.month and v.day < (c.month + interval '1 month')::date), '[]'),
    -- The phone most of the person's visit photos came from (te_0086).
    'usual_device', (select jsonb_build_object('device_id', u.device_id, 'device', u.device) from (
      select v.device_id, max(v.device) device from te_visit_photos v where v.employee_id = c.employee_id and v.device_id is not null
      group by v.device_id order by count(*) desc, max(v.shot_at) desc limit 1) u),
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
