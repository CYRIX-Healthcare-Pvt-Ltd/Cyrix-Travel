/*
  te_0161 — Google's road lookups counted, for SW Admin's Live tab (the user, 18 Nov: "can you add, used clicks?").
  Each From–To asked of Google is one billed request (choosing a road or opening the map asks nothing more), and the
  page notes it here as it asks. Every request is counted, test logins too: it is the Google bill, not usage.
*/
create table if not exists public.te_google_calls (
  id bigint generated always as identity primary key,
  employee_id uuid references public.employees(id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists te_google_calls_at on public.te_google_calls (at);
alter table public.te_google_calls enable row level security;
revoke all on public.te_google_calls from anon, authenticated;

create or replace function public.te_google_call()
returns void language sql security definer set search_path = public as $$
  insert into te_google_calls (employee_id) values (current_employee_id());
$$;
revoke all on function public.te_google_call() from public, anon;
grant execute on function public.te_google_call() to authenticated;

do $$
declare f text;
  a2 text := $q$'at', now())$q$;
begin
  f := pg_get_functiondef('public.te_usage(date, date)'::regprocedure);
  if position(a2 in f) = 0 then raise exception 'te_usage changed'; end if;
  f := replace(f, a2, $q$'google', (select count(*) from te_google_calls g where g.at >= s and g.at < e),
    'google_month', (select count(*) from te_google_calls g where g.at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'),
    'at', now())$q$);
  execute f;
end $$;
