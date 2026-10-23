-- Travel Expense · te_0061 · the days already claimed
-- One claim a day (te_0060; the user, 23 Oct: "if I submitted a claim today, then today's date should be marked"):
-- every date the person has in a claim, and which, for the calendars to mark and refuse.
create or replace function public.te_my_claimed_days()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'claim', k.id,
           'name', coalesce(k.number, to_char(k.month, 'FMMon') || ' draft')) order by d.day), '[]'::jsonb)
    from te_days d join te_claims k on k.id = d.claim_id
   where k.employee_id = current_employee_id()
$function$;
revoke all on function public.te_my_claimed_days() from public, anon;
grant execute on function public.te_my_claimed_days() to authenticated;
