/*
  te_0124 — The day's last ride that goes somewhere counts as its last ride: an empty ride added after the ride home does
  not make that ride home need a photo (the user, 4 Nov: Alfin Anto's MIT → Home, "after mit it is end my day isnt?").
*/
do $$
declare f text; fn text;
begin
  foreach fn in array array['public.te_rides_without_photo(uuid)', 'public.te_submit(uuid)'] loop
    f := pg_get_functiondef(fn::regprocedure);
    if position('y.seq > x.seq)' in f) = 0 and position('y.seq > r.seq)' in f) = 0 then raise exception '% changed', fn; end if;
    f := replace(replace(f, 'y.seq > x.seq)', 'y.seq > x.seq and y.to_lat is not null)'), 'y.seq > r.seq)', 'y.seq > r.seq and y.to_lat is not null)');
    execute f;
  end loop;
end $$;
