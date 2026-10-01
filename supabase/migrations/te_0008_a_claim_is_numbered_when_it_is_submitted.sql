/*
  te_0008 — a claim gets its number when it is submitted.

  A trip took the next TE number the moment Start was pressed. A trip
  started by mistake and cancelled, or a test, took one with it, and the
  register of claims had holes in it for trips that were never claims (the
  user, 1 Oct: "if first eng cancels so what will happen to te-05? will that
  te skipped?" — it was — then "give te number at submission").

  A trip now has no number while it is on the road or waiting to be sent.
  Submitting it gives it the next one, and that number is the claim's from
  then on: a claim sent back and submitted again keeps the number it has.
  So the numbers run in the order claims were submitted, and the only way to
  leave a gap is to delete a claim that was already submitted, which is the
  software administrator's alone and is written to the audit log.

  travel_submit now returns the claim's code, so the app can show it at the
  moment it is given. Its return type changes, so it is dropped and made
  again; who may call it is restated.

  Trips there are now that were never submitted lose the number they took at
  Start, and the counter goes back to follow the highest number still held —
  so the first claim submitted is not numbered after a run of tests.
*/
alter table public.travel_trips alter column number drop default;
alter table public.travel_trips alter column number drop not null;

update public.travel_trips set number = null where submitted_at is null;

-- The next number is one more than the highest still held, or 1 if none is.
select setval('public.travel_trip_number', coalesce((select max(number) from public.travel_trips), 0) + 1, false);

drop function public.travel_submit(uuid);

create function public.travel_submit(p_trip_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $fn$
declare
  t travel_trips := travel_lock(p_trip_id);
  c text;
begin
  if t.employee_id is distinct from current_employee_id() then raise exception 'This is not your trip'; end if;
  if t.ended_at is null then raise exception 'End the trip before submitting it'; end if;
  if t.status not in ('open', 'returned') then raise exception 'This claim has already been submitted'; end if;
  -- Numbered here, once: a claim sent back and submitted again keeps the number it was given the first time.
  update travel_trips
     set status = 'submitted', submitted_at = now(), decided_by = null, decided_at = null,
         number = coalesce(number, nextval('public.travel_trip_number'))
   where id = t.id
  returning code into c;
  return c;
end $fn$;

revoke all on function public.travel_submit(uuid) from public, anon;
grant execute on function public.travel_submit(uuid) to authenticated, service_role;
