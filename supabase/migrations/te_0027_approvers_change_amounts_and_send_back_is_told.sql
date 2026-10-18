-- Travel Expense · te_0027 · approvers can change an amount; a claim sent back is told
-- The user, 18 Oct:
--   "manager and travel desk or coordinator should be able to edit the claim amount, so in history also
--    it should, because if manager / coord / travel desk doesn't feel he claimed correct they can edit"
--   "send back should go directly to claimed person and manager should get notification"

-- ---------------------------------------------------------------- what an approver changed, and from what
create table if not exists public.te_adjustments (
  id bigserial primary key,
  claim_id uuid not null references public.te_claims(id) on delete cascade,
  item_kind text not null check (item_kind in ('ride', 'hotel', 'expense', 'da')),
  item_id uuid not null,
  label text not null,
  unit text not null default '₹',
  old_value numeric, new_value numeric not null,
  old_amount numeric, new_amount numeric not null,
  reason text not null,
  by_id uuid references public.employees(id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists te_adjustments_claim on public.te_adjustments (claim_id, at);
alter table public.te_adjustments enable row level security;

/*
  Whoever the claim waits on — the manager, the coordinator, the Travel Desk — changes one figure:
  a bike or car ride's km (its amount follows the grade's rate), another ride's fare, the hotel night,
  an expense, or the day's DA. With a reason, into the history, and the person is told.
*/
create or replace function public.te_adjust(p_claim uuid, p_kind text, p_item uuid, p_value numeric, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare
  c te_claims; me uuid := current_employee_id(); mgr uuid; r te_grade_rules; rd te_rides;
  day_of date; old_v numeric; old_a numeric; new_a numeric; u text := '₹'; lbl text;
  fmt_old text; fmt_new text;
begin
  select * into c from te_claims where id = p_claim for update;
  if c.id is null then raise exception 'No such claim'; end if;
  select reporting_manager_id into mgr from employees where id = c.employee_id;
  if not ((c.status = 'with_manager' and (mgr = me or te_is_admin()))
       or (c.status = 'with_coordinator' and (exists (select 1 from te_coordinators k where k.employee_id = c.employee_id and k.coordinator_id = me) or te_is_admin()))
       or (c.status = 'with_desk' and te_is_desk())) then
    raise exception 'Only whoever the claim waits on can change it';
  end if;
  if c.employee_id = me then raise exception 'Nobody changes their own claim here'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it is changed'; end if;
  if p_value is null or p_value < 0 then raise exception 'Type the new figure'; end if;
  r := te_rule(c.grade);

  if p_kind = 'ride' then
    select x.* into rd from te_rides x join te_days d on d.id = x.day_id where x.id = p_item and d.claim_id = p_claim;
    if rd.id is null then raise exception 'That ride is not on this claim'; end if;
    select day into day_of from te_days where id = rd.day_id;
    lbl := initcap(rd.mode) || ' ' || split_part(coalesce(rd.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(rd.to_name, '—'), ',', 1);
    old_a := rd.amount;
    if rd.mode in ('bike', 'car') then
      u := 'km'; old_v := rd.claimed_km;
      new_a := round(p_value * case when rd.mode = 'bike' then coalesce(r.bike_rate, 5) else coalesce(r.car_rate, 11) end, 2);
      if old_v is not distinct from p_value then return; end if;
      update te_rides set claimed_km = p_value, amount = new_a where id = p_item;
    else
      old_v := rd.fare; new_a := p_value;
      if old_v is not distinct from p_value then return; end if;
      update te_rides set fare = p_value, amount = p_value where id = p_item;
    end if;
  elsif p_kind = 'hotel' then
    select h.amount, d.day, 'Hotel' || coalesce(' ' || nullif(trim(h.name), ''), '') into old_v, day_of, lbl
    from te_hotels h join te_days d on d.id = h.day_id where h.id = p_item and d.claim_id = p_claim;
    if day_of is null then raise exception 'That hotel night is not on this claim'; end if;
    if old_v is not distinct from p_value then return; end if;
    old_a := old_v; new_a := p_value;
    update te_hotels set amount = p_value where id = p_item;
  elsif p_kind = 'expense' then
    select x.amount, d.day, x.category || coalesce(' · ' || nullif(trim(x.description), ''), '') into old_v, day_of, lbl
    from te_expenses x join te_days d on d.id = x.day_id where x.id = p_item and d.claim_id = p_claim;
    if day_of is null then raise exception 'That expense is not on this claim'; end if;
    if old_v is not distinct from p_value then return; end if;
    old_a := old_v; new_a := p_value;
    update te_expenses set amount = p_value where id = p_item;
  elsif p_kind = 'da' then
    select da_amount, day, 'DA' into old_v, day_of, lbl from te_days where id = p_item and claim_id = p_claim;
    if day_of is null then raise exception 'That day is not on this claim'; end if;
    if old_v is not distinct from p_value then return; end if;
    old_a := old_v; new_a := p_value;
    update te_days set da_amount = p_value where id = p_item;
  else
    raise exception 'Nothing to change there';
  end if;

  insert into te_adjustments (claim_id, item_kind, item_id, label, unit, old_value, new_value, old_amount, new_amount, reason, by_id)
  values (p_claim, p_kind, p_item, lbl, u, old_v, p_value, old_a, new_a, trim(p_reason), me);
  fmt_old := case when u = 'km' then rtrim(rtrim(to_char(coalesce(old_v, 0), 'FM999990.0'), '0'), '.') || ' km (₹' || trim(to_char(coalesce(old_a, 0), 'FM999,999,990')) || ')'
                  else '₹' || trim(to_char(coalesce(old_v, 0), 'FM999,999,990')) end;
  fmt_new := case when u = 'km' then rtrim(rtrim(to_char(p_value, 'FM999990.0'), '0'), '.') || ' km (₹' || trim(to_char(new_a, 'FM999,999,990')) || ')'
                  else '₹' || trim(to_char(p_value, 'FM999,999,990')) end;
  insert into te_events (claim_id, actor_id, action, note)
  values (p_claim, me, 'adjusted', to_char(day_of, 'FMDD Mon') || ' · ' || lbl || ': ' || fmt_old || ' → ' || fmt_new || E'\n' || trim(p_reason));
  update te_claims set updated_at = now() where id = p_claim;
end $f$;
revoke execute on function public.te_adjust(uuid, text, uuid, numeric, text) from public, anon;
grant execute on function public.te_adjust(uuid, text, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------- telling people: the bell, and their devices
-- A Travel message goes into the bell of the person it is for (push_inbox), and the push function
-- sends it to their phone or computer, opening the claim.
alter table public.push_messages drop constraint if exists push_messages_kind_check;
alter table public.push_messages add constraint push_messages_kind_check check (kind in ('manual', 'reminder', 'travel'));

create or replace function public.te_notify(p_claim uuid, p_to uuid, p_title text, p_body text, p_by uuid)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare mid uuid;
begin
  if p_to is null or p_to = p_by then return; end if;
  insert into push_messages (kind, title, body, url, target, sent_by)
  values ('travel', left(p_title, 80), left(coalesce(p_body, ''), 400), '/travel/claim/' || p_claim,
          jsonb_build_object('kind', 'travel', 'claim', p_claim), p_by)
  returning id into mid;
  insert into push_inbox (message_id, employee_id) values (mid, p_to);
end $f$;
revoke execute on function public.te_notify(uuid, uuid, text, text, uuid) from public, anon, authenticated;

/*
  Sent back: the person whose claim it is, and their manager when somebody else sent it back (the user,
  18 Oct). An amount changed: the person.
*/
create or replace function public.te_tell()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare c te_claims; e employees; who text; role text; num text; says text;
begin
  if new.action not in ('returned', 'adjusted') then return new; end if;
  select * into c from te_claims where id = new.claim_id;
  select * into e from employees where id = c.employee_id;
  num := coalesce(c.number, to_char(c.month, 'Mon-YY') || ' claim');
  who := coalesce((select split_part(full_name, ' ', 1) from employees where id = new.actor_id), 'Someone');
  role := case when new.actor_id = e.reporting_manager_id then 'manager'
               when exists (select 1 from te_coordinators k where k.employee_id = c.employee_id and k.coordinator_id = new.actor_id) then 'coordinator'
               when exists (select 1 from user_roles u where u.employee_id = new.actor_id and u.role = 'travel_desk') then 'Travel Desk'
               else 'admin' end;
  says := who || ' (' || role || '): ' || replace(coalesce(new.note, ''), E'\n', ' — ');
  if new.action = 'returned' then
    perform te_notify(c.id, c.employee_id, num || ' sent back to you', says, new.actor_id);
    if new.actor_id is distinct from e.reporting_manager_id then
      perform te_notify(c.id, e.reporting_manager_id, split_part(e.full_name, ' ', 1) || '''s ' || num || ' sent back', says, new.actor_id);
    end if;
  else
    perform te_notify(c.id, c.employee_id, num || ': an amount was changed', says, new.actor_id);
  end if;
  return new;
end $f$;
revoke execute on function public.te_tell() from public, anon, authenticated;
drop trigger if exists te_events_tell on public.te_events;
create trigger te_events_tell after insert on public.te_events for each row execute function public.te_tell();

-- ---------------------------------------------------------------- the claim, with what was changed
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
      from te_events v left join employees a on a.id = v.actor_id where v.claim_id = c.id), '[]'),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('item_id', j.item_id, 'unit', j.unit, 'old_value', j.old_value, 'new_value', j.new_value,
        'old_amount', j.old_amount, 'new_amount', j.new_amount, 'reason', j.reason, 'by', b.full_name, 'at', j.at) order by j.at)
      from te_adjustments j left join employees b on b.id = j.by_id where j.claim_id = c.id), '[]')
  ) into out
  from employees e where e.id = c.employee_id;
  return out;
end $f$;
