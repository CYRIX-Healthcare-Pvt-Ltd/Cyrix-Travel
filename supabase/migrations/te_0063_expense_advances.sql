/*
  te_0063 — expense advances (the user, 24 Oct: "now we need advance request also in travel exp module … manager
  should approve then travel desk should approve then only tm can see his amount … if anyone has advance, claiming
  should reduce it"), under the rules HR mailed the same day:

  1. Only for official travel out of the state; none within it. The destination's state is not the home's.
  2. The reporting manager approves every request; then the Travel Desk. Only then is it given.
  3. It is taken off that month's claims; what is left, off the next month's, and on until it is used up.
  4. Two advances a month at most, ₹20,000 a month in all (te_policy advance_month_count / advance_month_amount).
  5. No further advance while one is unsettled — still waiting, or with a balance no sent claim has used yet.

  The form asks only what Travel does not know (the user: "the fields which we already have dont use it"): the
  amount, the purpose (work details), the reason, and the destination. The base is the home (travel_homes) and the
  cost centre the person's function (employees.function_name; the user: "need to add cost centre also in form …
  the cost centre which they are mapped ie in function in db"), both shown, not editable; the date, the person and
  the manager are known.

  What a claim takes is worked out, not typed: te_advance_split hands the advances given, oldest first, to the
  person's claims in the order they were sent (a claim takes only from advances of its month or before), and fixes
  each claim's share in te_advance_uses when the Travel Desk marks it paid — a paid claim's share never moves. The
  Travel Desk's typed advance (te_set_advance, te_claims.advance) is gone: te_claim's 'advance' is now this share.
*/

create sequence if not exists public.te_advance_seq;

create table if not exists public.te_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  number text unique,
  amount numeric not null check (amount > 0),
  purpose text not null,
  reason text not null,
  cost_centre text,
  base_name text, base_lat double precision not null, base_lng double precision not null, base_state text not null,
  dest_name text not null, dest_lat double precision not null, dest_lng double precision not null, dest_state text not null,
  -- The month it is asked in (India time): the month's limits count it, and claims from this month on use it.
  month date not null,
  status text not null default 'with_manager' check (status in ('with_manager', 'with_desk', 'given', 'declined', 'cancelled')),
  manager_id uuid references public.employees(id), manager_at timestamptz, manager_note text,
  desk_id uuid references public.employees(id), desk_at timestamptz, desk_note text,
  declined_by uuid references public.employees(id), declined_at timestamptz, decline_note text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists te_advances_employee on public.te_advances (employee_id, month);
alter table public.te_advances enable row level security;

-- What a paid claim took from an advance, fixed at payment.
create table if not exists public.te_advance_uses (
  advance_id uuid not null references public.te_advances(id) on delete cascade,
  claim_id uuid not null references public.te_claims(id) on delete cascade,
  amount numeric not null check (amount > 0),
  at timestamptz not null default now(),
  primary key (advance_id, claim_id)
);
alter table public.te_advance_uses enable row level security;

insert into public.te_policy (key, value) values ('advance_month_count', '2'), ('advance_month_amount', '20000')
on conflict (key) do nothing;

create or replace function public.te_advance_number(n integer) returns text language sql immutable as $$
  select 'AD-' || case when n < 10 then '0' || n::text else n::text end
$$;

/*
  Who takes what: the uses fixed at payment first (frozen, ord 0); then each unpaid claim in turn — sent ones in
  the order sent, then the ones not sent (a draft sees what it would take, and counts for nothing yet). A claim
  takes from the oldest advance with something left, of its month or before, up to what it pays (total less the
  late cut). Every unpaid claim also gives one row with no advance, carrying its place in the order.
*/
create or replace function public.te_advance_split(p_employee uuid)
returns table (advance_id uuid, claim_id uuid, amount numeric, frozen boolean, ord integer, sent boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare ids uuid[]; months date[]; rem numeric[]; k record; i integer; n integer := 0; need numeric; take numeric;
begin
  return query
    select u.advance_id, u.claim_id, u.amount, true, 0, true
    from te_advance_uses u join te_advances v on v.id = u.advance_id where v.employee_id = p_employee;
  select array_agg(v.id order by v.month, v.desk_at, v.id), array_agg(v.month order by v.month, v.desk_at, v.id),
         array_agg(v.amount - coalesce((select sum(u.amount) from te_advance_uses u where u.advance_id = v.id), 0) order by v.month, v.desk_at, v.id)
    into ids, months, rem
  from te_advances v where v.employee_id = p_employee and v.status = 'given';
  for k in
    select c.id, c.month, c.late_pct, c.status not in ('draft', 'returned', 'recalled') as is_sent
    from te_claims c where c.employee_id = p_employee and c.status <> 'paid'
    order by (c.status in ('draft', 'returned', 'recalled')), c.submitted_at nulls last, c.month, c.id
  loop
    n := n + 1;
    advance_id := null; claim_id := k.id; amount := 0; frozen := false; ord := n; sent := k.is_sent;
    return next;
    if ids is null then continue; end if;
    need := te_total(k.id);
    need := need - round(need * coalesce(k.late_pct, 0) / 100.0);
    for i in 1 .. array_length(ids, 1) loop
      exit when need <= 0;
      continue when rem[i] <= 0 or months[i] > k.month;
      take := least(need, rem[i]);
      rem[i] := rem[i] - take;
      need := need - take;
      advance_id := ids[i]; claim_id := k.id; amount := take; frozen := false; ord := n; sent := k.is_sent;
      return next;
    end loop;
  end loop;
end $$;

/* What each advance of a person has had used — by paid claims and sent ones (a draft uses nothing yet). */
create or replace function public.te_advance_used(p_employee uuid)
returns table (advance_id uuid, used numeric)
language sql stable security definer set search_path = public as $$
  select s.advance_id, sum(s.amount) from te_advance_split(p_employee) s
  where s.advance_id is not null and s.sent group by s.advance_id
$$;

/*
  The Advance meter on a claim and in its form (the user, 24 Oct: "after phone need to show advance amount also";
  "in next month also balance should show"): every advance given of the claim's month or before, and how much of it
  the claims before this one have used. This claim then takes what it pays, up to what is left.
*/
create or replace function public.te_advance_box(p_claim uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c te_claims; given numeric; before numeric; myord integer; mine_at timestamptz;
begin
  select * into c from te_claims where id = p_claim;
  select coalesce(sum(v.amount), 0) into given from te_advances v
  where v.employee_id = c.employee_id and v.status = 'given' and v.month <= c.month;
  if given = 0 then return null; end if;
  if c.status = 'paid' then
    select min(u.at) into mine_at from te_advance_uses u where u.claim_id = p_claim;
    select coalesce(sum(u.amount), 0) into before from te_advance_uses u join te_advances v on v.id = u.advance_id
    where v.employee_id = c.employee_id and v.status = 'given' and v.month <= c.month and u.claim_id <> p_claim
      and (mine_at is null or u.at < mine_at);
  else
    select min(s.ord) into myord from te_advance_split(c.employee_id) s where s.claim_id = p_claim and s.advance_id is null;
    select coalesce(sum(s.amount), 0) into before from te_advance_split(c.employee_id) s join te_advances v on v.id = s.advance_id
    where v.month <= c.month and s.claim_id <> p_claim and (s.frozen or s.ord < myord);
  end if;
  return jsonb_build_object('given', given, 'before', before);
end $$;

create or replace function public.te_advance_can_see(p_advance uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from te_advances v where v.id = p_advance and (
    v.employee_id = current_employee_id() or te_is_admin() or te_is_desk() or is_in_my_downline(v.employee_id)))
$$;

/* A message to one person about an advance: the bell, and devices on the next round (kind 'travel'). */
create or replace function public.te_advance_tell(p_to uuid, p_title text, p_body text, p_url text, p_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  if p_to is null or p_to = p_by then return; end if;
  insert into push_messages (kind, title, body, url, target, sent_by)
  values ('travel', left(p_title, 80), left(coalesce(p_body, ''), 400), p_url, jsonb_build_object('kind', 'travel', 'advance', true), p_by)
  returning id into mid;
  insert into push_inbox (message_id, employee_id) values (mid, p_to);
end $$;

/*
  Why this person may not ask for another advance now (rule 5, then rule 4), or null. Said where they would press
  Request, and refused again here when they send.
*/
create or replace function public.te_advance_blocked(p_employee uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare w record; m date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
        n integer; total numeric; most_n integer; most numeric;
begin
  select number into w from te_advances where employee_id = p_employee and status in ('with_manager', 'with_desk') order by created_at limit 1;
  if found then return w.number || ' is still waiting for approval'; end if;
  for w in
    select v.number, v.amount - coalesce(u.used, 0) as left_
    from te_advances v left join te_advance_used(p_employee) u on u.advance_id = v.id
    where v.employee_id = p_employee and v.status = 'given' order by v.month, v.desk_at
  loop
    if w.left_ > 0 then return w.number || ' has ₹' || to_char(w.left_, 'FM99,99,99,990') || ' to settle — send a claim for it first'; end if;
  end loop;
  most_n := coalesce((select (value #>> '{}')::int from te_policy where key = 'advance_month_count'), 2);
  most := coalesce((select (value #>> '{}')::numeric from te_policy where key = 'advance_month_amount'), 20000);
  select count(*), coalesce(sum(amount), 0) into n, total from te_advances
  where employee_id = p_employee and month = m and status not in ('declined', 'cancelled');
  if n >= most_n then return most_n || ' advances this month already'; end if;
  if total >= most then return '₹' || to_char(most, 'FM99,99,99,990') || ' of advances this month already'; end if;
  return null;
end $$;

create or replace function public.te_advance_request(
  p_amount numeric, p_purpose text, p_reason text, p_base_name text, p_base_state text,
  p_dest_name text, p_dest_lat double precision, p_dest_lng double precision, p_dest_state text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); e employees; h travel_homes; why text; m date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
        total numeric; most numeric; v te_advances; amt numeric := round(coalesce(p_amount, 0));
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into e from employees where id = me;
  select * into h from travel_homes where employee_id = me;
  if h.employee_id is null then raise exception 'Set your home in My places first — it is where the advance is from'; end if;
  if e.reporting_manager_id is null then raise exception 'You have no reporting manager to approve it'; end if;
  if amt <= 0 then raise exception 'Enter the advance amount'; end if;
  if length(btrim(coalesce(p_purpose, ''))) < 3 then raise exception 'Enter the purpose — the work it is for'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Enter the reason for the advance'; end if;
  if p_dest_lat is null or p_dest_lng is null or length(btrim(coalesce(p_dest_name, ''))) = 0 then raise exception 'Choose where you are travelling to'; end if;
  if nullif(btrim(coalesce(p_base_state, '')), '') is null or nullif(btrim(coalesce(p_dest_state, '')), '') is null then
    raise exception 'The state of your home or the destination could not be found — try again';
  end if;
  -- Rule 1: out of the state only.
  if lower(btrim(p_base_state)) = lower(btrim(p_dest_state)) then
    raise exception 'An advance is only for travel outside %', btrim(p_base_state);
  end if;
  -- Rules 5 and 4.
  why := te_advance_blocked(me);
  if why is not null then raise exception '%', why; end if;
  most := coalesce((select (value #>> '{}')::numeric from te_policy where key = 'advance_month_amount'), 20000);
  select coalesce(sum(amount), 0) into total from te_advances where employee_id = me and month = m and status not in ('declined', 'cancelled');
  if total + amt > most then
    raise exception 'Up to ₹% this month — ₹% is left', to_char(most, 'FM99,99,99,990'), to_char(most - total, 'FM99,99,99,990');
  end if;
  insert into te_advances (employee_id, number, amount, purpose, reason, cost_centre, base_name, base_lat, base_lng, base_state,
                           dest_name, dest_lat, dest_lng, dest_state, month)
  values (me, te_advance_number(nextval('te_advance_seq')::int), amt, btrim(p_purpose), btrim(p_reason), nullif(btrim(coalesce(e.function_name, '')), ''),
          nullif(btrim(coalesce(p_base_name, '')), ''), h.lat, h.lng, btrim(p_base_state),
          btrim(p_dest_name), p_dest_lat, p_dest_lng, btrim(p_dest_state), m)
  returning * into v;
  perform te_advance_tell(e.reporting_manager_id, 'Advance ' || v.number || ' · ₹' || to_char(amt, 'FM99,99,99,990') || ' from ' || split_part(e.full_name, ' ', 1),
    btrim(p_base_state) || ' → ' || btrim(p_dest_name) || ' · ' || btrim(p_purpose), '/travel/approvals?view=advances', me);
  return jsonb_build_object('id', v.id, 'number', v.number);
end $$;

create or replace function public.te_advance_cancel(p_advance uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v te_advances;
begin
  select * into v from te_advances where id = p_advance;
  if v.id is null or v.employee_id <> current_employee_id() then raise exception 'That advance is not yours'; end if;
  if v.status not in ('with_manager', 'with_desk') then raise exception 'Only a request still waiting can be withdrawn'; end if;
  update te_advances set status = 'cancelled', cancelled_at = now() where id = p_advance;
end $$;

/* The manager's step, then the Travel Desk's: approve, or decline with a reason. */
create or replace function public.te_advance_decide(p_advance uuid, p_approve boolean, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); v te_advances; e employees; note text := nullif(btrim(coalesce(p_note, '')), ''); d record;
        amt text;
begin
  select * into v from te_advances where id = p_advance;
  if v.id is null then raise exception 'That advance is not there any more'; end if;
  if v.employee_id = me then raise exception 'Your own advance is approved by others'; end if;
  select * into e from employees where id = v.employee_id;
  amt := '₹' || to_char(v.amount, 'FM99,99,99,990');
  if v.status = 'with_manager' then
    if not (e.reporting_manager_id = me or te_is_admin()) then raise exception 'It waits on % to approve', coalesce((select full_name from employees where id = e.reporting_manager_id), 'the reporting manager'); end if;
  elsif v.status = 'with_desk' then
    if not te_is_desk() then raise exception 'It waits on the Travel Desk'; end if;
  else
    raise exception '% is not waiting for approval', v.number;
  end if;
  if not p_approve then
    if note is null or length(note) < 3 then raise exception 'Say why it is declined'; end if;
    update te_advances set status = 'declined', declined_by = me, declined_at = now(), decline_note = note where id = p_advance;
    perform te_advance_tell(v.employee_id, 'Advance ' || v.number || ' declined', note, '/travel/advances', me);
    return 'declined';
  end if;
  if v.status = 'with_manager' then
    update te_advances set status = 'with_desk', manager_id = me, manager_at = now(), manager_note = note where id = p_advance;
    for d in select employee_id from user_roles where role = 'travel_desk' loop
      perform te_advance_tell(d.employee_id, 'Advance ' || v.number || ' · ' || amt || ' for ' || split_part(e.full_name, ' ', 1),
        'Approved by the manager · ' || v.base_state || ' → ' || v.dest_name, '/travel/approvals?view=advances', me);
    end loop;
    return 'with_desk';
  end if;
  update te_advances set status = 'given', desk_id = me, desk_at = now(), desk_note = note where id = p_advance;
  perform te_advance_tell(v.employee_id, 'Advance ' || v.number || ' approved · ' || amt, 'It is taken off your claims from ' || to_char(v.month, 'FMMonth') || ' on', '/travel/advances', me);
  return 'given';
end $$;

/* One advance as the screens show it, with what it has had used and by which claims. */
create or replace function public.te_advance_card(v te_advances, p_used numeric)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(v) - 'base_lat' - 'base_lng' || jsonb_build_object(
    'name', e.full_name, 'ecode', e.ecode,
    'manager_name', (select full_name from employees where id = v.manager_id),
    'desk_name', (select full_name from employees where id = v.desk_id),
    'declined_name', (select full_name from employees where id = v.declined_by),
    'used', coalesce(p_used, 0),
    'left', case when v.status = 'given' then v.amount - coalesce(p_used, 0) end,
    'uses', coalesce((select jsonb_agg(jsonb_build_object('claim_id', s.claim_id, 'number', k.number, 'month', k.month, 'part', k.part,
                        'amount', s.amount, 'paid', s.frozen) order by s.frozen desc, s.ord)
                      from te_advance_split(v.employee_id) s join te_claims k on k.id = s.claim_id
                      where s.advance_id = v.id and s.sent), '[]'))
  from employees e where e.id = v.employee_id
$$;

create or replace function public.te_my_advances()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := current_employee_id(); m date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
begin
  return jsonb_build_object(
    'advances', coalesce((select jsonb_agg(te_advance_card(v, u.used) order by v.created_at desc)
                          from te_advances v left join te_advance_used(me) u on u.advance_id = v.id
                          where v.employee_id = me), '[]'),
    'month', jsonb_build_object(
      'count', (select count(*) from te_advances where employee_id = me and month = m and status not in ('declined', 'cancelled')),
      'amount', (select coalesce(sum(amount), 0) from te_advances where employee_id = me and month = m and status not in ('declined', 'cancelled')),
      'max_count', coalesce((select (value #>> '{}')::int from te_policy where key = 'advance_month_count'), 2),
      'max_amount', coalesce((select (value #>> '{}')::numeric from te_policy where key = 'advance_month_amount'), 20000)),
    'blocked', te_advance_blocked(me),
    'manager', (select x.full_name from employees e join employees x on x.id = e.reporting_manager_id where e.id = me),
    'cost_centre', (select nullif(btrim(coalesce(function_name, '')), '') from employees where id = me),
    'home', (select jsonb_build_object('lat', h.lat, 'lng', h.lng) from travel_homes h where h.employee_id = me));
end $$;

/*
  The advances an approver sees: the ones waiting on them first — the manager's reportees' with the manager, every
  one with the Travel Desk for the desk — then the rest they may see, a withdrawn one left out. With each, how the
  person's month stands, so a second advance is seen as one.
*/
create or replace function public.te_advance_inbox()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := current_employee_id(); desk boolean := te_is_desk(); admin boolean := te_is_admin();
begin
  return coalesce((
    select jsonb_agg(x.card || jsonb_build_object('waiting', x.waiting,
        'month_count', (select count(*) from te_advances o where o.employee_id = x.employee_id and o.month = x.month and o.status not in ('declined', 'cancelled')),
        'month_amount', (select coalesce(sum(o.amount), 0) from te_advances o where o.employee_id = x.employee_id and o.month = x.month and o.status not in ('declined', 'cancelled')))
      order by x.waiting desc, x.created_at desc)
    from (
      select v.employee_id, v.month, v.created_at,
        (v.status = 'with_manager' and e.reporting_manager_id = me) or (v.status = 'with_desk' and desk) as waiting,
        te_advance_card(v, (select u.used from te_advance_used(v.employee_id) u where u.advance_id = v.id)) as card
      from te_advances v join employees e on e.id = v.employee_id
      where v.employee_id <> me and v.status <> 'cancelled'
        and (admin or desk or e.reporting_manager_id = me or is_in_my_downline(v.employee_id))
      order by v.created_at desc limit 300
    ) x), '[]');
end $$;

/* Marking a claim paid fixes what it took from the advances. */
create or replace function public.te_mark_paid(p_claim uuid, p_paid_on date, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare c te_claims; ref text := upper(regexp_replace(coalesce(p_ref, ''), '\s+', '', 'g'));
begin
  if not te_is_desk() then raise exception 'Only the Travel Desk marks a claim paid'; end if;
  select * into c from te_claims where id = p_claim;
  if c.id is null or c.status <> 'approved' then raise exception 'Approve it first'; end if;
  if p_paid_on is null then raise exception 'Give the date it was paid'; end if;
  if p_paid_on > (now() at time zone 'Asia/Kolkata')::date then raise exception 'The date it was paid cannot be in the future'; end if;
  if c.desk_at is not null and p_paid_on < (c.desk_at at time zone 'Asia/Kolkata')::date then
    raise exception 'It was approved on %, so it cannot have been paid before', to_char(c.desk_at at time zone 'Asia/Kolkata', 'FMDD Mon');
  end if;
  if ref !~ '^[A-Z0-9/-]{6,30}$' then raise exception 'Give the UTR: 6 to 30 letters and digits'; end if;
  insert into te_advance_uses (advance_id, claim_id, amount)
  select s.advance_id, s.claim_id, s.amount from te_advance_split(c.employee_id) s
  where s.claim_id = p_claim and s.advance_id is not null and s.amount > 0 and not s.frozen;
  update te_claims set status = 'paid', paid_at = now(), paid_on = p_paid_on, paid_ref = ref, updated_at = now() where id = p_claim;
end $$;

drop function if exists public.te_set_advance(uuid, numeric);

revoke execute on function public.te_advance_split(uuid), public.te_advance_used(uuid), public.te_advance_box(uuid),
  public.te_advance_tell(uuid, text, text, text, uuid), public.te_advance_blocked(uuid), public.te_advance_card(te_advances, numeric),
  public.te_advance_can_see(uuid)
  from public, anon, authenticated;
grant execute on function public.te_advance_request(numeric, text, text, text, text, text, double precision, double precision, text),
  public.te_advance_cancel(uuid), public.te_advance_decide(uuid, boolean, text), public.te_my_advances(), public.te_advance_inbox()
  to authenticated;
revoke execute on function public.te_advance_request(numeric, text, text, text, text, text, double precision, double precision, text),
  public.te_advance_cancel(uuid), public.te_advance_decide(uuid, boolean, text), public.te_my_advances(), public.te_advance_inbox(),
  public.te_advance_number(integer)
  from public, anon;


/*
  Coordinators by cost centre (the user, 24 Oct: "coordinator, need cost centre or project, ie only klbemmp cost
  centre guys need to come specific coordinator … the cost centre which they are mapped ie in function in db").
  A person's cost centre is their function (employees.function_name: KLBEMP, APBEMP, Care360 …). Each cost centre
  may have one coordinator; a claim goes to the coordinator of its person's cost centre after the manager, then on
  to the Travel Desk. A cost centre with none goes straight to the desk, as before. Coordinators set person by
  person (te_coordinators) are gone; none was set.
*/
create table if not exists public.te_cost_centre_coordinators (
  cost_centre text primary key,
  coordinator_id uuid not null references public.employees(id) on delete cascade,
  set_by uuid references public.employees(id), set_at timestamptz not null default now()
);
create unique index if not exists te_cost_centre_coordinators_name on public.te_cost_centre_coordinators (lower(cost_centre));
alter table public.te_cost_centre_coordinators enable row level security;

/* Who coordinates a claim: its person's cost centre's coordinator — never the person whose claim it is. */
create or replace function public.te_claim_coordinator(p_claim uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select k.coordinator_id from te_claims c join employees e on e.id = c.employee_id
  join te_cost_centre_coordinators k on lower(k.cost_centre) = lower(btrim(e.function_name))
  where c.id = p_claim and k.coordinator_id <> c.employee_id
$$;

/* What a claim takes from the advances: fixed if paid, else its place in the order (a draft's is what it would take). */
create or replace function public.te_claim_advance(p_claim uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(s.amount), 0) from te_advance_split((select employee_id from te_claims where id = p_claim)) s
  where s.claim_id = p_claim and s.advance_id is not null
$$;

CREATE OR REPLACE FUNCTION public.te_inbox()
 RETURNS TABLE(id uuid, month date, part integer, status text, number text, total numeric, name text, ecode text, submitted_at timestamp with time zone, waiting boolean, days integer, first_day date, last_day date, km numeric, modes text[], tickets integer, places text[], find text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mine as (
    select c.*, e.full_name, e.ecode,
      (c.status = 'with_manager' and e.reporting_manager_id = current_employee_id())
      or (c.delete_requested_at is not null and e.reporting_manager_id = current_employee_id())
      or (c.status = 'with_coordinator' and te_claim_coordinator(c.id) = current_employee_id())
      or (c.status = 'with_desk' and te_is_desk()) as waiting
    from te_claims c join employees e on e.id = c.employee_id
    where c.status <> 'draft' and c.employee_id <> current_employee_id() and te_can_see(c.id)
  )
  select m.id, m.month, m.part, m.status, m.number, te_total(m.id), m.full_name, m.ecode, m.submitted_at, m.waiting,
    (select count(*)::int from te_days d where d.claim_id = m.id),
    (select min(day) from te_days d where d.claim_id = m.id),
    (select max(day) from te_days d where d.claim_id = m.id),
    (select coalesce(sum(case when r.mode in ('bike', 'car') then coalesce(r.claimed_km, r.map_km) else r.map_km end), 0)
       from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id),
    (select coalesce(array_agg(distinct r.mode), '{}') from te_rides r join te_days d on d.id = r.day_id where d.claim_id = m.id),
    (select count(distinct t.ticket_no)::int from te_tickets t join te_days d on d.id = t.day_id where d.claim_id = m.id),
    te_claim_places(m.id), te_claim_find(m.id)
  from mine m order by m.waiting desc, m.submitted_at desc nulls last limit 200
$function$;

CREATE OR REPLACE FUNCTION public.te_admin_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  return jsonb_build_object(
    'rules', (select jsonb_agg(to_jsonb(r) order by r.grade = '*' desc, r.grade) from te_grade_rules r),
    'policy', (select jsonb_object_agg(key, value) from te_policy),
    'purposes', (select jsonb_agg(to_jsonb(p) order by p.sort, p.label) from te_purposes p),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'label', p.label, 'is_active', p.is_active) order by p.sort, p.label), '[]') from te_project_rows() p),
    'coordinators', (select coalesce(jsonb_agg(jsonb_build_object('cost_centre', k.cost_centre, 'coordinator_ecode', x.ecode, 'coordinator', x.full_name,
                       'people', (select count(*) from employees e where e.is_active and lower(btrim(e.function_name)) = lower(k.cost_centre))) order by k.cost_centre), '[]')
                     from te_cost_centre_coordinators k join employees x on x.id = k.coordinator_id),
    -- The cost centres people are mapped to (their function), to choose a coordinator for.
    'cost_centres', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'people', c.n) order by c.name), '[]')
                     from (select min(btrim(function_name)) as name, count(*) as n from employees
                           where is_active and nullif(btrim(function_name), '') is not null group by lower(btrim(function_name))) c),
    'desk', (select coalesce(jsonb_agg(jsonb_build_object('ecode', e.ecode, 'name', e.full_name) order by e.full_name), '[]')
             from user_roles u join employees e on e.id = u.employee_id where u.role = 'travel_desk'),
    'sw', is_sw_admin());
end $function$;

CREATE OR REPLACE FUNCTION public.te_can_see(p_claim uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from te_claims c where c.id = p_claim and (
      c.employee_id = current_employee_id() or te_is_admin() or te_is_desk()
      or is_in_my_downline(c.employee_id)
      or te_claim_coordinator(c.id) = current_employee_id() or c.coordinator_id = current_employee_id()))
$function$;

CREATE OR REPLACE FUNCTION public.te_claim(p_claim uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c te_claims; out jsonb; me uuid := current_employee_id();
begin
  if not te_can_see(p_claim) then raise exception 'That claim is not yours to see'; end if;
  select * into c from te_claims where id = p_claim;
  select jsonb_build_object(
    'claim', to_jsonb(c) || jsonb_build_object(
      'name', e.full_name, 'ecode', e.ecode,
      'manager', (select full_name from employees where id = e.reporting_manager_id),
      'coordinator', (select full_name from employees where id = coalesce(c.coordinator_id, te_claim_coordinator(c.id))),
      'cost_centre', nullif(btrim(coalesce(e.function_name, '')), ''),
      -- What it takes from the person's advances (te_0063), worked out, and the Advance meter.
      'advance', te_claim_advance(c.id),
      'advance_box', te_advance_box(c.id),
      'mine', c.employee_id = me,
      'can_edit', te_can_edit(p_claim),
      'can_decide', (c.status = 'with_manager' and (e.reporting_manager_id = me or te_is_admin()))
        or (c.status = 'with_coordinator' and (te_claim_coordinator(c.id) = me or te_is_admin()))
        or (c.status = 'with_desk' and te_is_desk()),
      'is_desk', te_is_desk(),
      'is_manager', e.reporting_manager_id = me),
    'rule', to_jsonb(te_rule(c.grade)),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'day', d.day, 'place', d.place, 'district', d.district, 'purpose', d.purpose,
        'da_kind', d.da_kind, 'da_amount', d.da_amount, 'continues_day', d.continues_day, 'remarks', d.remarks,
        'place_lat', d.place_lat, 'place_lng', d.place_lng, 'da_auto', d.da_auto,
        -- An auto ride carries what autos usually cost a km around where it started (te_0051).
        'rides', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('auto_norm', case when r.mode = 'auto' then te_auto_norm(r.id) end) order by r.seq) from te_rides r where r.day_id = d.id), '[]'),
        'tickets', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('earlier', (
          select coalesce(jsonb_agg(jsonb_build_object('day', d2.day, 'name', e2.full_name, 'mine', k2.employee_id = c.employee_id) order by d2.day), '[]')
          from te_tickets t2 join te_days d2 on d2.id = t2.day_id join te_claims k2 on k2.id = d2.claim_id join employees e2 on e2.id = k2.employee_id
          where t2.ticket_no = t.ticket_no and d2.day < d.day))) from te_tickets t where t.day_id = d.id), '[]'),
        'hotel', (select to_jsonb(h) || jsonb_build_object('shared_ecode', (select ecode from employees where id = h.shared_with),
                    'shared_name', (select full_name from employees where id = h.shared_with)) from te_hotels h where h.day_id = d.id),
        'room_by', (select jsonb_build_object('name', x.full_name, 'ecode', x.ecode, 'amount', h.amount, 'number', k.number)
                    from te_hotels h join te_days dd on dd.id = h.day_id join te_claims k on k.id = dd.claim_id join employees x on x.id = k.employee_id
                    where h.shared_with = c.employee_id and dd.day = d.day and k.id <> c.id limit 1),
        'expenses', coalesce((select jsonb_agg(to_jsonb(x)) from te_expenses x where x.day_id = d.id), '[]')
      ) order by d.day) from te_days d where d.claim_id = c.id), '[]'),
    'bills', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'owner_kind', b.owner_kind, 'owner_id', b.owner_id,
        'path', b.path, 'name', b.name, 'ocr_amount', b.ocr_amount, 'ocr_date', b.ocr_date, 'ocr_billno', b.ocr_billno,
        -- Possibly the same bill again (te_0032): the same bill number and amount read off it, or the same
        -- picture within 12 of 256 bits; a bill from before keeps its coarse picture, held to 2 of 64. Which
        -- bill it looks like, too (te_0036), so two alike on one claim are told as one pair.
        'twin', case when (tw.o).id is not null then te_bill_label(tw.o) end,
        'twin_owner', (tw.o).owner_id, 'twin_claim', (tw.o).claim_id,
        'refs', b.refs, 'company', te_booking_card(te_bill_company(b))))
      from te_bills b
      left join lateral (select o from te_bills o
                 where o.id <> b.id and b.owner_kind <> 'report' and o.owner_kind <> 'report' and (
                   (b.ocr_billno is not null and b.ocr_amount is not null and o.ocr_billno = b.ocr_billno and o.ocr_amount = b.ocr_amount)
                   or (b.phash2 is not null and o.phash2 is not null and bit_count(('x' || b.phash2)::bit(256) # ('x' || o.phash2)::bit(256)) <= 12)
                   or ((b.phash2 is null or o.phash2 is null) and b.phash is not null and o.phash is not null and bit_count((b.phash # o.phash)::bit(64)) <= 2))
                 limit 1) tw(o) on true
      where b.claim_id = c.id), '[]'),
    'km_month', (select jsonb_build_object(
        'bike', coalesce(sum(r.claimed_km) filter (where r.mode = 'bike'), 0),
        'car', coalesce(sum(r.claimed_km) filter (where r.mode = 'car'), 0),
        'auto', coalesce(sum(r.fare) filter (where r.mode = 'auto'), 0),
        'phone', (select coalesce(sum(x.amount), 0) from te_expenses x join te_days dx on dx.id = x.day_id join te_claims kx on kx.id = dx.claim_id
                  where kx.employee_id = c.employee_id and kx.month = c.month and x.category = 'Phone'))
      from te_rides r join te_days d on d.id = r.day_id join te_claims k on k.id = d.claim_id
      where k.employee_id = c.employee_id and k.month = c.month),
    -- Where the person moved their home while this claim was open (te_0041), for the approvers.
    'home_moves', coalesce((select jsonb_agg(jsonb_build_object('at', m.at, 'km', m.km, 'first', m.from_lat is null, 'how', m.how) order by m.at)
      from te_home_moves m where m.employee_id = c.employee_id and m.from_lat is not null
        and m.at >= c.month and m.at <= coalesce(c.submitted_at, now())), '[]'),
    -- Bookings the company made for this person in the claim's month that no bill on any claim carries (te_0042).
    'company_unlinked', coalesce((select jsonb_agg(te_booking_card(x.booking_id) order by x.travel_date)
      from (select distinct on (k.booking_id) k.booking_id, k.travel_date from te_company_bookings k
            where k.action in ('BOOKING', 'Date_Change', 'OFFLINE_MODIFICATION')
              and k.travel_date >= c.month and k.travel_date < (c.month + interval '1 month')
              and te_booking_for(k.passengers, k.passenger_ids, e.full_name, e.ecode)
              and not exists (select 1 from te_bills bb where k.booking_id = any(bb.refs) or (k.pnr is not null and k.pnr = any(bb.refs)))
            order by k.booking_id) x), '[]'),
    -- How the home in use was set: by standing there, or on the map (te_0053), for the approvers.
    'home', (select jsonb_build_object('how', h.how, 'set_at', h.set_at) from travel_homes h where h.employee_id = c.employee_id),
    'policy', (select jsonb_object_agg(key, value) from te_policy),
    'purposes', (select jsonb_agg(label order by sort, label) from te_purposes where is_active),
    'office_purposes', (select coalesce(jsonb_agg(label), '[]') from te_purposes where not gives_da),
    -- Who acted as what (te_0044): a Travel Desk or coordinator step says so beside the name; the
    -- reporting manager's does not. An amount changed or a claim sent back takes the stage it was at.
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'at', v.at, 'action', v.action, 'to_status', v.to_status,
        'note', v.note, 'actor', a.full_name,
        'role', case
          when v.action = 'coordinator_approved' then 'Coordinator'
          when v.action in ('desk_approved', 'paid', 'advance') then 'Travel Desk'
          when v.action in ('adjusted', 'returned') then (
            select case p.to_status when 'with_desk' then 'Travel Desk' when 'with_coordinator' then 'Coordinator' end
            from te_events p where p.claim_id = v.claim_id and p.to_status is not null and (p.at, p.id) < (v.at, v.id)
            order by p.at desc, p.id desc limit 1)
        end) order by v.at, v.id)
      from te_events v left join employees a on a.id = v.actor_id where v.claim_id = c.id), '[]'),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('item_id', j.item_id, 'unit', j.unit, 'old_value', j.old_value, 'new_value', j.new_value,
        'old_amount', j.old_amount, 'new_amount', j.new_amount, 'reason', j.reason, 'by', b.full_name, 'at', j.at) order by j.at)
      from te_adjustments j left join employees b on b.id = j.by_id where j.claim_id = c.id), '[]')
  ) into out
  from employees e where e.id = c.employee_id;
  return out;
end $function$;

CREATE OR REPLACE FUNCTION public.te_decide(p_claim uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c te_claims; me uuid := current_employee_id(); mgr uuid; has_coord boolean; nxt text;
begin
  select * into c from te_claims where id = p_claim for update;
  select reporting_manager_id into mgr from employees where id = c.employee_id;
  has_coord := te_claim_coordinator(p_claim) is not null;
  if c.status = 'with_manager' and not (mgr = me or te_is_admin()) then raise exception 'This claim waits on the reporting manager'; end if;
  if c.status = 'with_coordinator' and not (te_claim_coordinator(p_claim) = me or te_is_admin()) then raise exception 'This claim waits on the coordinator'; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.te_adjust(p_claim uuid, p_kind text, p_item uuid, p_value numeric, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c te_claims; me uuid := current_employee_id(); mgr uuid; r te_grade_rules; rd te_rides;
  day_of date; old_v numeric; old_a numeric; new_a numeric; u text := '₹'; lbl text;
  fmt_old text; fmt_new text;
begin
  select * into c from te_claims where id = p_claim for update;
  if c.id is null then raise exception 'No such claim'; end if;
  select reporting_manager_id into mgr from employees where id = c.employee_id;
  if not ((c.status = 'with_manager' and (mgr = me or te_is_admin()))
       or (c.status = 'with_coordinator' and (te_claim_coordinator(c.id) = me or te_is_admin()))
       or (c.status = 'with_desk' and te_is_desk())) then
    raise exception 'Only whoever the claim waits on can change it';
  end if;
  if c.employee_id = me then raise exception 'Nobody changes their own claim here'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it is changed'; end if;
  if p_value is null or p_value < 0 then raise exception 'Type the new figure'; end if;
  r := te_rule(c.grade);

  if p_kind = 'ride' then
    select x.* into rd from te_rides x join te_days d on d.id = x.day_id where x.id = p_item and d.claim_id = p_claim;
    if rd.id is null then raise exception 'That ride is not on this claim'; end if;
    select day into day_of from te_days where id = rd.day_id;
    lbl := initcap(rd.mode) || ' ' || split_part(coalesce(rd.from_name, '—'), ',', 1) || ' → ' || split_part(coalesce(rd.to_name, '—'), ',', 1);
    old_a := rd.amount;
    if rd.mode in ('bike', 'car') then
      u := 'km'; old_v := rd.claimed_km;
      new_a := round(p_value * case when rd.mode = 'bike' then coalesce(r.bike_rate, 5) else coalesce(r.car_rate, 11) end, 2);
      if old_v is not distinct from p_value then return; end if;
      update te_rides set claimed_km = p_value, amount = new_a where id = p_item;
    else
      old_v := rd.fare; new_a := p_value;
      if old_v is not distinct from p_value then return; end if;
      update te_rides set fare = p_value, amount = p_value where id = p_item;
    end if;
  elsif p_kind = 'hotel' then
    select h.amount, d.day, 'Hotel' || coalesce(' ' || nullif(trim(h.name), ''), '') into old_v, day_of, lbl
    from te_hotels h join te_days d on d.id = h.day_id where h.id = p_item and d.claim_id = p_claim;
    if day_of is null then raise exception 'That hotel night is not on this claim'; end if;
    if old_v is not distinct from p_value then return; end if;
    old_a := old_v; new_a := p_value;
    update te_hotels set amount = p_value where id = p_item;
  elsif p_kind = 'expense' then
    select x.amount, d.day, x.category || coalesce(' · ' || nullif(trim(x.description), ''), '') into old_v, day_of, lbl
    from te_expenses x join te_days d on d.id = x.day_id where x.id = p_item and d.claim_id = p_claim;
    if day_of is null then raise exception 'That expense is not on this claim'; end if;
    if old_v is not distinct from p_value then return; end if;
    old_a := old_v; new_a := p_value;
    update te_expenses set amount = p_value where id = p_item;
  elsif p_kind = 'da' then
    select da_amount, day, 'DA' into old_v, day_of, lbl from te_days where id = p_item and claim_id = p_claim;
    if day_of is null then raise exception 'That day is not on this claim'; end if;
    if old_v is not distinct from p_value then return; end if;
    old_a := old_v; new_a := p_value;
    update te_days set da_amount = p_value where id = p_item;
  else
    raise exception 'Nothing to change there';
  end if;

  insert into te_adjustments (claim_id, item_kind, item_id, label, unit, old_value, new_value, old_amount, new_amount, reason, by_id)
  values (p_claim, p_kind, p_item, lbl, u, old_v, p_value, old_a, new_a, trim(p_reason), me);
  fmt_old := case when u = 'km' then rtrim(rtrim(to_char(coalesce(old_v, 0), 'FM999990.0'), '0'), '.') || ' km (₹' || trim(to_char(coalesce(old_a, 0), 'FM999,999,990')) || ')'
                  else '₹' || trim(to_char(coalesce(old_v, 0), 'FM999,999,990')) end;
  fmt_new := case when u = 'km' then rtrim(rtrim(to_char(p_value, 'FM999990.0'), '0'), '.') || ' km (₹' || trim(to_char(new_a, 'FM999,999,990')) || ')'
                  else '₹' || trim(to_char(p_value, 'FM999,999,990')) end;
  insert into te_events (claim_id, actor_id, action, note)
  values (p_claim, me, 'adjusted', to_char(day_of, 'FMDD Mon') || ' · ' || lbl || ': ' || fmt_old || ' → ' || fmt_new || E'\n' || trim(p_reason));
  update te_claims set updated_at = now() where id = p_claim;
end $function$;

CREATE OR REPLACE FUNCTION public.te_tell()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c te_claims; e employees; who text; role text; num text; says text;
begin
  if new.action not in ('returned', 'adjusted') then return new; end if;
  select * into c from te_claims where id = new.claim_id;
  select * into e from employees where id = c.employee_id;
  num := coalesce(c.number, to_char(c.month, 'Mon-YY') || ' claim');
  who := coalesce((select split_part(full_name, ' ', 1) from employees where id = new.actor_id), 'Someone');
  role := case when new.actor_id = e.reporting_manager_id then 'manager'
               when te_claim_coordinator(c.id) = new.actor_id or c.coordinator_id = new.actor_id then 'coordinator'
               when exists (select 1 from user_roles u where u.employee_id = new.actor_id and u.role = 'travel_desk') then 'Travel Desk'
               else 'admin' end;
  says := who || ' (' || role || '): ' || replace(coalesce(new.note, ''), E'\n', ' — ');
  if new.action = 'returned' then
    perform te_notify(c.id, c.employee_id, num || ' sent back to you', says, new.actor_id);
    if new.actor_id is distinct from e.reporting_manager_id then
      perform te_notify(c.id, e.reporting_manager_id, split_part(e.full_name, ' ', 1) || '''s ' || num || ' sent back', says, new.actor_id);
    end if;
  else
    perform te_notify(c.id, c.employee_id, num || ': an amount was changed', says, new.actor_id);
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.te_summary(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := current_employee_id(); g text; r te_grade_rules;
begin
  if not travel_has_access() then raise exception 'Travel Expense is not open to you yet'; end if;
  select grade into g from employees where id = me;
  r := te_rule(g);
  return jsonb_build_object(
    'mine', (
      with d as (
        select d.id, d.claim_id, c.status,
          coalesce((select sum(x.amount) from te_rides x where x.day_id = d.id), 0) as travel,
          d.da_amount as da,
          coalesce((select sum(x.amount) from te_hotels x where x.day_id = d.id), 0) as hotel,
          coalesce((select sum(x.amount) from te_expenses x where x.day_id = d.id), 0) as other
        from te_days d join te_claims c on c.id = d.claim_id
        where c.employee_id = me and c.status <> 'draft'
          and (p_from is null or d.day >= p_from) and (p_to is null or d.day <= p_to)
      ), t as (select *, travel + da + hotel + other as total from d)
      select jsonb_build_object(
        'claimed', coalesce(sum(total), 0),
        'sent_back', coalesce(sum(total) filter (where status in ('returned', 'recalled')), 0),
        'pending', coalesce(sum(total) filter (where status in ('with_manager', 'with_coordinator', 'with_desk')), 0),
        'approved', coalesce(sum(total) filter (where status = 'approved'), 0),
        'paid', coalesce(sum(total) filter (where status = 'paid'), 0),
        'claims', count(distinct claim_id),
        'travel', coalesce(sum(travel), 0), 'da', coalesce(sum(da), 0), 'hotel', coalesce(sum(hotel), 0), 'other', coalesce(sum(other), 0),
        'days', count(*),
        'tickets', (select count(distinct k.ticket_no) from te_tickets k where k.day_id in (select id from t)),
        'km', (select coalesce(sum(case when x.mode in ('bike', 'car') then coalesce(x.claimed_km, x.map_km) else x.map_km end), 0) from te_rides x where x.day_id in (select id from t)),
        'bike_km', (select coalesce(sum(x.claimed_km), 0) from te_rides x where x.day_id in (select id from t) and x.mode = 'bike'),
        'car_km', (select coalesce(sum(x.claimed_km), 0) from te_rides x where x.day_id in (select id from t) and x.mode = 'car'),
        'auto', (select coalesce(sum(x.fare), 0) from te_rides x where x.day_id in (select id from t) and x.mode = 'auto'),
        'phone', (select coalesce(sum(x.amount), 0) from te_expenses x where x.day_id in (select id from t) and x.category = 'Phone'))
      from t),
    'limits', jsonb_build_object('grade', g, 'bike_km', r.bike_km_month, 'car_km', r.car_km_month,
      'auto', (te_pol('auto_month'))::text::numeric, 'phone', (te_pol('phone_month'))::text::numeric),
    'scope', case when te_is_admin() or te_is_desk() then 'all' else 'team' end,
    'team', coalesce((
      select jsonb_agg(p order by p->>'name') from (
        select jsonb_build_object('ecode', e.ecode, 'name', e.full_name,
          'claims', count(distinct c.id),
          'claimed', sum(v.total),
          'pending', coalesce(sum(v.total) filter (where c.status in ('with_manager', 'with_coordinator', 'with_desk')), 0),
          'approved', coalesce(sum(v.total) filter (where c.status = 'approved'), 0),
          'paid', coalesce(sum(v.total) filter (where c.status = 'paid'), 0),
          'waiting', count(distinct c.id) filter (where (c.status = 'with_manager' and e.reporting_manager_id = me)
              or (c.status = 'with_coordinator' and te_claim_coordinator(c.id) = me)
              or (c.status = 'with_desk' and te_is_desk()))) p
        from te_days d
        join te_claims c on c.id = d.claim_id
        join employees e on e.id = c.employee_id
        cross join lateral (select coalesce((select sum(x.amount) from te_rides x where x.day_id = d.id), 0) + d.da_amount
            + coalesce((select sum(x.amount) from te_hotels x where x.day_id = d.id), 0)
            + coalesce((select sum(x.amount) from te_expenses x where x.day_id = d.id), 0) as total) v
        where c.employee_id <> me and c.status <> 'draft' and te_can_see(c.id)
          and (p_from is null or d.day >= p_from) and (p_to is null or d.day <= p_to)
        group by e.id, e.ecode, e.full_name) s), '[]'));
end $function$;

/*
  Set or clear a cost centre's coordinator. Set to somebody else, what waited on the one before goes to the new
  one; cleared, on to the Travel Desk (the user, 18 Oct, for a removed coordinator).
*/
create or replace function public.te_set_cost_centre_coordinator(p_cost_centre text, p_coordinator text)
returns void language plpgsql security definer set search_path = public as $$
declare k uuid; cc text;
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  select min(btrim(function_name)) into cc from employees where is_active and lower(btrim(function_name)) = lower(btrim(coalesce(p_cost_centre, '')));
  if cc is null then
    select cost_centre into cc from te_cost_centre_coordinators where lower(cost_centre) = lower(btrim(coalesce(p_cost_centre, '')));
  end if;
  if cc is null then raise exception 'Choose the cost centre'; end if;
  if coalesce(btrim(p_coordinator), '') = '' then
    delete from te_cost_centre_coordinators where lower(cost_centre) = lower(cc);
  else
    select id into k from employees where ecode = upper(btrim(p_coordinator)) and is_active;
    if k is null then raise exception 'No one with the code %', upper(btrim(p_coordinator)); end if;
    insert into te_cost_centre_coordinators (cost_centre, coordinator_id, set_by) values (cc, k, current_employee_id())
    on conflict (cost_centre) do update set coordinator_id = excluded.coordinator_id, set_by = excluded.set_by, set_at = now();
  end if;
  perform set_config('te.why', 'coordinator_removed', true);
  update te_claims set status = 'with_desk', updated_at = now() where status = 'with_coordinator' and te_claim_coordinator(id) is null;
  perform set_config('te.why', '', true);
end $$;

drop function if exists public.te_set_coordinator(text, text);
do $$ begin
  if exists (select 1 from public.te_coordinators) then raise exception 'te_coordinators has rows — move them to projects first'; end if;
end $$;
drop table if exists public.te_coordinators;

/*
  Purposes renamed in place (the user, 24 Oct: "need edit option"): the new name reaches every day and ride that
  carries the old one, so a rename is the same purpose, renamed. Two of one name are refused, and a breakdown
  purpose keeps the word (its rides ask for the ticket ID by it).
*/
create or replace function public.te_set_purpose(p_id int, p_label text, p_gives_da boolean, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare old text; lbl text := btrim(coalesce(p_label, ''));
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  if lbl = '' then raise exception 'Type the purpose'; end if;
  if exists (select 1 from te_purposes where lower(label) = lower(lbl) and id is distinct from p_id) then raise exception 'There is a purpose "%" already', lbl; end if;
  if p_id is null then
    insert into te_purposes (label, gives_da, sort) values (lbl, p_gives_da, (select coalesce(max(sort), 0) + 1 from te_purposes));
    return;
  end if;
  select label into old from te_purposes where id = p_id;
  if old is null then raise exception 'That purpose is not there any more'; end if;
  if old ~* 'breakdown' and lbl !~* 'breakdown' then raise exception 'Keep "breakdown" in the name — its rides ask for the ticket ID by it'; end if;
  update te_purposes set label = lbl, gives_da = p_gives_da, is_active = p_active where id = p_id;
  if old <> lbl then
    update te_days set purpose = lbl where purpose = old;
    update te_rides set purpose = lbl where purpose = old;
  end if;
end $$;

/*
  Projects are the functions people are mapped to (the user, 24 Oct: "add all functions here in db and in use
  button, no edit needed"). The five set by hand take their function's name, on every claim and ride too; every
  function is added, in use, in A–Z order; a function that appears later is in the list on its own, in use until
  it is unticked.
*/
update te_claims c set project = o.fn
from (values ('Care 360 (PVT BEMMP)', 'Care360'), ('KL BEMMP', 'KLBEMP'), ('AP BEMMP', 'APBEMP'), ('UP BEMMP', 'UPBEMP'), ('RJ BEMMP', 'RJBEMP')) o(old, fn)
where c.project = o.old;
update te_rides r set project = o.fn
from (values ('Care 360 (PVT BEMMP)', 'Care360'), ('KL BEMMP', 'KLBEMP'), ('AP BEMMP', 'APBEMP'), ('UP BEMMP', 'UPBEMP'), ('RJ BEMMP', 'RJBEMP')) o(old, fn)
where r.project = o.old;
update te_projects p set label = o.fn
from (values ('Care 360 (PVT BEMMP)', 'Care360'), ('KL BEMMP', 'KLBEMP'), ('AP BEMMP', 'APBEMP'), ('UP BEMMP', 'UPBEMP'), ('RJ BEMMP', 'RJBEMP')) o(old, fn)
where p.label = o.old and not exists (select 1 from te_projects q where lower(q.label) = lower(o.fn));
insert into te_projects (label, sort)
select n.name, 0 from (select min(btrim(function_name)) as name from employees
                       where is_active and nullif(btrim(function_name), '') is not null group by lower(btrim(function_name))) n
where not exists (select 1 from te_projects p where lower(p.label) = lower(n.name));
update te_projects set sort = 0;

/* The projects, and the functions not yet among them (in use). */
create or replace function public.te_project_rows()
returns table (id int, label text, is_active boolean, sort int)
language sql stable security definer set search_path = public as $$
  select p.id, p.label, p.is_active, p.sort from te_projects p
  union all
  select null::int, f.name, true, 0
  from (select min(btrim(function_name)) as name from employees
        where is_active and nullif(btrim(function_name), '') is not null group by lower(btrim(function_name))) f
  where not exists (select 1 from te_projects p where lower(p.label) = lower(f.name))
$$;

create or replace function public.te_projects()
returns table (label text) language sql stable security definer set search_path = public as $$
  select label from te_project_rows() where is_active and travel_has_access() order by sort, label
$$;

/* In use or not; a function not yet in the list is added with the tick given. Added by hand, too. */
create or replace function public.te_set_project(p_id int, p_label text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare lbl text := btrim(coalesce(p_label, ''));
begin
  if not te_is_admin() then raise exception 'Only SW Admin or ACC Admin'; end if;
  if p_id is not null then
    update te_projects set is_active = coalesce(p_active, true) where id = p_id;
    if not found then raise exception 'That project is not there any more'; end if;
    return;
  end if;
  if lbl = '' then raise exception 'Type the project name'; end if;
  if exists (select 1 from te_projects where lower(label) = lower(lbl)) then raise exception 'There is a project "%" already', lbl; end if;
  insert into te_projects (label, is_active, sort) values (lbl, coalesce(p_active, true), 0);
end $$;

revoke execute on function public.te_claim_coordinator(uuid), public.te_claim_advance(uuid), public.te_project_rows() from public, anon, authenticated;
revoke execute on function public.te_set_cost_centre_coordinator(text, text) from public, anon;
grant execute on function public.te_set_cost_centre_coordinator(text, text) to authenticated;

/*
  A new claim starts on the person's own cost centre (the user, 24 Oct: "on add claim, we need defaulty show his
  cost centre only"): their function, else the project they last chose (te_0030). An open draft without one gets
  it too; nobody's chosen project is replaced.
*/
create or replace function public.te_open_month(p_month date)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); m date := date_trunc('month', p_month)::date; cid uuid; e employees; last te_claims; nxt int; proj text;
begin
  if me is null or not travel_has_access() then raise exception 'Travel Expense has not been given to you yet'; end if;
  if m > date_trunc('month', current_date)::date then raise exception 'A future month cannot be claimed'; end if;
  select * into e from employees where id = me;
  proj := coalesce(nullif(btrim(coalesce(e.function_name, '')), ''),
    (select project from te_claims where employee_id = me and nullif(trim(project), '') is not null order by updated_at desc limit 1));
  -- The part still open to change, if there is one.
  select id into cid from te_claims where employee_id = me and month = m and status in ('draft', 'returned') order by part limit 1;
  if cid is not null then
    update te_claims set project = proj where id = cid and nullif(trim(project), '') is null and proj is not null;
    return cid;
  end if;
  select * into last from te_claims where employee_id = me order by month desc, part desc limit 1;
  select coalesce(max(part), 0) + 1 into nxt from te_claims where employee_id = me and month = m;
  insert into te_claims (employee_id, month, part, grade, designation, base_location, project, mobile)
  values (me, m, nxt, e.grade, e.designation, coalesce(last.base_location, e.location), proj, coalesce(last.mobile, e.official_phone))
  returning id into cid;
  return cid;
end $$;
