-- Travel Expense · te_0046 · "already added?" before a bill is attached
-- The user, 21 Oct: a ride to the hotel with its bill, then the ride from the hotel — "if I attach the same
-- bill there also, show an alert, already added". The same file was refused already; a photograph of the
-- same bill, or another copy of the same ticket, was only flagged for the approvers afterwards. Now the
-- person is asked first: the bill it looks like is named, and they choose to attach it anyway or not.

create or replace function public.te_bill_twin(p_claim uuid, p_phash2 text, p_billno text, p_amount numeric, p_refs text[])
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select te_bill_label(b)
  from te_bills b join te_claims k on k.id = b.claim_id
  where k.employee_id = (select employee_id from te_claims where id = p_claim)
    and te_can_edit(p_claim) and b.owner_kind <> 'report'
    and (
      -- the same booking: MakeMyTrip's N… ids, not a PNR a group shares
      exists (select 1 from unnest(coalesce(p_refs, '{}')) x where x ~ '^N[A-Z][A-Z0-9]{12,20}$' and x = any(b.refs))
      or (nullif(btrim(p_billno), '') is not null and b.ocr_billno = upper(btrim(p_billno)) and b.ocr_amount is not distinct from p_amount)
      or (nullif(p_phash2, '') is not null and b.phash2 is not null
          and bit_count(('x' || b.phash2)::bit(256) # ('x' || p_phash2)::bit(256)) <= 12))
  order by b.created_at desc
  limit 1
$function$;
revoke all on function public.te_bill_twin(uuid, text, text, numeric, text[]) from public, anon;
grant execute on function public.te_bill_twin(uuid, text, text, numeric, text[]) to authenticated;
