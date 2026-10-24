/*
  te_0066 — SW Admin deletes an expense advance as a claim is deleted (te_0028; the user, 24 Oct: "for deletion also
  need ea tickets"): type its number (EA-01, ea-1), see whose it is, what it is and what claims took of it, confirm.
  Its uses go with it, so those claims no longer have it taken off; one audit line keeps what it was.
*/

/** SW Admin finds an advance by its number to delete it. */
create or replace function public.te_find_advance(p_number text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare n int := nullif(regexp_replace(coalesce(p_number, ''), '\D', '', 'g'), '')::int; v te_advances;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin deletes advances'; end if;
  if n is null then raise exception 'Type an advance number, like EA-01'; end if;
  select * into v from te_advances where number = te_advance_number(n);
  if v.id is null then raise exception 'There is no advance %', te_advance_number(n); end if;
  return (select jsonb_build_object('id', v.id, 'number', v.number, 'amount', v.amount, 'status', v.status, 'month', v.month,
      'dest', v.dest_name, 'name', e.full_name, 'ecode', e.ecode,
      'used', coalesce((select sum(u.used) from te_advance_used(v.employee_id) u where u.advance_id = v.id), 0),
      'claims', coalesce((select jsonb_agg(distinct coalesce(k.number, to_char(k.month, 'Mon-YY')))
                          from te_advance_split(v.employee_id) s join te_claims k on k.id = s.claim_id
                          where s.advance_id = v.id and s.sent), '[]'))
    from employees e where e.id = v.employee_id);
end $$;

create or replace function public.te_delete_advance(p_advance uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v te_advances;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin deletes advances'; end if;
  select * into v from te_advances where id = p_advance;
  if v.id is null then raise exception 'That advance is not there'; end if;
  perform log_audit('te_advance', v.id, 'deleted', jsonb_build_object(
    'number', v.number, 'amount', v.amount, 'status', v.status, 'month', v.month,
    'ecode', (select ecode from employees where id = v.employee_id),
    'used', coalesce((select sum(u.used) from te_advance_used(v.employee_id) u where u.advance_id = v.id), 0)));
  delete from te_advances where id = p_advance;
  if not exists (select 1 from te_advances) then perform setval('public.te_advance_seq', 1, false); end if;
end $$;

revoke execute on function public.te_find_advance(text), public.te_delete_advance(uuid) from public, anon;
grant execute on function public.te_find_advance(text), public.te_delete_advance(uuid) to authenticated;
