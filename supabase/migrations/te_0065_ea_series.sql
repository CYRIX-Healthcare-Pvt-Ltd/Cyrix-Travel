/*
  te_0065 — expense advances are numbered EA-01, EA-02 … as claims are TE-01 (the user, 24 Oct: "like TE ticket
  series it should be EA (expense advance) series"). Any AD- number already given takes the EA- prefix, and the
  series goes on from the highest.
*/
create or replace function public.te_advance_number(n integer) returns text language sql immutable as $$
  select 'EA-' || case when n < 10 then '0' || n::text else n::text end
$$;

update public.te_advances set number = 'EA-' || substr(number, 4) where number like 'AD-%';

select setval('public.te_advance_seq',
  greatest(1, (select coalesce(max(substr(number, 4)::int), 0) from public.te_advances)),
  exists (select 1 from public.te_advances));
