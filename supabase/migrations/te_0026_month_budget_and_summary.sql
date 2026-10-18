-- Travel Expense · te_0026 · the month's budget left, and a summary
-- The user, 18 Oct: "this is the budget isn't it? so in each claim when they apply it should show the
-- balance also, they have in month, and need a summary tab also". The month's limits are the grade's
-- bike and car km a month and the auto and phone allowances; used is everything claimed that month,
-- across its parts, sent or not.

-- ---------------------------------------------------------------- the claim: the month's phone spend joins bike, car and auto
create or replace function public.te_claim(p_claim uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
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
        'rides', coalesce((select jsonb_agg(to_jsonb(r) order by r.seq) from te_rides r where r.day_id = d.id), '[]'),
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
        -- Possibly the same bill photographed again: the same amount, date and bill number, or a look-alike picture.
        'twin', (select coalesce(k.number, 'an unsent claim') || ' · ' || x.full_name from te_bills o join te_claims k on k.id = o.claim_id join employees x on x.id = k.employee_id
                 where o.id <> b.id and (
                   (b.ocr_billno is not null and o.ocr_billno = b.ocr_billno and o.ocr_amount is not distinct from b.ocr_amount)
                   or (b.phash is not null and o.phash is not null and bit_count((b.phash # o.phash)::bit(64)) <= 5))
                 limit 1))) from te_bills b where b.claim_id = c.id), '[]'),
    'km_month', (select jsonb_build_object(
        'bike', coalesce(sum(r.claimed_km) filter (where r.mode = 'bike'), 0),
        'car', coalesce(sum(r.claimed_km) filter (where r.mode = 'car'), 0),
        'auto', coalesce(sum(r.fare) filter (where r.mode = 'auto'), 0),
        'phone', (select coalesce(sum(x.amount), 0) from te_expenses x join te_days dx on dx.id = x.day_id join te_claims kx on kx.id = dx.claim_id
                  where kx.employee_id = c.employee_id and kx.month = c.month and x.category = 'Phone'))
      from te_rides r join te_days d on d.id = r.day_id join te_claims k on k.id = d.claim_id
      where k.employee_id = c.employee_id and k.month = c.month),
    'policy', (select jsonb_object_agg(key, value) from te_policy),
    'purposes', (select jsonb_agg(label order by sort, label) from te_purposes where is_active),
    'office_purposes', (select coalesce(jsonb_agg(label), '[]') from te_purposes where not gives_da),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'at', v.at, 'action', v.action, 'to_status', v.to_status,
        'note', v.note, 'actor', a.full_name) order by v.at, v.id)
      from te_events v left join employees a on a.id = v.actor_id where v.claim_id = c.id), '[]')
  ) into out
  from employees e where e.id = c.employee_id;
  return out;
end $f$;

/*
  The summary (the user, 18 Oct: "need a summary tab"): for a period of claim months (This month,
  Last month, All time — calendar months), the person's own claims by where they stand and by kind,
  the month's budget when it is one month, and — for a manager, coordinator, the Travel Desk or the
  admins — the sent claims of the people they see, one row a person.
*/
create or replace function public.te_summary(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
declare me uuid := current_employee_id(); g text; r te_grade_rules;
begin
  if not travel_has_access() then raise exception 'Travel Expense is not open to you yet'; end if;
  select grade into g from employees where id = me;
  r := te_rule(g);
  return jsonb_build_object(
    'mine', (
      with k as (select c.id, c.status, te_total(c.id) total from te_claims c
                 where c.employee_id = me and (p_from is null or c.month >= p_from) and (p_to is null or c.month <= p_to))
      select jsonb_build_object(
        'claimed', coalesce(sum(total), 0),
        'not_sent', coalesce(sum(total) filter (where status in ('draft', 'returned', 'recalled')), 0),
        'pending', coalesce(sum(total) filter (where status in ('with_manager', 'with_coordinator', 'with_desk')), 0),
        'approved', coalesce(sum(total) filter (where status = 'approved'), 0),
        'paid', coalesce(sum(total) filter (where status = 'paid'), 0),
        'claims', count(*) filter (where status <> 'draft'),
        'travel', (select coalesce(sum(x.amount), 0) from te_rides x join te_days d on d.id = x.day_id where d.claim_id in (select id from k)),
        'da', (select coalesce(sum(d.da_amount), 0) from te_days d where d.claim_id in (select id from k)),
        'hotel', (select coalesce(sum(x.amount), 0) from te_hotels x join te_days d on d.id = x.day_id where d.claim_id in (select id from k)),
        'other', (select coalesce(sum(x.amount), 0) from te_expenses x join te_days d on d.id = x.day_id where d.claim_id in (select id from k)),
        'days', (select count(*) from te_days d where d.claim_id in (select id from k)),
        'tickets', (select count(distinct t.ticket_no) from te_tickets t join te_days d on d.id = t.day_id where d.claim_id in (select id from k)),
        'km', (select coalesce(sum(case when x.mode in ('bike', 'car') then coalesce(x.claimed_km, x.map_km) else x.map_km end), 0)
               from te_rides x join te_days d on d.id = x.day_id where d.claim_id in (select id from k)),
        'bike_km', (select coalesce(sum(x.claimed_km), 0) from te_rides x join te_days d on d.id = x.day_id where d.claim_id in (select id from k) and x.mode = 'bike'),
        'car_km', (select coalesce(sum(x.claimed_km), 0) from te_rides x join te_days d on d.id = x.day_id where d.claim_id in (select id from k) and x.mode = 'car'),
        'auto', (select coalesce(sum(x.fare), 0) from te_rides x join te_days d on d.id = x.day_id where d.claim_id in (select id from k) and x.mode = 'auto'),
        'phone', (select coalesce(sum(x.amount), 0) from te_expenses x join te_days d on d.id = x.day_id where d.claim_id in (select id from k) and x.category = 'Phone'))
      from k),
    'limits', jsonb_build_object('grade', g, 'bike_km', r.bike_km_month, 'car_km', r.car_km_month,
      'auto', (te_pol('auto_month'))::text::numeric, 'phone', (te_pol('phone_month'))::text::numeric),
    'scope', case when te_is_admin() or te_is_desk() then 'all' else 'team' end,
    'team', coalesce((
      select jsonb_agg(p order by p->>'name') from (
        select jsonb_build_object('ecode', e.ecode, 'name', e.full_name,
          'claims', count(*),
          'claimed', sum(te_total(c.id)),
          'pending', coalesce(sum(te_total(c.id)) filter (where c.status in ('with_manager', 'with_coordinator', 'with_desk')), 0),
          'approved', coalesce(sum(te_total(c.id)) filter (where c.status = 'approved'), 0),
          'paid', coalesce(sum(te_total(c.id)) filter (where c.status = 'paid'), 0),
          'waiting', count(*) filter (where (c.status = 'with_manager' and e.reporting_manager_id = me)
              or (c.status = 'with_coordinator' and exists (select 1 from te_coordinators kk where kk.employee_id = c.employee_id and kk.coordinator_id = me))
              or (c.status = 'with_desk' and te_is_desk()))) p
        from te_claims c join employees e on e.id = c.employee_id
        where c.employee_id <> me and c.status not in ('draft') and te_can_see(c.id)
          and (p_from is null or c.month >= p_from) and (p_to is null or c.month <= p_to)
        group by e.id, e.ecode, e.full_name) s), '[]'));
end $f$;
revoke execute on function public.te_summary(date, date) from public, anon;
grant execute on function public.te_summary(date, date) to authenticated;
