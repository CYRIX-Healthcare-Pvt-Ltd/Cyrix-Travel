-- Travel Expense · te_0053 · a home set on the map
-- The user, 21 Oct: "home setting is tough, I cannot mark it on the map". A home may now be set on the map
-- as well as by standing there and pressing; how it was set is kept, with each move, and the approvers of
-- every claim see a home set on the map until the person presses I'm at home there.

alter table public.travel_homes add column if not exists how text not null default 'here';
alter table public.te_home_moves add column if not exists how text not null default 'here';
do $$ begin
  alter table public.travel_homes add constraint travel_homes_how check (how in ('here', 'map'));
exception when duplicate_object then null; end $$;

drop function if exists public.travel_set_home(double precision, double precision);
create or replace function public.travel_set_home(p_lat double precision, p_lng double precision, p_how text default 'here')
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare was travel_homes; me uuid := current_employee_id(); far numeric;
begin
  if not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  if coalesce(p_how, '') not in ('here', 'map') then raise exception 'Mark your home by standing there or on the map'; end if;
  if not travel_point_ok(p_lat, p_lng) then
    raise exception '%', case when p_how = 'map' then 'Choose your home on the map' else 'Your location could not be read — allow location and try again' end;
  end if;
  select * into was from travel_homes where employee_id = me;
  far := case when was.employee_id is null then null else round(te_km(was.lat, was.lng, p_lat, p_lng)::numeric, 1) end;
  insert into travel_homes (employee_id, lat, lng, how) values (me, p_lat, p_lng, p_how)
  on conflict (employee_id) do update set lat = excluded.lat, lng = excluded.lng, how = excluded.how, set_at = now();
  -- The first mark, and any move of more than 200 m (a phone reading wanders a little).
  if was.employee_id is null or far > 0.2 then
    insert into te_home_moves (employee_id, from_lat, from_lng, to_lat, to_lng, km, how)
    values (me, was.lat, was.lng, p_lat, p_lng, far, p_how);
  end if;
end $function$;
revoke all on function public.travel_set_home(double precision, double precision, text) from public, anon;
grant execute on function public.travel_set_home(double precision, double precision, text) to authenticated;

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
      'coordinator', (select x.full_name from te_coordinators k join employees x on x.id = k.coordinator_id where k.employee_id = c.employee_id),
      'mine', c.employee_id = me,
      'can_edit', te_can_edit(p_claim),
      'can_decide', (c.status = 'with_manager' and (e.reporting_manager_id = me or te_is_admin()))
        or (c.status = 'with_coordinator' and (exists (select 1 from te_coordinators k where k.employee_id = c.employee_id and k.coordinator_id = me) or te_is_admin()))
        or (c.status = 'with_desk' and te_is_desk()),
      'is_desk', te_is_desk(),
      'is_manager', e.reporting_manager_id = me),
    'rule', to_jsonb(te_rule(c.grade)),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'day', d.day, 'place', d.place, 'district', d.district, 'purpose', d.purpose,
        'da_kind', d.da_kind, 'da_amount', d.da_amount, 'continues_day', d.continues_day, 'remarks', d.remarks,
        'place_lat', d.place_lat, 'place_lng', d.place_lng, 'da_auto', d.da_auto,
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
    -- Where the person moved their home while this claim was open (te_0041), for the approvers.
    'home_moves', coalesce((select jsonb_agg(jsonb_build_object('at', m.at, 'km', m.km, 'first', m.from_lat is null, 'how', m.how) order by m.at)
      from te_home_moves m where m.employee_id = c.employee_id and m.from_lat is not null
        and m.at >= c.month and m.at <= coalesce(c.submitted_at, now())), '[]'),
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
    'policy', (select jsonb_object_agg(key, value) from te_policy),
    'purposes', (select jsonb_agg(label order by sort, label) from te_purposes where is_active),
    'office_purposes', (select coalesce(jsonb_agg(label), '[]') from te_purposes where not gives_da),
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
end $function$
;
