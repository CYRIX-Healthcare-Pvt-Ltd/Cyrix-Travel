/*
  te_0118 — Live: a claim sent again after a recall or a send-back counts once (the user, 4 Nov: "why if recalled and
  sent is counted as 2?"). Sent a claim, With manager and With Travel Desk all go by the claim's latest send.
*/
do $$
declare f text; n int;
  a1 text := $q$where ev.action in ('submitted', 'resubmitted', 'manager_approved')$q$;
  w0 text := $q$ and exists (select 1 from te_events ev where ev.claim_id = c.id and ev.action in ('submitted', 'resubmitted') and ev.at >= s and ev.at < e))$q$;
  last text := $q$(select max(l.at) from te_events l where l.claim_id = c.id and l.action in ('submitted', 'resubmitted'))$q$;
begin
  f := pg_get_functiondef('public.te_usage(date, date)'::regprocedure);
  n := (length(f) - length(replace(f, w0, ''))) / length(w0);
  if position(a1 in f) = 0 or n <> 4 then raise exception 'te_usage changed (%)', n; end if;
  f := replace(f, a1, a1 || $q$ and (ev.action = 'manager_approved' or ev.at = $q$ || replace(last, 'c.id', 'ev.claim_id') || ')');
  f := replace(f, w0, ' and ' || last || ' >= s and ' || last || ' < e)');
  execute f;
end $$;
