/*
  te_0068 — a second advance in the same month while the first is still being used (the user, 24 Oct: "why,
  after approval, for next advance why not showing? ie 2 per month is possible isn?"). Rule 5 (te_0063) stopped
  any request while an advance had a balance, and a month's claim is sent after the month, so the second of
  the month's two could never be asked for.

  Rule 5 now reads by the month: a new month's advance waits until every earlier month's is settled, while
  within a month the two advances and ₹20,000 of rule 4 are the limit. A request still waiting for approval
  stops another, as before.
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
    where v.employee_id = p_employee and v.status = 'given' and v.month < m order by v.month, v.desk_at
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
