-- Travel Expense · te_0015 · a claim can be deleted (the user, 17 Oct: "need delete option also")
-- By its person while it is a draft or sent back; by SW Admin or ACC_ADMIN at any time before it
-- is paid. Its bills' files are returned so the app removes them from storage.
create or replace function public.te_delete_claim(p_claim uuid)
returns text[] language plpgsql security definer set search_path to 'public' as $f$
declare c te_claims; paths text[];
begin
  select * into c from te_claims where id = p_claim;
  if c.id is null then raise exception 'That claim is not there'; end if;
  if not (te_can_edit(p_claim) or (te_is_admin() and c.status <> 'paid')) then
    raise exception 'Only a draft or a claim sent back can be deleted';
  end if;
  select coalesce(array_agg(path), '{}') into paths from te_bills where claim_id = p_claim;
  delete from te_claims where id = p_claim;
  return paths;
end $f$;
revoke execute on function public.te_delete_claim(uuid) from public, anon;
grant execute on function public.te_delete_claim(uuid) to authenticated;
