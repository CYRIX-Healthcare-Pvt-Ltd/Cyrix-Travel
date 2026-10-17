-- Travel Expense · te_0018 · a day can be added any day: a month can have parts
-- The user, 17 Oct: "everyday also they should have an option". When the month's claim is already
-- sent, a new day goes into the next part of that month (Oct-26 · part 2), sent the same way.
-- A date is claimed once across all parts; monthly limits (km, auto) count every part.
alter table public.te_claims add column if not exists part int not null default 1;
alter table public.te_claims drop constraint if exists te_claims_employee_id_month_key;
alter table public.te_claims add constraint te_claims_employee_month_part_key unique (employee_id, month, part);

create or replace function public.te_open_month(p_month date)
returns uuid language plpgsql security definer set search_path to 'public' as $f$
declare me uuid := current_employee_id(); m date := date_trunc('month', p_month)::date; cid uuid; e employees; last te_claims; nxt int;
begin
  if me is null or not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  if m > date_trunc('month', current_date)::date then raise exception 'A future month cannot be claimed'; end if;
  -- The part still open to change, if there is one.
  select id into cid from te_claims where employee_id = me and month = m and status in ('draft', 'returned') order by part limit 1;
  if cid is not null then return cid; end if;
  select * into e from employees where id = me;
  select * into last from te_claims where employee_id = me order by month desc, part desc limit 1;
  select coalesce(max(part), 0) + 1 into nxt from te_claims where employee_id = me and month = m;
  insert into te_claims (employee_id, month, part, grade, designation, base_location, project, mobile)
  values (me, m, nxt, e.grade, e.designation, coalesce(last.base_location, e.location), last.project, coalesce(last.mobile, e.official_phone))
  returning id into cid;
  return cid;
end $f$;

/** One date, one claim: the same day cannot be on two parts (or claimed twice). */
create or replace function public.te_day_once()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare other text;
begin
  if new.day > current_date then raise exception 'A future date cannot be claimed'; end if;
  select coalesce(k.number, 'your ' || to_char(k.month, 'Mon-YY') || ' claim') into other
  from te_days d join te_claims k on k.id = d.claim_id
  where d.day = new.day and d.claim_id <> new.claim_id and d.id <> new.id
    and k.employee_id = (select employee_id from te_claims where id = new.claim_id) limit 1;
  if other is not null then raise exception '% is already on %', to_char(new.day, 'DD Mon'), other; end if;
  return new;
end $f$;
drop trigger if exists te_day_once on public.te_days;
create trigger te_day_once before insert or update of day on public.te_days for each row execute function public.te_day_once();

drop function if exists public.te_my_claims();
create function public.te_my_claims()
returns table (id uuid, month date, part int, status text, number text, total numeric, days int)
language sql stable security definer set search_path to 'public' as $f$
  select c.id, c.month, c.part, c.status, c.number, te_total(c.id), (select count(*)::int from te_days d where d.claim_id = c.id)
  from te_claims c where c.employee_id = current_employee_id() order by c.month desc, c.part desc
$f$;

drop function if exists public.te_inbox();
create function public.te_inbox()
returns table (id uuid, month date, part int, status text, number text, total numeric, name text, ecode text, submitted_at timestamptz, waiting boolean)
language sql stable security definer set search_path to 'public' as $f$
  with mine as (
    select c.*, e.full_name, e.ecode,
      (c.status = 'with_manager' and e.reporting_manager_id = current_employee_id())
      or (c.delete_requested_at is not null and e.reporting_manager_id = current_employee_id())
      or (c.status = 'with_coordinator' and exists (select 1 from te_coordinators k where k.employee_id = c.employee_id and k.coordinator_id = current_employee_id()))
      or (c.status = 'with_desk' and te_is_desk()) as waiting
    from te_claims c join employees e on e.id = c.employee_id
    where c.status <> 'draft' and c.employee_id <> current_employee_id() and te_can_see(c.id)
  )
  select id, month, part, status, number, te_total(id), full_name, ecode, submitted_at, waiting
  from mine order by waiting desc, submitted_at desc nulls last limit 200
$f$;

-- Monthly km and auto counted over every part of the month.
/** The whole claim as one value: header, days with everything on them, bills, and what is flagged. */
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
        'auto', coalesce(sum(r.fare) filter (where r.mode = 'auto'), 0))
      from te_rides r join te_days d on d.id = r.day_id join te_claims k on k.id = d.claim_id
      where k.employee_id = c.employee_id and k.month = c.month),
    'policy', (select jsonb_object_agg(key, value) from te_policy),
    'purposes', (select jsonb_agg(label order by sort, label) from te_purposes where is_active),
    'office_purposes', (select coalesce(jsonb_agg(label), '[]') from te_purposes where not gives_da)
  ) into out
  from employees e where e.id = c.employee_id;
  return out;
end $f$;


revoke execute on function public.te_my_claims(), public.te_inbox() from public, anon;
grant execute on function public.te_my_claims(), public.te_inbox() to authenticated;
