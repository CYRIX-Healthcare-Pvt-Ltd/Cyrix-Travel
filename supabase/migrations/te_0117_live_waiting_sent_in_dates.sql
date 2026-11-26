/*
  te_0117 — Live: With manager and With Travel Desk count only claims sent within the chosen dates (the user, 4 Nov:
  "with manager 10, and trav 1, so 11, here sent a claim is 6?" — "count only claims sent within the chosen dates").
*/
do $$
declare f text; n int;
  w1 text := $q$where c.status = 'with_desk')$q$;
  w2 text := $q$where c.status = 'with_manager')$q$;
  sent text := $q$ and exists (select 1 from te_events ev where ev.claim_id = c.id and ev.action in ('submitted', 'resubmitted') and ev.at >= s and ev.at < e))$q$;
begin
  f := pg_get_functiondef('public.te_usage(date, date)'::regprocedure);
  n := (length(f) - length(replace(f, w1, ''))) / length(w1) + (length(f) - length(replace(f, w2, ''))) / length(w2);
  if n <> 4 then raise exception 'te_usage changed (%)', n; end if;
  f := replace(replace(f, w1, left(w1, -1) || sent), w2, left(w2, -1) || sent);
  execute f;
end $$;
