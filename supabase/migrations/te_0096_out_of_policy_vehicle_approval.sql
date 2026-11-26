/*
  te_0096 — a vehicle the grade does not give, asked for and approved before it is used (the user, 2 Nov: "aneesh pb
  company gave approval for using car, but it is out of policy so can we add option to request … so reporting manager
  will approve and then goes to travel desk to approve"; "not only car, ie for some grades some vehicles may be out of
  policy … that all he can request and manager can remove it also after approval"). From My profile: the vehicle, the
  dates, why, and the approval letter if there is one. The reporting manager, then the Travel Desk. Approved, its rides
  in those dates are no longer marked out of policy. The manager can remove it; days from then on are out of policy again.
*/
create table if not exists public.te_vehicle_approvals (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  number text,
  mode text not null check (mode in ('car', 'bike', 'taxi', 'flight')),
  from_day date not null,
  to_day date not null,
  reason text not null,
  letter_path text, letter_name text,
  status text not null default 'with_manager' check (status in ('with_manager', 'with_desk', 'approved', 'returned', 'withdrawn', 'removed')),
  manager_by uuid references public.employees(id), manager_at timestamptz,
  desk_by uuid references public.employees(id), desk_at timestamptz,
  returned_by uuid references public.employees(id), returned_at timestamptz,
  removed_by uuid references public.employees(id), removed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  check (to_day >= from_day)
);
create index if not exists te_vehicle_approvals_employee on public.te_vehicle_approvals (employee_id, from_day);
alter table public.te_vehicle_approvals enable row level security;

create or replace function public.te_va_label(p_mode text)
returns text language sql immutable as $$
  select case p_mode when 'car' then 'Car' when 'bike' then 'Bike' when 'taxi' then 'Uber / Taxi · Car' when 'flight' then 'Flight' else p_mode end
$$;

/* The vehicles a person's grade does not give. */
create or replace function public.te_va_modes(p_employee uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when r.car_rate is null then 'car' end, case when r.bike_rate is null then 'bike' end,
    case when not coalesce(r.taxi, false) then 'taxi' end, case when not coalesce(r.flight, false) then 'flight' end], null)
  from employees e cross join lateral te_rule(e.grade) r where e.id = p_employee
$$;

/* The last day an approval covers: its To, or the day before it was removed. */
create or replace function public.te_va_until(v te_vehicle_approvals)
returns date language sql immutable as $$
  select case when v.status = 'removed' then least(v.to_day, (v.removed_at at time zone 'Asia/Kolkata')::date - 1) else v.to_day end
$$;

create or replace function public.te_va_request(p_mode text, p_from date, p_to date, p_reason text, p_path text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); e employees; why text := nullif(btrim(coalesce(p_reason, '')), ''); v te_vehicle_approvals; clash te_vehicle_approvals;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into e from employees where id = me;
  if e.reporting_manager_id is null then raise exception 'You have no reporting manager to approve it'; end if;
  if not (p_mode = any (te_va_modes(me))) then raise exception '% is already in your grade''s policy', te_va_label(p_mode); end if;
  if p_from is null or p_to is null then raise exception 'Choose the from and to dates'; end if;
  if p_to < p_from then raise exception 'The to date is before the from date'; end if;
  if p_to - p_from > 366 then raise exception 'An approval is up to a year'; end if;
  if why is null or length(why) < 3 then raise exception 'Write why'; end if;
  if p_path is not null and p_path not like me::text || '/%' then raise exception 'Upload the letter again'; end if;
  select * into clash from te_vehicle_approvals
  where employee_id = me and mode = p_mode and status in ('with_manager', 'with_desk', 'approved') and from_day <= p_to and te_va_until(te_vehicle_approvals) >= p_from limit 1;
  if clash.id is not null then
    raise exception '% for % – % is already %', te_va_label(p_mode), to_char(clash.from_day, 'FMDD Mon'), to_char(clash.to_day, 'FMDD Mon YYYY'),
      case clash.status when 'approved' then 'approved' else 'waiting for approval' end;
  end if;
  insert into te_vehicle_approvals (employee_id, number, mode, from_day, to_day, reason, letter_path, letter_name)
  values (me, 'VA-' || lpad(((select count(*) from te_vehicle_approvals where employee_id = me) + 1)::text, 2, '0'),
    p_mode, p_from, p_to, why, p_path, nullif(btrim(coalesce(p_name, '')), ''))
  returning * into v;
  perform te_dep_tell(e.reporting_manager_id, te_va_label(p_mode) || ' approval from ' || split_part(e.full_name, ' ', 1),
    te_dep_range(p_from, p_to) || ' · ' || why, '/travel/approvals?view=vehicle', me);
  return v.id;
end $$;

create or replace function public.te_va_withdraw(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v te_vehicle_approvals;
begin
  select * into v from te_vehicle_approvals where id = p_id;
  if v.id is null or v.employee_id <> current_employee_id() then raise exception 'That request is not yours'; end if;
  if v.status not in ('with_manager', 'with_desk') then raise exception 'Only a request still waiting can be withdrawn'; end if;
  update te_vehicle_approvals set status = 'withdrawn' where id = p_id;
end $$;

/* The manager's step, then the Travel Desk's: approve, or send back with a reason. */
create or replace function public.te_va_decide(p_id uuid, p_approve boolean, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); v te_vehicle_approvals; e employees; why text := nullif(btrim(coalesce(p_note, '')), ''); what text; d record;
begin
  select * into v from te_vehicle_approvals where id = p_id;
  if v.id is null then raise exception 'That request is not there any more'; end if;
  if v.employee_id = me then raise exception 'Your own request is approved by your manager and the Travel Desk'; end if;
  select * into e from employees where id = v.employee_id;
  what := te_va_label(v.mode) || ' · ' || te_dep_range(v.from_day, v.to_day);
  if v.status = 'with_manager' then
    if not (e.reporting_manager_id = me or te_is_admin()) then
      raise exception 'It waits on % to approve', coalesce((select full_name from employees where id = e.reporting_manager_id), 'the reporting manager');
    end if;
  elsif v.status = 'with_desk' then
    if not (te_is_desk() or te_is_admin()) then raise exception 'It waits on the Travel Desk'; end if;
  else
    raise exception 'It is not waiting for approval';
  end if;
  if not p_approve then
    if why is null or length(why) < 3 then raise exception 'Write why it is going back'; end if;
    update te_vehicle_approvals set status = 'returned', returned_by = me, returned_at = now(), note = why where id = p_id;
    perform te_dep_tell(v.employee_id, te_va_label(v.mode) || ' approval sent back', why, '/travel/profile?tab=vehicle', me);
    return 'returned';
  end if;
  if v.status = 'with_manager' then
    update te_vehicle_approvals set status = 'with_desk', manager_by = me, manager_at = now() where id = p_id;
    for d in select ur.employee_id from user_roles ur join employees x on x.id = ur.employee_id where ur.role = 'travel_desk' and x.is_active loop
      perform te_dep_tell(d.employee_id, te_va_label(v.mode) || ' approval from ' || split_part(e.full_name, ' ', 1), what || ' · manager approved', '/travel/approvals?view=vehicle', me);
    end loop;
    return 'with_desk';
  end if;
  update te_vehicle_approvals set status = 'approved', desk_by = me, desk_at = now() where id = p_id;
  perform te_dep_tell(v.employee_id, te_va_label(v.mode) || ' approved', what, '/travel/profile?tab=vehicle', me);
  return 'approved';
end $$;

/* The manager takes an approval away; the days before today stay approved. */
create or replace function public.te_va_remove(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); v te_vehicle_approvals; e employees; why text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v from te_vehicle_approvals where id = p_id;
  if v.id is null or v.status <> 'approved' then raise exception 'It is not approved now'; end if;
  select * into e from employees where id = v.employee_id;
  if not (e.reporting_manager_id = me or te_is_admin()) then raise exception 'Only the reporting manager removes it'; end if;
  if why is null or length(why) < 3 then raise exception 'Write why it is removed'; end if;
  update te_vehicle_approvals set status = 'removed', removed_by = me, removed_at = now(), note = why where id = p_id;
  perform te_dep_tell(v.employee_id, te_va_label(v.mode) || ' approval removed', why, '/travel/profile?tab=vehicle', me);
end $$;

create or replace function public.te_va_card(v te_vehicle_approvals)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(v) || jsonb_build_object(
    'name', e.full_name, 'ecode', e.ecode, 'label', te_va_label(v.mode), 'until', te_va_until(v),
    'manager_name', (select full_name from employees where id = v.manager_by),
    'desk_name', (select full_name from employees where id = v.desk_by),
    'returned_name', (select full_name from employees where id = v.returned_by),
    'removed_name', (select full_name from employees where id = v.removed_by))
  from employees e where e.id = v.employee_id
$$;

create or replace function public.te_my_vehicle_approvals()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(te_va_card(v) order by v.created_at desc) from te_vehicle_approvals v where v.employee_id = current_employee_id()), '[]'),
    'modes', to_jsonb(coalesce(te_va_modes(current_employee_id()), '{}')),
    'manager', (select x.full_name from employees e join employees x on x.id = e.reporting_manager_id where e.id = current_employee_id()))
$$;

/* What an approver sees: waiting on them first (the manager's step, or the Travel Desk's), then the rest they may see. */
create or replace function public.te_va_inbox()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.card || jsonb_build_object('waiting', x.waiting, 'can_remove', x.can_remove) order by x.waiting desc, x.created_at desc), '[]')
  from (
    select v.created_at, te_va_card(v) as card,
      ((v.status = 'with_manager' and e.reporting_manager_id = current_employee_id()) or (v.status = 'with_desk' and te_is_desk())) as waiting,
      (v.status = 'approved' and (e.reporting_manager_id = current_employee_id() or te_is_admin())) as can_remove
    from te_vehicle_approvals v join employees e on e.id = v.employee_id
    where v.employee_id <> current_employee_id() and v.status <> 'withdrawn'
      and (te_is_admin() or te_is_desk() or e.reporting_manager_id = current_employee_id() or is_in_my_downline(v.employee_id))
    order by v.created_at desc limit 300
  ) x
$$;

/* The approved vehicles over a claim's days, for its rides' out-of-policy mark. */
create or replace function public.te_claim_vehicles(p_claim uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('mode', v.mode, 'from_day', v.from_day, 'to_day', te_va_until(v), 'number', v.number)), '[]')
  from te_claims c join te_vehicle_approvals v on v.employee_id = c.employee_id
  where c.id = p_claim and te_can_see(p_claim) and v.status in ('approved', 'removed') and te_va_until(v) >= v.from_day
$$;

do $$
declare f text;
begin
  foreach f in array array['te_va_modes(uuid)', 'te_va_request(text, date, date, text, text, text)', 'te_va_withdraw(uuid)', 'te_va_decide(uuid, boolean, text)',
    'te_va_remove(uuid, text)', 'te_va_card(te_vehicle_approvals)', 'te_my_vehicle_approvals()', 'te_va_inbox()', 'te_claim_vehicles(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- A letter on a request stays: the person removes only one nothing stands on.
drop policy if exists te_letters_delete on storage.objects;
create policy te_letters_delete on storage.objects for delete to authenticated
  using (bucket_id = 'te-letters' and (storage.foldername(name))[1] = public.current_employee_id()::text
         and not exists (select 1 from public.te_deputations d where d.letter_path = name)
         and not exists (select 1 from public.te_vehicle_approvals v where v.letter_path = name));
