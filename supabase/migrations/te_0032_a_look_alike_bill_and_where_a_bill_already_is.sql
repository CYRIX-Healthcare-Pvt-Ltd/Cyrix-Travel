-- Travel Expense · te_0032 · a bill that only looks alike is no longer called the same; a refusal says which
-- Tested 19 Oct (the user: "check duplicate invoice check, deep logical checking"): two different printed
-- receipts — a train ticket and a courier slip — were flagged as look-alikes. The picture fingerprint was a
-- 9 × 8 difference hash, and at that size any white slip with black lines looks the same (4 of 64 bits
-- apart, under the 5 allowed). Now a 17 × 16 one, 256 bits: the same photo resized and re-saved came 7
-- apart, different receipts 18 to 28; a bill counts as the same picture at 12 or less. A photo taken again
-- at an angle is caught by its bill number and amount instead, as before.
-- And "Same bill as an unsent claim · 19 Oct" named the day it was uploaded: now the claim, what the bill
-- was for and its day — "TE-02 · Bus ride, 17 Oct · Nivek - Test".

alter table public.te_bills add column if not exists phash2 text;

/** Where a bill already is: its claim, what it was for and that day, and whose. */
create or replace function public.te_bill_label(b te_bills)
returns text language sql stable security definer set search_path to 'public' as $f$
  select coalesce(k.number, 'the unsent ' || to_char(k.month, 'Mon-YY') || ' claim') || ' · '
    || coalesce(
         case b.owner_kind
           when 'ride' then (select initcap(r.mode) || ' ride, ' || to_char(d.day, 'FMDD Mon') from te_rides r join te_days d on d.id = r.day_id where r.id = b.owner_id)
           when 'hotel' then (select 'Hotel night, ' || to_char(d.day, 'FMDD Mon') from te_hotels h join te_days d on d.id = h.day_id where h.id = b.owner_id)
           when 'expense' then (select x.category || ', ' || to_char(d.day, 'FMDD Mon') from te_expenses x join te_days d on d.id = x.day_id where x.id = b.owner_id)
         end, to_char(b.created_at at time zone 'Asia/Kolkata', 'FMDD Mon'))
    || ' · ' || e.full_name
  from te_claims k join employees e on e.id = k.employee_id where k.id = b.claim_id
$f$;

create or replace function public.te_bill_used(p_sha256 text)
returns text language sql stable security definer set search_path to 'public' as $f$
  select te_bill_label(b) from te_bills b where b.sha256 = p_sha256 and travel_has_access() limit 1
$f$;

drop function if exists public.te_add_bill(uuid, text, uuid, text, text, text, bigint, numeric, date, text);
create or replace function public.te_add_bill(p_claim uuid, p_kind text, p_owner uuid, p_path text, p_name text,
  p_sha256 text, p_phash bigint, p_amount numeric, p_date date, p_billno text, p_phash2 text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $f$
declare used text; bid uuid;
begin
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be changed now'; end if;
  select te_bill_label(b) into used from te_bills b where b.sha256 = p_sha256;
  if used is not null then raise exception 'Same bill as %', used; end if;
  insert into te_bills (claim_id, owner_kind, owner_id, path, name, sha256, phash, phash2, ocr_amount, ocr_date, ocr_billno, uploaded_by)
  values (p_claim, p_kind, p_owner, p_path, p_name, p_sha256, p_phash, nullif(p_phash2, ''), p_amount, p_date, nullif(trim(p_billno), ''), current_employee_id())
  returning id into bid;
  return bid;
end $f$;

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
        -- Possibly the same bill again (te_0032): the same bill number and amount read off it, or the same
        -- picture within 12 of 256 bits (a copy resized or re-saved); a bill from before keeps its coarse
        -- picture, held to 2 of 64.
        'twin', (select te_bill_label(o) from te_bills o
                 where o.id <> b.id and (
                   (b.ocr_billno is not null and o.ocr_billno = b.ocr_billno and o.ocr_amount is not distinct from b.ocr_amount)
                   or (b.phash2 is not null and o.phash2 is not null and bit_count(('x' || b.phash2)::bit(256) # ('x' || o.phash2)::bit(256)) <= 12)
                   or ((b.phash2 is null or o.phash2 is null) and b.phash is not null and o.phash is not null and bit_count((b.phash # o.phash)::bit(64)) <= 2))
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

revoke execute on function public.te_bill_label(te_bills) from public, anon;
grant execute on function public.te_bill_label(te_bills) to authenticated;
revoke execute on function public.te_add_bill(uuid, text, uuid, text, text, text, bigint, numeric, date, text, text) from public, anon;
grant execute on function public.te_add_bill(uuid, text, uuid, text, text, text, bigint, numeric, date, text, text) to authenticated;
