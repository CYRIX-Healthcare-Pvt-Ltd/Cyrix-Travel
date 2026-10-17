-- Travel Expense · te_0012 · the claim, by the day, as the 2026 travel policy has it
--
-- The user, 17 Oct 2026: the trip-tracking module is not what the team needs. Digitise the
-- expense reimbursement Excel and the "New Travel Policy - Expense Reimbursement - 2026".
-- A month's claim is made of day cards: each day has its rides (from -> to, mode, km or fare),
-- the tickets attended, one daily allowance, a hotel night and other expenses, each with its
-- bills. It goes engineer -> reporting manager -> coordinator (when one is set) -> Travel Desk.
-- SW Admin and ACC_ADMIN set the allowances, the coordinators and the Travel Desk.
-- The old travel_* tables are kept as they are; nothing reads them any more.

-- ---------------------------------------------------------------- who is who
create or replace function public.is_acc_admin()
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select exists (select 1 from user_roles where employee_id = current_employee_id() and role = 'acc_admin')
$f$;
create or replace function public.te_is_admin()
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select is_sw_admin() or is_acc_admin()
$f$;
create or replace function public.te_is_desk()
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select exists (select 1 from user_roles where employee_id = current_employee_id() and role = 'travel_desk')
$f$;
revoke execute on function public.is_acc_admin(), public.te_is_admin(), public.te_is_desk() from public, anon;
grant execute on function public.is_acc_admin(), public.te_is_admin(), public.te_is_desk() to authenticated;

-- Two new roles: the accounts administrator and the Travel Desk.
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role = any (array['hr_admin', 'super_admin', 'sw_admin', 'it_admin', 'mkt_admin', 'acc_admin', 'travel_desk']));

-- The accounts administrator's record, with no login: SW Admin creates it, as for IT_ADMIN (0151).
insert into public.employees (ecode, full_name, designation, department, is_active, must_change_password, account_type)
values ('ACC_ADMIN', 'Accounts', 'Accounts Administrator', 'Accounts', true, true, 'admin')
on conflict (ecode) do nothing;
insert into public.user_roles (employee_id, role) select id, 'acc_admin' from public.employees where ecode = 'ACC_ADMIN' on conflict do nothing;
insert into public.employee_modules (employee_id, module_code) select id, 'travel' from public.employees where ecode = 'ACC_ADMIN' on conflict do nothing;

-- ---------------------------------------------------------------- the policy, editable
create table if not exists public.te_grade_rules (
  grade text primary key,
  da_in_district numeric not null, da_out_district numeric not null,
  da_out_state numeric not null, da_out_state_stay numeric not null,
  hotel_in_single numeric not null, hotel_in_double numeric not null,
  hotel_out_single numeric not null, hotel_out_double numeric not null,
  bike_rate numeric, bike_km_month int, car_rate numeric, car_km_month int,
  flight boolean not null default false, taxi boolean not null default false,
  updated_at timestamptz not null default now(), updated_by uuid
);
-- '*' is anybody whose grade is not listed. The policy's own grades, and the ones it does not
-- name (T4, TM1, TM3, NM2) as JM / Trainee, O1 and O2 as Senior Specialist (the user, 17 Oct:
-- "that we can check later").
insert into public.te_grade_rules (grade, da_in_district, da_out_district, da_out_state, da_out_state_stay,
  hotel_in_single, hotel_in_double, hotel_out_single, hotel_out_double, bike_rate, bike_km_month, car_rate, car_km_month, flight, taxi)
select g, d1, d2, d3, d4, h1, h2, h3, h4, br, bk, cr, ck, fl, tx from (values
  ('*',   150, 200, 300,  400, 1000, 1300, 1500, 2000, 5, 2000, null, null, false, false),
  ('JM1', 150, 200, 300,  400, 1000, 1300, 1500, 2000, 5, 2000, null, null, false, false),
  ('JM2', 150, 200, 300,  400, 1000, 1300, 1500, 2000, 5, 2000, null, null, false, false),
  ('JM3', 150, 200, 300,  400, 1500, 2000, 2000, 2500, 5, 2000, null, null, false, false),
  ('O1',  150, 200, 300,  400, 1500, 2000, 2000, 2500, 5, 2000, null, null, false, false),
  ('O2',  150, 200, 300,  400, 1500, 2000, 2000, 2500, 5, 2000, null, null, false, false),
  ('T4',  150, 200, 300,  400, 1000, 1300, 1500, 2000, 5, 2000, null, null, false, false),
  ('TM1', 150, 200, 300,  400, 1000, 1300, 1500, 2000, 5, 2000, null, null, false, false),
  ('TM3', 150, 200, 300,  400, 1000, 1300, 1500, 2000, 5, 2000, null, null, false, false),
  ('NM2', 150, 200, 300,  400, 1000, 1300, 1500, 2000, 5, 2000, null, null, false, false),
  ('MM1', 200, 250, 350, 1000, 1500, 2000, 2000, 2500, 5, 2000, null, null, false, false),
  ('MM2', 200, 250, 350, 1000, 1500, 2000, 2000, 2500, 5, 2000, null, null, false, false),
  ('MM3', 200, 250, 350, 1000, 2000, 2500, 2500, 3000, null, null, 11, 3000, true, true),
  ('MM4', 200, 250, 350, 1000, 2000, 2500, 2500, 3000, null, null, 11, 3000, true, true),
  ('MM5', 200, 250, 350, 1000, 2000, 2500, 2500, 3000, null, null, 11, 3000, true, true),
  ('SM1', 250, 300, 400, 1000, 2500, 3000, 3500, 4000, null, null, 11, 3000, true, true),
  ('SM2', 250, 300, 400, 1000, 2500, 3000, 3500, 4000, null, null, 11, 3000, true, true),
  ('SM3', 250, 300, 400, 1000, 2500, 3000, 3500, 4000, null, null, 11, 3000, true, true),
  ('SM4', 250, 300, 400, 1000, 2500, 3000, 3500, 4000, null, null, 11, 3000, true, true),
  ('SM5', 250, 300, 400, 1000, 2500, 3000, 3500, 4000, null, null, 11, 3000, true, true),
  ('SM6', 250, 300, 400, 1000, 2500, 3000, 3500, 4000, null, null, 11, 3000, true, true)
) v(g, d1, d2, d3, d4, h1, h2, h3, h4, br, bk, cr, ck, fl, tx)
on conflict (grade) do nothing;

create table if not exists public.te_policy (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
insert into public.te_policy (key, value) values
  ('km_tolerance_pct', '10'),        -- claimed km over map km by more than this needs approval (the user, 17 Oct)
  ('bill_over', '300'),              -- a bill for anything over this
  ('auto_month', '1000'),            -- auto allowance a month
  ('phone_month', '300'),            -- mobile allowance a month, without a company CUG
  ('tool_max', '500'),               -- tools above this go through petty cash
  ('metro_extra_pct', '20'),         -- hotel limit in a metropolitan city
  ('bike_two_way_km', '170'), ('car_two_way_km', '250'),
  ('late_pct', '[10, 20, 30]'),      -- 1, 2, 3 months late; later is refused (the user, 17 Oct: "1 month delay 10%")
  ('submit_by_day', '5')
on conflict (key) do nothing;

create table if not exists public.te_purposes (
  id serial primary key, label text not null unique, gives_da boolean not null default true,
  is_active boolean not null default true, sort int not null default 0
);
insert into public.te_purposes (label, gives_da, sort) values
  ('Hospital visit', true, 1), ('Breakdown call', true, 2), ('Meeting', true, 3), ('Office', false, 9)
on conflict (label) do nothing;

create table if not exists public.te_coordinators (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  coordinator_id uuid not null references public.employees(id),
  set_by uuid, set_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- the claim
create sequence if not exists public.te_claim_seq;
create table if not exists public.te_claims (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  month date not null,
  status text not null default 'draft'
    check (status in ('draft', 'with_manager', 'with_coordinator', 'with_desk', 'approved', 'paid', 'returned')),
  number text unique,
  grade text, designation text, base_location text, project text, mobile text,
  submitted_at timestamptz, late_pct int not null default 0,
  advance numeric not null default 0,
  manager_id uuid, manager_at timestamptz, manager_note text,
  coordinator_id uuid, coordinator_at timestamptz, coordinator_note text,
  desk_id uuid, desk_at timestamptz, desk_note text, paid_at timestamptz,
  returned_by uuid, returned_at timestamptz, return_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (employee_id, month)
);
create table if not exists public.te_days (
  id uuid primary key,
  claim_id uuid not null references public.te_claims(id) on delete cascade,
  day date not null,
  place text, district text, purpose text,
  da_kind text not null default 'none' check (da_kind in ('none', 'in_district', 'out_district', 'out_state', 'out_state_stay')),
  da_amount numeric not null default 0,
  continues_day date,
  remarks text,
  unique (claim_id, day)
);
create table if not exists public.te_rides (
  id uuid primary key,
  day_id uuid not null references public.te_days(id) on delete cascade,
  seq int not null default 0,
  from_name text, from_lat double precision, from_lng double precision,
  to_name text, to_lat double precision, to_lng double precision,
  mode text not null check (mode in ('bike', 'car', 'bus', 'train', 'metro', 'auto', 'taxi', 'flight')),
  claimed_km numeric, map_km numeric, fare numeric,
  amount numeric not null default 0, note text
);
create table if not exists public.te_tickets (
  id uuid primary key,
  day_id uuid not null references public.te_days(id) on delete cascade,
  ticket_no text not null, service_report text, place text
);
create table if not exists public.te_hotels (
  id uuid primary key,
  day_id uuid not null unique references public.te_days(id) on delete cascade,
  name text, amount numeric not null default 0,
  occupancy text not null default 'single' check (occupancy in ('single', 'double')),
  metro boolean not null default false,
  shared_with uuid references public.employees(id)
);
create table if not exists public.te_expenses (
  id uuid primary key,
  day_id uuid not null references public.te_days(id) on delete cascade,
  category text not null, description text, amount numeric not null default 0
);
create table if not exists public.te_bills (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.te_claims(id) on delete cascade,
  owner_kind text not null check (owner_kind in ('ride', 'hotel', 'expense')),
  owner_id uuid not null,
  path text not null, name text,
  sha256 text not null,
  phash bigint,
  ocr_amount numeric, ocr_date date, ocr_billno text,
  uploaded_by uuid, created_at timestamptz not null default now()
);
-- The same file can never be claimed twice, by anybody (the user, 17 Oct).
create unique index if not exists te_bills_same_file on public.te_bills (sha256);
create index if not exists te_bills_owner on public.te_bills (owner_id);
create index if not exists te_days_claim on public.te_days (claim_id);
create index if not exists te_rides_day on public.te_rides (day_id);

-- Read and written only through the functions below.
alter table public.te_grade_rules enable row level security;
alter table public.te_policy enable row level security;
alter table public.te_purposes enable row level security;
alter table public.te_coordinators enable row level security;
alter table public.te_claims enable row level security;
alter table public.te_days enable row level security;
alter table public.te_rides enable row level security;
alter table public.te_tickets enable row level security;
alter table public.te_hotels enable row level security;
alter table public.te_expenses enable row level security;
alter table public.te_bills enable row level security;

-- ---------------------------------------------------------------- helpers
create or replace function public.te_pol(p_key text)
returns jsonb language sql stable security definer set search_path to 'public' as $f$
  select value from te_policy where key = p_key
$f$;

create or replace function public.te_rule(p_grade text)
returns te_grade_rules language sql stable security definer set search_path to 'public' as $f$
  select * from te_grade_rules where grade = coalesce((select grade from te_grade_rules where grade = upper(trim(p_grade))), '*')
$f$;

/** May see this claim: its own person, anybody they report up to, their coordinator, the Travel Desk, the admins. */
create or replace function public.te_can_see(p_claim uuid)
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select exists (
    select 1 from te_claims c where c.id = p_claim and (
      c.employee_id = current_employee_id() or te_is_admin() or te_is_desk()
      or is_in_my_downline(c.employee_id)
      or exists (select 1 from te_coordinators k where k.employee_id = c.employee_id and k.coordinator_id = current_employee_id())))
$f$;

/** The person may still change it: their own, unsent or sent back. */
create or replace function public.te_can_edit(p_claim uuid)
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select exists (select 1 from te_claims c where c.id = p_claim and c.employee_id = current_employee_id() and c.status in ('draft', 'returned'))
$f$;

/** The day's DA from the grade, and none for a purpose that gives none (an office day). */
create or replace function public.te_da(p_grade text, p_kind text, p_purpose text)
returns numeric language plpgsql stable security definer set search_path to 'public' as $f$
declare r te_grade_rules := te_rule(p_grade);
begin
  if exists (select 1 from te_purposes where label = p_purpose and not gives_da) then return 0; end if;
  return case p_kind when 'in_district' then r.da_in_district when 'out_district' then r.da_out_district
    when 'out_state' then r.da_out_state when 'out_state_stay' then r.da_out_state_stay else 0 end;
end $f$;

-- ---------------------------------------------------------------- the person's own
/** This month's claim (or the one asked for), made on first open with the header filled in. */
create or replace function public.te_open_month(p_month date)
returns uuid language plpgsql security definer set search_path to 'public' as $f$
declare me uuid := current_employee_id(); m date := date_trunc('month', p_month)::date; cid uuid; e employees; last te_claims;
begin
  if me is null or not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  select id into cid from te_claims where employee_id = me and month = m;
  if cid is not null then return cid; end if;
  select * into e from employees where id = me;
  select * into last from te_claims where employee_id = me order by month desc limit 1;
  insert into te_claims (employee_id, month, grade, designation, base_location, project, mobile)
  values (me, m, e.grade, e.designation, coalesce(last.base_location, e.location), last.project, coalesce(last.mobile, e.official_phone))
  returning id into cid;
  return cid;
end $f$;

create or replace function public.te_set_header(p_claim uuid, p_project text, p_base text, p_mobile text)
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be changed now'; end if;
  update te_claims set project = nullif(trim(p_project), ''), base_location = nullif(trim(p_base), ''),
    mobile = nullif(trim(p_mobile), ''), updated_at = now() where id = p_claim;
end $f$;

/*
  A whole day, saved at once: the rows the client sends are kept (ids are made on the phone, so a
  bill can point at its ride before the day is saved) and the ones it no longer sends are removed.
  Amounts are worked out here: a bike or car ride is km x the grade's rate, anything else its fare;
  the DA comes from the grade.
*/
create or replace function public.te_save_day(p_claim uuid, p_day jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $f$
declare
  c te_claims; r te_grade_rules; did uuid := (p_day->>'id')::uuid; x jsonb; amt numeric; n int := 0;
  other text;
begin
  select * into c from te_claims where id = p_claim;
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be changed now'; end if;
  if (p_day->>'day')::date < c.month or (p_day->>'day')::date >= (c.month + interval '1 month') then
    raise exception 'That date is not in this month''s claim';
  end if;
  r := te_rule(c.grade);
  insert into te_days (id, claim_id, day, place, district, purpose, da_kind, da_amount, continues_day, remarks)
  values (did, p_claim, (p_day->>'day')::date, p_day->>'place', p_day->>'district', p_day->>'purpose',
    coalesce(p_day->>'da_kind', 'none'), te_da(c.grade, coalesce(p_day->>'da_kind', 'none'), p_day->>'purpose'),
    nullif(p_day->>'continues_day', '')::date, p_day->>'remarks')
  on conflict (id) do update set day = excluded.day, place = excluded.place, district = excluded.district,
    purpose = excluded.purpose, da_kind = excluded.da_kind, da_amount = excluded.da_amount,
    continues_day = excluded.continues_day, remarks = excluded.remarks;

  delete from te_rides where day_id = did and id not in (select (v->>'id')::uuid from jsonb_array_elements(coalesce(p_day->'rides', '[]')) v);
  for x in select * from jsonb_array_elements(coalesce(p_day->'rides', '[]')) loop
    n := n + 1;
    amt := case x->>'mode'
      when 'bike' then coalesce((x->>'claimed_km')::numeric, 0) * coalesce(r.bike_rate, 5)
      when 'car'  then coalesce((x->>'claimed_km')::numeric, 0) * coalesce(r.car_rate, 11)
      else coalesce((x->>'fare')::numeric, 0) end;
    insert into te_rides (id, day_id, seq, from_name, from_lat, from_lng, to_name, to_lat, to_lng, mode, claimed_km, map_km, fare, amount, note)
    values ((x->>'id')::uuid, did, n, x->>'from_name', (x->>'from_lat')::float8, (x->>'from_lng')::float8,
      x->>'to_name', (x->>'to_lat')::float8, (x->>'to_lng')::float8, x->>'mode',
      nullif(x->>'claimed_km', '')::numeric, nullif(x->>'map_km', '')::numeric, nullif(x->>'fare', '')::numeric, round(amt, 2), x->>'note')
    on conflict (id) do update set seq = excluded.seq, from_name = excluded.from_name, from_lat = excluded.from_lat,
      from_lng = excluded.from_lng, to_name = excluded.to_name, to_lat = excluded.to_lat, to_lng = excluded.to_lng,
      mode = excluded.mode, claimed_km = excluded.claimed_km, map_km = excluded.map_km, fare = excluded.fare,
      amount = excluded.amount, note = excluded.note;
  end loop;

  delete from te_tickets where day_id = did and id not in (select (v->>'id')::uuid from jsonb_array_elements(coalesce(p_day->'tickets', '[]')) v);
  insert into te_tickets (id, day_id, ticket_no, service_report, place)
  select (v->>'id')::uuid, did, trim(v->>'ticket_no'), nullif(trim(v->>'service_report'), ''), nullif(trim(v->>'place'), '')
  from jsonb_array_elements(coalesce(p_day->'tickets', '[]')) v where coalesce(trim(v->>'ticket_no'), '') <> ''
  on conflict (id) do update set ticket_no = excluded.ticket_no, service_report = excluded.service_report, place = excluded.place;

  -- One hotel night. A room a colleague already claimed with this person cannot be claimed again (policy: no split claims).
  if p_day->'hotel' is not null and jsonb_typeof(p_day->'hotel') = 'object' and coalesce((p_day->'hotel'->>'amount')::numeric, 0) > 0 then
    select e.full_name || ' (' || e.ecode || ')' into other
    from te_hotels h join te_days d on d.id = h.day_id join te_claims k on k.id = d.claim_id join employees e on e.id = k.employee_id
    where h.shared_with = c.employee_id and d.day = (p_day->>'day')::date and k.id <> p_claim limit 1;
    if other is not null then raise exception 'This room is already claimed by % for that night', other; end if;
    insert into te_hotels (id, day_id, name, amount, occupancy, metro, shared_with)
    values ((p_day->'hotel'->>'id')::uuid, did, p_day->'hotel'->>'name', (p_day->'hotel'->>'amount')::numeric,
      coalesce(p_day->'hotel'->>'occupancy', 'single'), coalesce((p_day->'hotel'->>'metro')::boolean, false),
      (select id from employees where ecode = upper(trim(p_day->'hotel'->>'shared_ecode'))))
    on conflict (day_id) do update set id = excluded.id, name = excluded.name, amount = excluded.amount,
      occupancy = excluded.occupancy, metro = excluded.metro, shared_with = excluded.shared_with;
  else
    delete from te_hotels where day_id = did;
  end if;

  delete from te_expenses where day_id = did and id not in (select (v->>'id')::uuid from jsonb_array_elements(coalesce(p_day->'expenses', '[]')) v);
  insert into te_expenses (id, day_id, category, description, amount)
  select (v->>'id')::uuid, did, v->>'category', v->>'description', coalesce((v->>'amount')::numeric, 0)
  from jsonb_array_elements(coalesce(p_day->'expenses', '[]')) v where coalesce((v->>'amount')::numeric, 0) > 0
  on conflict (id) do update set category = excluded.category, description = excluded.description, amount = excluded.amount;

  -- Bills whose row is gone go with it.
  delete from te_bills b where b.claim_id = p_claim and b.owner_id not in (
    select id from te_rides where day_id in (select id from te_days where claim_id = p_claim)
    union select id from te_hotels where day_id in (select id from te_days where claim_id = p_claim)
    union select id from te_expenses where day_id in (select id from te_days where claim_id = p_claim))
    and b.created_at < now() - interval '1 day';
  update te_claims set updated_at = now() where id = p_claim;
  return did;
end $f$;

create or replace function public.te_delete_day(p_day uuid)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare cid uuid;
begin
  select claim_id into cid from te_days where id = p_day;
  if cid is null or not te_can_edit(cid) then raise exception 'This claim cannot be changed now'; end if;
  delete from te_bills where owner_id in (select id from te_rides where day_id = p_day union select id from te_hotels where day_id = p_day union select id from te_expenses where day_id = p_day);
  delete from te_days where id = p_day;
end $f$;

/** A bill, after its file is in storage. The same file twice is refused, naming where it was used. */
create or replace function public.te_add_bill(p_claim uuid, p_kind text, p_owner uuid, p_path text, p_name text,
  p_sha256 text, p_phash bigint, p_amount numeric, p_date date, p_billno text)
returns uuid language plpgsql security definer set search_path to 'public' as $f$
declare used text; bid uuid;
begin
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be changed now'; end if;
  select coalesce(k.number, 'an unsent claim') || ' · ' || to_char(b.created_at at time zone 'Asia/Kolkata', 'DD Mon') || ' · ' || e.full_name
    into used from te_bills b join te_claims k on k.id = b.claim_id join employees e on e.id = k.employee_id where b.sha256 = p_sha256;
  if used is not null then raise exception 'Same bill as %', used; end if;
  insert into te_bills (claim_id, owner_kind, owner_id, path, name, sha256, phash, ocr_amount, ocr_date, ocr_billno, uploaded_by)
  values (p_claim, p_kind, p_owner, p_path, p_name, p_sha256, p_phash, p_amount, p_date, nullif(trim(p_billno), ''), current_employee_id())
  returning id into bid;
  return bid;
end $f$;

create or replace function public.te_remove_bill(p_bill uuid)
returns text language plpgsql security definer set search_path to 'public' as $f$
declare b te_bills;
begin
  select * into b from te_bills where id = p_bill;
  if b.id is null or not te_can_edit(b.claim_id) then raise exception 'This claim cannot be changed now'; end if;
  delete from te_bills where id = p_bill;
  return b.path;
end $f$;

-- ---------------------------------------------------------------- reading a claim
/** The whole claim as one value: header, days with everything on them, bills, and what is flagged. */
create or replace function public.te_claim(p_claim uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
declare c te_claims; out jsonb; me uuid := current_employee_id();
begin
  if not te_can_see(p_claim) then raise exception 'That claim is not yours to see'; end if;
  select * into c from te_claims where id = p_claim;
  select jsonb_build_object(
    'claim', to_jsonb(c) || jsonb_build_object(
      'name', e.full_name, 'ecode', e.ecode,
      'manager', (select full_name from employees where id = e.reporting_manager_id),
      'coordinator', (select x.full_name from te_coordinators k join employees x on x.id = k.coordinator_id where k.employee_id = c.employee_id),
      'mine', c.employee_id = me,
      'can_edit', te_can_edit(p_claim),
      'can_decide', (c.status = 'with_manager' and (e.reporting_manager_id = me or te_is_admin()))
        or (c.status = 'with_coordinator' and (exists (select 1 from te_coordinators k where k.employee_id = c.employee_id and k.coordinator_id = me) or te_is_admin()))
        or (c.status = 'with_desk' and te_is_desk()),
      'is_desk', te_is_desk()),
    'rule', to_jsonb(te_rule(c.grade)),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'day', d.day, 'place', d.place, 'district', d.district, 'purpose', d.purpose,
        'da_kind', d.da_kind, 'da_amount', d.da_amount, 'continues_day', d.continues_day, 'remarks', d.remarks,
        'rides', coalesce((select jsonb_agg(to_jsonb(r) order by r.seq) from te_rides r where r.day_id = d.id), '[]'),
        'tickets', coalesce((select jsonb_agg(to_jsonb(t)) from te_tickets t where t.day_id = d.id), '[]'),
        'hotel', (select to_jsonb(h) || jsonb_build_object('shared_ecode', (select ecode from employees where id = h.shared_with),
                    'shared_name', (select full_name from employees where id = h.shared_with)) from te_hotels h where h.day_id = d.id),
        'room_by', (select jsonb_build_object('name', x.full_name, 'ecode', x.ecode, 'amount', h.amount, 'number', k.number)
                    from te_hotels h join te_days dd on dd.id = h.day_id join te_claims k on k.id = dd.claim_id join employees x on x.id = k.employee_id
                    where h.shared_with = c.employee_id and dd.day = d.day and k.id <> c.id limit 1),
        'expenses', coalesce((select jsonb_agg(to_jsonb(x)) from te_expenses x where x.day_id = d.id), '[]')
      ) order by d.day) from te_days d where d.claim_id = c.id), '[]'),
    'bills', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'owner_kind', b.owner_kind, 'owner_id', b.owner_id,
        'path', b.path, 'name', b.name, 'ocr_amount', b.ocr_amount, 'ocr_date', b.ocr_date, 'ocr_billno', b.ocr_billno,
        -- Possibly the same bill photographed again: the same amount, date and bill number, or a look-alike picture.
        'twin', (select coalesce(k.number, 'an unsent claim') || ' · ' || x.full_name from te_bills o join te_claims k on k.id = o.claim_id join employees x on x.id = k.employee_id
                 where o.id <> b.id and (
                   (b.ocr_billno is not null and o.ocr_billno = b.ocr_billno and o.ocr_amount is not distinct from b.ocr_amount)
                   or (b.phash is not null and o.phash is not null and bit_count((b.phash # o.phash)::bit(64)) <= 5))
                 limit 1))) from te_bills b where b.claim_id = c.id), '[]'),
    'km_month', (select jsonb_build_object(
        'bike', coalesce(sum(r.claimed_km) filter (where r.mode = 'bike'), 0),
        'car', coalesce(sum(r.claimed_km) filter (where r.mode = 'car'), 0),
        'auto', coalesce(sum(r.fare) filter (where r.mode = 'auto'), 0))
      from te_rides r join te_days d on d.id = r.day_id where d.claim_id = c.id),
    'policy', (select jsonb_object_agg(key, value) from te_policy),
    'purposes', (select jsonb_agg(label order by sort, label) from te_purposes where is_active),
    'office_purposes', (select coalesce(jsonb_agg(label), '[]') from te_purposes where not gives_da)
  ) into out
  from employees e where e.id = c.employee_id;
  return out;
end $f$;

create or replace function public.te_total(p_claim uuid)
returns numeric language sql stable security definer set search_path to 'public' as $f$
  select coalesce((select sum(r.amount) from te_rides r join te_days d on d.id = r.day_id where d.claim_id = p_claim), 0)
       + coalesce((select sum(d.da_amount) from te_days d where d.claim_id = p_claim), 0)
       + coalesce((select sum(h.amount) from te_hotels h join te_days d on d.id = h.day_id where d.claim_id = p_claim), 0)
       + coalesce((select sum(x.amount) from te_expenses x join te_days d on d.id = x.day_id where d.claim_id = p_claim), 0)
$f$;

/** The person's own claims, newest month first, with their totals. */
create or replace function public.te_my_claims()
returns table (id uuid, month date, status text, number text, total numeric, days int)
language sql stable security definer set search_path to 'public' as $f$
  select c.id, c.month, c.status, c.number, te_total(c.id), (select count(*)::int from te_days d where d.claim_id = c.id)
  from te_claims c where c.employee_id = current_employee_id() order by c.month desc
$f$;



/** Claims waiting on this person, and the ones they have already passed on (latest 200). */
create or replace function public.te_inbox()
returns table (id uuid, month date, status text, number text, total numeric, name text, ecode text, submitted_at timestamptz, waiting boolean)
language sql stable security definer set search_path to 'public' as $f$
  with mine as (
    select c.*, e.full_name, e.ecode,
      (c.status = 'with_manager' and e.reporting_manager_id = current_employee_id())
      or (c.status = 'with_coordinator' and exists (select 1 from te_coordinators k where k.employee_id = c.employee_id and k.coordinator_id = current_employee_id()))
      or (c.status = 'with_desk' and te_is_desk()) as waiting
    from te_claims c join employees e on e.id = c.employee_id
    where c.status <> 'draft' and c.employee_id <> current_employee_id() and te_can_see(c.id)
  )
  select id, month, status, number, te_total(id), full_name, ecode, submitted_at, waiting
  from mine order by waiting desc, submitted_at desc nulls last limit 200
$f$;

-- ---------------------------------------------------------------- moving it along
create or replace function public.te_submit(p_claim uuid)
returns text language plpgsql security definer set search_path to 'public' as $f$
declare c te_claims; due date; late int := 0; steps jsonb := te_pol('late_pct'); over numeric := (te_pol('bill_over'))::text::numeric; missing text;
begin
  select * into c from te_claims where id = p_claim;
  if not te_can_edit(p_claim) then raise exception 'This claim cannot be sent now'; end if;
  if not exists (select 1 from te_days where claim_id = p_claim) then raise exception 'Add at least one day first'; end if;
  -- Bills the policy asks for.
  select string_agg(distinct to_char(d.day, 'DD Mon'), ', ') into missing from te_days d where d.claim_id = p_claim and (
    exists (select 1 from te_rides r where r.day_id = d.id and (r.mode in ('bus', 'train', 'flight') or r.amount > over)
            and not exists (select 1 from te_bills b where b.owner_id = r.id))
    or exists (select 1 from te_hotels h where h.day_id = d.id and not exists (select 1 from te_bills b where b.owner_id = h.id))
    or exists (select 1 from te_expenses x where x.day_id = d.id and (x.amount > over or x.category in ('Courier', 'Toll', 'Client meal', 'Team meal'))
            and not exists (select 1 from te_bills b where b.owner_id = x.id)));
  if missing is not null then raise exception 'Attach the bills still needed on %', missing; end if;
  -- Late: due by the 5th of the next month; 1, 2, 3 months after that take 10, 20, 30 percent; later is refused.
  due := (c.month + interval '1 month')::date + ((te_pol('submit_by_day'))::text::int - 1);
  if current_date > due then
    late := ((extract(year from age(current_date, due)) * 12 + extract(month from age(current_date, due)))::int) + 1;
    if late > jsonb_array_length(steps) then raise exception 'This month is more than % months late and cannot be claimed', jsonb_array_length(steps); end if;
    late := (steps->>(late - 1))::int;
  end if;
  update te_claims set status = 'with_manager', submitted_at = now(), late_pct = late, return_note = null,
    number = coalesce(number, 'TE-' || to_char(month, 'YYMM') || '-' || lpad(nextval('te_claim_seq')::text, 4, '0')),
    updated_at = now()
  where id = p_claim returning number into c.number;
  return c.number;
end $f$;

/** Approve (on to the next step) or send back, by whoever it is waiting on. */
create or replace function public.te_decide(p_claim uuid, p_approve boolean, p_note text default null)
returns text language plpgsql security definer set search_path to 'public' as $f$
declare c te_claims; me uuid := current_employee_id(); mgr uuid; has_coord boolean; nxt text;
begin
  select * into c from te_claims where id = p_claim for update;
  select reporting_manager_id into mgr from employees where id = c.employee_id;
  has_coord := exists (select 1 from te_coordinators where employee_id = c.employee_id);
  if c.status = 'with_manager' and not (mgr = me or te_is_admin()) then raise exception 'This claim waits on the reporting manager'; end if;
  if c.status = 'with_coordinator' and not (exists (select 1 from te_coordinators where employee_id = c.employee_id and coordinator_id = me) or te_is_admin()) then raise exception 'This claim waits on the coordinator'; end if;
  if c.status = 'with_desk' and not te_is_desk() then raise exception 'This claim waits on the Travel Desk'; end if;
  if c.status not in ('with_manager', 'with_coordinator', 'with_desk') then raise exception 'This claim is not waiting on anybody'; end if;
  if c.employee_id = me then raise exception 'Nobody approves their own claim'; end if;
  if not p_approve then
    if coalesce(trim(p_note), '') = '' then raise exception 'Say why it is going back'; end if;
    update te_claims set status = 'returned', returned_by = me, returned_at = now(), return_note = trim(p_note), updated_at = now() where id = p_claim;
    return 'returned';
  end if;
  nxt := case c.status when 'with_manager' then case when has_coord then 'with_coordinator' else 'with_desk' end
                       when 'with_coordinator' then 'with_desk' else 'approved' end;
  update te_claims set status = nxt, updated_at = now(),
    manager_id = case when c.status = 'with_manager' then me else manager_id end,
    manager_at = case when c.status = 'with_manager' then now() else manager_at end,
    manager_note = case when c.status = 'with_manager' then nullif(trim(p_note), '') else manager_note end,
    coordinator_id = case when c.status = 'with_coordinator' then me else coordinator_id end,
    coordinator_at = case when c.status = 'with_coordinator' then now() else coordinator_at end,
    coordinator_note = case when c.status = 'with_coordinator' then nullif(trim(p_note), '') else coordinator_note end,
    desk_id = case when c.status = 'with_desk' then me else desk_id end,
    desk_at = case when c.status = 'with_desk' then now() else desk_at end,
    desk_note = case when c.status = 'with_desk' then nullif(trim(p_note), '') else desk_note end
  where id = p_claim;
  return nxt;
end $f$;

/** The Travel Desk: the advance given against the month, and marking it paid. */
create or replace function public.te_set_advance(p_claim uuid, p_advance numeric)
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  if not te_is_desk() then raise exception 'Only the Travel Desk'; end if;
  if p_advance < 0 or p_advance > 20000 then raise exception 'An advance is between 0 and 20,000 a month'; end if;
  update te_claims set advance = p_advance, updated_at = now() where id = p_claim and status <> 'paid';
end $f$;
create or replace function public.te_mark_paid(p_claim uuid)
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  if not te_is_desk() then raise exception 'Only the Travel Desk'; end if;
  update te_claims set status = 'paid', paid_at = now(), updated_at = now() where id = p_claim and status = 'approved';
  if not found then raise exception 'Approve it first'; end if;
end $f$;

-- ---------------------------------------------------------------- the admins' page
create or replace function public.te_admin_data()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  return jsonb_build_object(
    'rules', (select jsonb_agg(to_jsonb(r) order by r.grade = '*' desc, r.grade) from te_grade_rules r),
    'policy', (select jsonb_object_agg(key, value) from te_policy),
    'purposes', (select jsonb_agg(to_jsonb(p) order by p.sort, p.label) from te_purposes p),
    'coordinators', (select coalesce(jsonb_agg(jsonb_build_object('ecode', e.ecode, 'name', e.full_name, 'coordinator_ecode', k.ecode, 'coordinator', k.full_name) order by e.full_name), '[]')
                     from te_coordinators c join employees e on e.id = c.employee_id join employees k on k.id = c.coordinator_id),
    'desk', (select coalesce(jsonb_agg(jsonb_build_object('ecode', e.ecode, 'name', e.full_name) order by e.full_name), '[]')
             from user_roles u join employees e on e.id = u.employee_id where u.role = 'travel_desk'));
end $f$;

create or replace function public.te_set_rule(p_rule jsonb)
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  insert into te_grade_rules select * from jsonb_populate_record(null::te_grade_rules, p_rule || jsonb_build_object('updated_at', now(), 'updated_by', current_employee_id()))
  on conflict (grade) do update set da_in_district = excluded.da_in_district, da_out_district = excluded.da_out_district,
    da_out_state = excluded.da_out_state, da_out_state_stay = excluded.da_out_state_stay,
    hotel_in_single = excluded.hotel_in_single, hotel_in_double = excluded.hotel_in_double,
    hotel_out_single = excluded.hotel_out_single, hotel_out_double = excluded.hotel_out_double,
    bike_rate = excluded.bike_rate, bike_km_month = excluded.bike_km_month, car_rate = excluded.car_rate, car_km_month = excluded.car_km_month,
    flight = excluded.flight, taxi = excluded.taxi, updated_at = now(), updated_by = current_employee_id();
end $f$;
create or replace function public.te_set_policy(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  update te_policy set value = p_value, updated_at = now() where key = p_key;
  if not found then raise exception 'No such setting'; end if;
end $f$;
create or replace function public.te_set_purpose(p_id int, p_label text, p_gives_da boolean, p_active boolean)
returns void language plpgsql security definer set search_path to 'public' as $f$
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  if p_id is null then
    insert into te_purposes (label, gives_da, sort) values (trim(p_label), p_gives_da, (select coalesce(max(sort), 0) + 1 from te_purposes));
  else
    update te_purposes set label = trim(p_label), gives_da = p_gives_da, is_active = p_active where id = p_id;
  end if;
end $f$;
create or replace function public.te_set_coordinator(p_ecode text, p_coordinator text)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare e uuid; k uuid;
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  select id into e from employees where ecode = upper(trim(p_ecode));
  if e is null then raise exception 'No one with the code %', p_ecode; end if;
  if coalesce(trim(p_coordinator), '') = '' then delete from te_coordinators where employee_id = e; return; end if;
  select id into k from employees where ecode = upper(trim(p_coordinator));
  if k is null then raise exception 'No one with the code %', p_coordinator; end if;
  if k = e then raise exception 'Nobody coordinates their own claims'; end if;
  insert into te_coordinators (employee_id, coordinator_id, set_by) values (e, k, current_employee_id())
  on conflict (employee_id) do update set coordinator_id = excluded.coordinator_id, set_by = excluded.set_by, set_at = now();
end $f$;
create or replace function public.te_set_desk(p_ecode text, p_on boolean)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare e uuid;
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  select id into e from employees where ecode = upper(trim(p_ecode));
  if e is null then raise exception 'No one with the code %', p_ecode; end if;
  if p_on then insert into user_roles (employee_id, role) values (e, 'travel_desk') on conflict do nothing;
  else delete from user_roles where employee_id = e and role = 'travel_desk'; end if;
end $f$;

/** Names for the "Shared with" and coordinator boxes: anybody active, by name or code. */
create or replace function public.te_people(p_q text)
returns table (ecode text, full_name text)
language sql stable security definer set search_path to 'public' as $f$
  select ecode, full_name from employees
  where is_active and travel_has_access() and length(trim(p_q)) >= 2 and (ecode ilike trim(p_q) || '%' or full_name ilike '%' || trim(p_q) || '%')
  order by full_name limit 12
$f$;

do $g$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'te\_%' loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g$;

-- ---------------------------------------------------------------- bills in storage
-- Private: a bill is opened with a short-lived link by whoever may see its claim.
insert into storage.buckets (id, name, public, file_size_limit) values ('te-bills', 'te-bills', false, 10485760)
on conflict (id) do nothing;
drop policy if exists te_bills_put on storage.objects;
create policy te_bills_put on storage.objects for insert to authenticated
  with check (bucket_id = 'te-bills' and public.te_can_edit(((storage.foldername(name))[1])::uuid));
drop policy if exists te_bills_get on storage.objects;
create policy te_bills_get on storage.objects for select to authenticated
  using (bucket_id = 'te-bills' and public.te_can_see(((storage.foldername(name))[1])::uuid));
drop policy if exists te_bills_del on storage.objects;
create policy te_bills_del on storage.objects for delete to authenticated
  using (bucket_id = 'te-bills' and public.te_can_edit(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------- the test accounts (the user, 17 Oct)
-- E6666 the engineer (JM2, E9999 his manager), E8888 the coordinator, E7777 the Travel Desk.
update public.employees set grade = 'JM2' where ecode = 'E6666' and grade is null;
insert into public.te_coordinators (employee_id, coordinator_id)
select e.id, k.id from public.employees e, public.employees k where e.ecode = 'E6666' and k.ecode = 'E8888'
on conflict (employee_id) do nothing;
insert into public.user_roles (employee_id, role) select id, 'travel_desk' from public.employees where ecode = 'E7777' on conflict do nothing;
