-- Travel Expense · te_0013 · a bill checked before its file is sent
-- The phone asks first whether this exact file was claimed already, so a duplicate is refused
-- without uploading it. te_add_bill still refuses it on its own (te_0012).
create or replace function public.te_bill_used(p_sha256 text)
returns text language sql stable security definer set search_path to 'public' as $f$
  select coalesce(k.number, 'an unsent claim') || ' · ' || to_char(b.created_at at time zone 'Asia/Kolkata', 'DD Mon') || ' · ' || e.full_name
  from te_bills b join te_claims k on k.id = b.claim_id join employees e on e.id = k.employee_id
  where b.sha256 = p_sha256 and travel_has_access()
  limit 1
$f$;
revoke execute on function public.te_bill_used(text) from public, anon;
grant execute on function public.te_bill_used(text) to authenticated;
