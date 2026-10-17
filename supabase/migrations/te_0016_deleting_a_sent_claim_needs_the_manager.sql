-- Travel Expense · te_0016 · deleting a sent claim needs the manager
-- The user, 17 Oct: "if not gone to next level it can be deleted easily, if gone needed approval
-- for manager". A draft is deleted by its person at once. Once sent (sent back included) the
-- person asks, with a reason, and the reporting manager approves the deletion or keeps the claim.
-- SW Admin and ACC_ADMIN can still delete anything not yet paid.
alter table public.te_claims add column if not exists delete_requested_at timestamptz;
alter table public.te_claims add column if not exists delete_reason text;

create or replace function public.te_delete_claim(p_claim uuid)
returns text[] language plpgsql security definer set search_path to 'public' as $f$
declare c te_claims; paths text[]; me uuid := current_employee_id(); mgr uuid;
begin
  select * into c from te_claims where id = p_claim;
  if c.id is null then raise exception 'That claim is not there'; end if;
  select reporting_manager_id into mgr from employees where id = c.employee_id;
  if not (
       (c.employee_id = me and c.status = 'draft')
    or (c.delete_requested_at is not null and mgr = me and c.status <> 'paid')
    or (te_is_admin() and c.status <> 'paid')) then
    raise exception 'A claim already sent is deleted only when the manager approves the request';
  end if;
  select coalesce(array_agg(path), '{}') into paths from te_bills where claim_id = p_claim;
  delete from te_claims where id = p_claim;
  return paths;
end $f$;

create or replace function public.te_request_delete(p_claim uuid, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare c te_claims;
begin
  select * into c from te_claims where id = p_claim;
  if c.employee_id is distinct from current_employee_id() then raise exception 'Only your own claim'; end if;
  if c.status in ('draft', 'paid') then raise exception 'A draft is deleted straight away; a paid claim cannot be deleted'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it should be deleted'; end if;
  update te_claims set delete_requested_at = now(), delete_reason = trim(p_reason), updated_at = now() where id = p_claim;
end $f$;

/** The manager keeps the claim: the request is withdrawn and it carries on where it was. */
create or replace function public.te_keep_claim(p_claim uuid)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare c te_claims; mgr uuid;
begin
  select * into c from te_claims where id = p_claim;
  select reporting_manager_id into mgr from employees where id = c.employee_id;
  if not (mgr = current_employee_id() or te_is_admin() or c.employee_id = current_employee_id()) then raise exception 'Only the reporting manager'; end if;
  update te_claims set delete_requested_at = null, delete_reason = null, updated_at = now() where id = p_claim;
end $f$;

-- The inbox counts a deletion request as waiting on the manager.
create or replace function public.te_inbox()
returns table (id uuid, month date, status text, number text, total numeric, name text, ecode text, submitted_at timestamptz, waiting boolean)
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
  select id, month, status, number, te_total(id), full_name, ecode, submitted_at, waiting
  from mine order by waiting desc, submitted_at desc nulls last limit 200
$f$;

revoke execute on function public.te_request_delete(uuid, text), public.te_keep_claim(uuid) from public, anon;
grant execute on function public.te_request_delete(uuid, text), public.te_keep_claim(uuid) to authenticated;
