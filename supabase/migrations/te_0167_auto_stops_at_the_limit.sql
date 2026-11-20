-- =====================================================================
-- Travel  ·  te_0167  ·  Auto stops at the monthly limit
--
-- The user, 20 Nov: "auto max resp limit it should stop there, not even 1001". Until now going over auto_month
-- (₹1,000, SW Admin → Allowances) only showed "Over the monthly limit" to the approver. Now a save that takes the
-- person's auto fares for the month (every part of it) over the limit is refused. Checked at the end of the save,
-- so te_save_day replacing a day's rides counts the final rides only. Claims already over it stay as they are
-- until that month's auto rides are saved again.
-- =====================================================================

create or replace function public.te_auto_month_check() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_emp uuid; v_month date; v_total numeric; v_cap numeric := coalesce((te_pol('auto_month'))::text::numeric, 0);
begin
  if v_cap <= 0 or new.mode <> 'auto' or coalesce(new.fare, 0) <= 0 then return null; end if;
  select cl.employee_id, cl.month into v_emp, v_month
  from te_days d join te_claims cl on cl.id = d.claim_id where d.id = new.day_id;
  if v_emp is null then return null; end if;
  select coalesce(sum(x.fare), 0) into v_total
  from te_rides x join te_days d on d.id = x.day_id join te_claims cl on cl.id = d.claim_id
  where cl.employee_id = v_emp and cl.month = v_month and x.mode = 'auto';
  if v_total > v_cap then
    raise exception 'Auto is up to ₹% a month. This month comes to ₹%.', to_char(round(v_cap), 'FM99,99,99,999'), to_char(round(v_total), 'FM99,99,99,999');
  end if;
  return null;
end $$;

drop trigger if exists te_rides_auto_month on public.te_rides;
create constraint trigger te_rides_auto_month after insert or update of fare, mode, day_id on public.te_rides
  deferrable initially deferred for each row execute function public.te_auto_month_check();

revoke all on function public.te_auto_month_check() from public, anon, authenticated;
