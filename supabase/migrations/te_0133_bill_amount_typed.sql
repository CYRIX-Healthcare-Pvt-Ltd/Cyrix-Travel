/*
  te_0133 — The amount on a bill the reader could not read, typed in by the person (the user, 6 Nov, check 8: when the
  reader can't read a bill, the person types the amount from it). Kept apart from what was read, so the approvers see it
  was typed and open the bill; a bill whose amount was read is never typed over, and a service report has none.
  (Applied after te_0134; the two touch different parts of te_claim.)
*/
alter table public.te_bills add column if not exists typed_amount numeric;

create or replace function public.te_bill_typed(p_bill uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare b te_bills;
begin
  select * into b from te_bills where id = p_bill;
  if b.id is null or not te_can_edit(b.claim_id) then raise exception 'This claim cannot be changed now'; end if;
  if b.owner_kind = 'report' then raise exception 'A service report has no amount'; end if;
  if b.ocr_amount is not null then raise exception 'The amount was read from this bill'; end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 200000 then raise exception 'Type the amount on the bill'; end if;
  update te_bills set typed_amount = round(p_amount, 2) where id = p_bill;
end $$;
revoke all on function public.te_bill_typed(uuid, numeric) from public, anon;
grant execute on function public.te_bill_typed(uuid, numeric) to authenticated;

-- te_claim's bills carry it.
do $$
declare f text;
  was text := $q$'ocr_amount', b.ocr_amount, 'ocr_date', b.ocr_date, 'ocr_billno', b.ocr_billno,$q$;
begin
  f := pg_get_functiondef('public.te_claim(uuid)'::regprocedure);
  if position('typed_amount' in f) > 0 then return; end if;
  if position(was in f) = 0 then raise exception 'te_claim changed'; end if;
  execute replace(f, was, was || $q$ 'typed_amount', b.typed_amount,$q$);
end $$;
