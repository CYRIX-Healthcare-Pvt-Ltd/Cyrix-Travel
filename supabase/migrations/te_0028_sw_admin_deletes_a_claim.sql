-- Travel Expense · te_0028 · SW Admin deletes a claim, like a Revive Lab ticket
-- The user, 18 Oct: "for sw_admin like in revive lab also need option to delete claim" — "only for
-- swadmin". SW Admin, and nobody else among the admins, deletes any claim outright, paid or not: from
-- the claim, or by its number in the policy page's Delete tab. One audit line keeps what it was. When
-- no numbered claim is left, numbering starts again at TE-01 (rl_0006 does the same for RL-).
-- ACC_ADMIN no longer deletes claims.
--
-- Also: TE-100 would have come out "TE-10" — lpad cuts a longer string — and clashed with the real
-- TE-10. te_number writes two digits at least and all of them past 99.

create or replace function public.te_number(n int)
returns text language sql immutable as $f$
  select 'TE-' || case when n < 10 then '0' || n::text else n::text end
$f$;

create or replace function public.te_submit(p_claim uuid)
returns text language plpgsql security definer set search_path to 'public' as $f$
declare c te_claims; due date; late int := 0; steps jsonb := te_pol('late_pct'); over numeric := (te_pol('bill_over'))::text::numeric; missing text;
begin
  select * into c from te_claims where id = p_claim;
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be sent now'; end if;
  if not exists (select 1 from te_days where claim_id = p_claim) then raise exception 'Add at least one day first'; end if;
  -- Bills the policy asks for.
  select string_agg(distinct to_char(d.day, 'DD Mon'), ', ') into missing from te_days d where d.claim_id = p_claim and (
    exists (select 1 from te_rides r where r.day_id = d.id and (r.mode in ('bus', 'train', 'flight') or r.amount > over)
            and not exists (select 1 from te_bills b where b.owner_id = r.id))
    or exists (select 1 from te_hotels h where h.day_id = d.id and not exists (select 1 from te_bills b where b.owner_id = h.id))
    or exists (select 1 from te_expenses x where x.day_id = d.id and (x.amount > over or x.category in ('Courier', 'Toll', 'Client meal', 'Team meal'))
            and not exists (select 1 from te_bills b where b.owner_id = x.id)));
  if missing is not null then raise exception 'Attach the bills still needed on %', missing; end if;
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
end $f$;

/** Who may delete this claim now: its person while unsent or recalled, the manager approving a request, SW Admin always. */
create or replace function public.te_can_delete(p_claim uuid)
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select exists (select 1 from te_claims c join employees e on e.id = c.employee_id where c.id = p_claim and (
       (c.employee_id = current_employee_id() and c.status in ('draft', 'recalled'))
    or (c.delete_requested_at is not null and e.reporting_manager_id = current_employee_id() and c.status <> 'paid')
    or is_sw_admin()))
$f$;

create or replace function public.te_delete_claim(p_claim uuid)
returns text[] language plpgsql security definer set search_path to 'public' as $f$
declare c te_claims; paths text[];
begin
  select * into c from te_claims where id = p_claim;
  if c.id is null then raise exception 'That claim is not there'; end if;
  if not te_can_delete(p_claim) then raise exception 'This claim is deleted only when the manager approves the request'; end if;
  -- A deleted claim is still one somebody can account for.
  perform log_audit('te_claim', c.id, 'deleted', jsonb_build_object(
    'number', c.number, 'month', c.month, 'status', c.status, 'total', te_total(c.id),
    'ecode', (select ecode from employees where id = c.employee_id),
    'days', (select count(*) from te_days where claim_id = c.id)));
  select coalesce(array_agg(path), '{}') into paths from te_bills where claim_id = p_claim;
  delete from te_claims where id = p_claim;
  if not exists (select 1 from te_claims where number is not null) then perform setval('public.te_claim_seq', 1, false); end if;
  return paths;
end $f$;

/** SW Admin finds a claim by its number (TE-02, te-2, 2) to delete it; with its bills, which go first. */
create or replace function public.te_find_claim(p_number text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
declare n int := nullif(regexp_replace(coalesce(p_number, ''), '\D', '', 'g'), '')::int; c te_claims;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin deletes claims'; end if;
  if n is null then raise exception 'Type a claim number, like TE-02'; end if;
  select * into c from te_claims where number = te_number(n);
  if c.id is null then raise exception 'There is no claim %', te_number(n); end if;
  return (select jsonb_build_object('id', c.id, 'number', c.number, 'month', c.month, 'status', c.status, 'total', te_total(c.id),
      'name', e.full_name, 'ecode', e.ecode, 'days', (select count(*) from te_days where claim_id = c.id),
      'paths', (select coalesce(jsonb_agg(path), '[]') from te_bills where claim_id = c.id))
    from employees e where e.id = c.employee_id);
end $f$;

create or replace function public.te_admin_data()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  return jsonb_build_object(
    'rules', (select jsonb_agg(to_jsonb(r) order by r.grade = '*' desc, r.grade) from te_grade_rules r),
    'policy', (select jsonb_object_agg(key, value) from te_policy),
    'purposes', (select jsonb_agg(to_jsonb(p) order by p.sort, p.label) from te_purposes p),
    'projects', (select coalesce(jsonb_agg(to_jsonb(p) order by p.sort, p.label), '[]') from te_projects p),
    'coordinators', (select coalesce(jsonb_agg(jsonb_build_object('ecode', e.ecode, 'name', e.full_name, 'coordinator_ecode', k.ecode, 'coordinator', k.full_name) order by e.full_name), '[]')
                     from te_coordinators c join employees e on e.id = c.employee_id join employees k on k.id = c.coordinator_id),
    'desk', (select coalesce(jsonb_agg(jsonb_build_object('ecode', e.ecode, 'name', e.full_name) order by e.full_name), '[]')
             from user_roles u join employees e on e.id = u.employee_id where u.role = 'travel_desk'),
    'sw', is_sw_admin());
end $f$;

-- The bills go before the claim, by whoever may delete it (after, nothing is left to check against).
drop policy if exists te_bills_del on storage.objects;
create policy te_bills_del on storage.objects for delete to authenticated
  using (bucket_id = 'te-bills' and (public.te_can_edit(((storage.foldername(name))[1])::uuid)
                                     or public.te_can_delete(((storage.foldername(name))[1])::uuid)));

revoke execute on function public.te_number(int), public.te_can_delete(uuid), public.te_find_claim(text) from public, anon;
grant execute on function public.te_number(int), public.te_can_delete(uuid), public.te_find_claim(text) to authenticated;
