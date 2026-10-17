-- Travel Expense · te_0021 · recall to edit
-- The user, 17 Oct: "if I submitted it, after that I need to change the uploaded document or
-- rewrite km correctly, how?". While a claim waits on the manager and nobody has approved it, its
-- person can take it back: it keeps its number, opens for editing like a draft, and is submitted
-- again. How many times it was recalled is kept, for the manager to see.
alter table public.te_claims drop constraint if exists te_claims_status_check;
alter table public.te_claims add constraint te_claims_status_check
  check (status in ('draft', 'with_manager', 'with_coordinator', 'with_desk', 'approved', 'paid', 'returned', 'recalled'));
alter table public.te_claims add column if not exists recalls int not null default 0;
alter table public.te_claims add column if not exists last_recalled_at timestamptz;

create or replace function public.te_can_edit(p_claim uuid)
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select exists (select 1 from te_claims c where c.id = p_claim and c.employee_id = current_employee_id() and c.status in ('draft', 'returned', 'recalled'))
$f$;

create or replace function public.te_recall(p_claim uuid)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare c te_claims;
begin
  select * into c from te_claims where id = p_claim for update;
  if c.employee_id is distinct from current_employee_id() then raise exception 'Only your own claim'; end if;
  if c.status <> 'with_manager' then raise exception 'It can be recalled only while it waits on your manager'; end if;
  update te_claims set status = 'recalled', recalls = recalls + 1, last_recalled_at = now(), updated_at = now() where id = p_claim;
end $f$;
revoke execute on function public.te_recall(uuid) from public, anon;
grant execute on function public.te_recall(uuid) to authenticated;
