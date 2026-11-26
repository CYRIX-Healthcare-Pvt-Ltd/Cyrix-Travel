-- =====================================================================
-- Travel  ·  te_0174  ·  Auto can go over the monthly limit, with a reason
--
-- The user, 26 Nov: "it can go after 1000, but each should be in red obs, ie auto limit exceeded, and if auto
-- limit is above 1000 need reason". Replaces te_0167's refusal. The month's auto fares are counted in order: the
-- other parts of the month first, then this claim by day and ride. The ride that takes the total past auto_month
-- (₹1,000, SW Admin → Allowances) and every auto ride after it need their Remarks filled; the claim page shows
-- each in red as "Auto limit exceeded". Checked at the end of the save, as before.
-- =====================================================================

create or replace function public.te_auto_month_check() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_emp uuid; v_month date; v_claim uuid; v_total numeric; v_note text;
  v_cap numeric := coalesce((te_pol('auto_month'))::text::numeric, 0);
begin
  if v_cap <= 0 or new.mode <> 'auto' or coalesce(new.fare, 0) <= 0 then return null; end if;
  select cl.employee_id, cl.month, cl.id into v_emp, v_month, v_claim
  from te_days d join te_claims cl on cl.id = d.claim_id where d.id = new.day_id;
  if v_emp is null then return null; end if;
  -- The ride may have been replaced later in the same save (te_save_day): check it as it is now.
  select x.note into v_note from te_rides x where x.id = new.id;
  if not found then return null; end if;
  select coalesce(sum(t.fare), 0) into v_total from (
    select x.fare, (cl.id = v_claim) as here, d.day, x.seq, x.id
    from te_rides x join te_days d on d.id = x.day_id join te_claims cl on cl.id = d.claim_id
    where cl.employee_id = v_emp and cl.month = v_month and x.mode = 'auto' and coalesce(x.fare, 0) > 0
  ) t
  join (select d.day, x.seq from te_rides x join te_days d on d.id = x.day_id where x.id = new.id) me on true
  where not t.here or (t.day, t.seq) <= (me.day, me.seq);
  if v_total > v_cap and coalesce(btrim(v_note), '') = '' then
    raise exception 'Auto goes over ₹% this month (₹%). Write why in the ride''s Remarks.', to_char(round(v_cap), 'FM99,99,99,999'), to_char(round(v_total), 'FM99,99,99,999');
  end if;
  return null;
end $$;

drop trigger if exists te_rides_auto_month on public.te_rides;
create constraint trigger te_rides_auto_month after insert or update of fare, mode, day_id, note on public.te_rides
  deferrable initially deferred for each row execute function public.te_auto_month_check();

revoke all on function public.te_auto_month_check() from public, anon, authenticated;
