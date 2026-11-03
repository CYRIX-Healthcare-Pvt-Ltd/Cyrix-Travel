/*
  te_0102 — a saved home before any claim (the user, 3 Nov, the demo's first day: "we need to set home mandatory isnt?
  then only we can start claim isnt? so make home mandatory from 2mrw, today night they will set it"). From the day in
  te_policy 'home_required_from' (4 Nov 2026), a person with no home in My profile cannot open a claim or save a day
  of one; Watch had found a 93.9 km ride "from My home" with no home saved. Only the claim's own person is held to it:
  a manager or the desk adjusting a day is not.
*/
insert into public.te_policy (key, value) values ('home_required_from', to_jsonb('2026-11-04'::text))
on conflict (key) do nothing;

create or replace function public.te_home_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  since date := nullif(te_pol('home_required_from') #>> '{}', '')::date;
begin
  if since is null or (now() at time zone 'Asia/Kolkata')::date < since then return new; end if;
  owner := case tg_table_name when 'te_claims' then (to_jsonb(new) ->> 'employee_id')::uuid
    else (select c.employee_id from te_claims c where c.id = (to_jsonb(new) ->> 'claim_id')::uuid) end;
  if owner is distinct from current_employee_id() then return new; end if;
  if not exists (select 1 from travel_homes h where h.employee_id = owner) then
    raise exception 'Set your home in My profile first — every claim starts from it';
  end if;
  return new;
end $$;

drop trigger if exists te_home_check on public.te_claims;
create trigger te_home_check before insert on public.te_claims for each row execute function public.te_home_check();
drop trigger if exists te_home_check on public.te_days;
create trigger te_home_check before insert or update on public.te_days for each row execute function public.te_home_check();
revoke all on function public.te_home_check() from public, anon, authenticated;

-- Whether this person must set a home before going on: the app shows a screen that stays until it is set (the user,
-- 3 Nov: "from 2mrw, when travel module is opening, show pop up for those who havnt set home location").
create or replace function public.te_home_needed()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(nullif(te_pol('home_required_from') #>> '{}', '')::date <= (now() at time zone 'Asia/Kolkata')::date, false)
    and not exists (select 1 from travel_homes h where h.employee_id = current_employee_id())
$$;
revoke all on function public.te_home_needed() from public, anon;
grant execute on function public.te_home_needed() to authenticated;
