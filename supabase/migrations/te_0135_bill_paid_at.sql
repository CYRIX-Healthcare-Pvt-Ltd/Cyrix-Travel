/*
  te_0135 — When a payment screen says it was paid (Google Pay's "4 Nov 2026, 10:17am"), read off the bill and kept, so
  the claim page can set it against the ride's own photo times (the user, 7 Nov: the ₹375 GPay payment at 10:17 AM for
  a ride that began about 5:15 PM; "build it"). Set once by the reader; never by hand, never over another reading.
*/
alter table public.te_bills add column if not exists paid_at timestamptz;

create or replace function public.te_bill_paid(p_bill uuid, p_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare b te_bills;
begin
  select * into b from te_bills where id = p_bill;
  if b.id is null or not te_can_edit(b.claim_id) then raise exception 'This claim cannot be changed now'; end if;
  if b.paid_at is not null or p_at is null or p_at > now() + interval '1 day' then return; end if;
  update te_bills set paid_at = p_at where id = p_bill;
end $$;
revoke all on function public.te_bill_paid(uuid, timestamptz) from public, anon;
grant execute on function public.te_bill_paid(uuid, timestamptz) to authenticated;

-- te_claim's bills carry it.
do $$
declare f text;
  was text := $q$'typed_amount', b.typed_amount,$q$;
begin
  f := pg_get_functiondef('public.te_claim(uuid)'::regprocedure);
  if position('paid_at' in f) > 0 then return; end if;
  if position(was in f) = 0 then raise exception 'te_claim changed'; end if;
  execute replace(f, was, was || $q$ 'paid_at', b.paid_at,$q$);
end $$;
