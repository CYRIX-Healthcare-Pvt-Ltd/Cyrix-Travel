-- Travel Expense · te_0024 · a recalled claim is deleted by its person, without the manager
-- The user, 17 Oct: "recall and deleting recalled claim don't need manager's approval, because he
-- didn't approve". Deleting freely: a draft and a recalled claim. Asking the manager: a claim sent
-- back to its person or anywhere further on. SW Admin and ACC_ADMIN: anything not paid.
create or replace function public.te_delete_claim(p_claim uuid)
returns text[] language plpgsql security definer set search_path to 'public' as $f$
declare c te_claims; paths text[]; me uuid := current_employee_id(); mgr uuid;
begin
  select * into c from te_claims where id = p_claim;
  if c.id is null then raise exception 'That claim is not there'; end if;
  select reporting_manager_id into mgr from employees where id = c.employee_id;
  if not (
       (c.employee_id = me and c.status in ('draft', 'recalled'))
    or (c.delete_requested_at is not null and mgr = me and c.status <> 'paid')
    or (te_is_admin() and c.status <> 'paid')) then
    raise exception 'This claim is deleted only when the manager approves the request';
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
  if c.status in ('draft', 'recalled') then raise exception 'You can delete this one yourself'; end if;
  if c.status = 'paid' then raise exception 'A paid claim cannot be deleted'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it should be deleted'; end if;
  update te_claims set delete_requested_at = now(), delete_reason = trim(p_reason), updated_at = now() where id = p_claim;
end $f$;
