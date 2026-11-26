/*
  te_0158 — Feedback from inside Travel, mainly by voice (management, 13 Nov: "give users option to give feedback in our
  app, so directly comes to sw admin, and mainly voice, so sw admin can hear and improve"; the user: "max 1 min", no AI).
  A 🎙️ in Travel's top bar records up to a minute (and/or a typed note) with the page it was on; SW Admin → Travel
  Expense → Feedback plays it and marks it Seen or Done, and Done tells the person in the Travel bell.
  Recordings sit in the private te-feedback bucket under the sender's employee id.
*/
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('te-feedback', 'te-feedback', false, 3145728,
        array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav'])
on conflict (id) do nothing;

create table if not exists public.te_feedback (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  page        text,
  note        text,
  audio_path  text,
  seconds     int,
  device      text,
  status      text not null default 'new' check (status in ('new', 'seen', 'done')),
  created_at  timestamptz not null default now(),
  seen_at     timestamptz,
  done_at     timestamptz,
  done_by     uuid references employees(id),
  check (coalesce(btrim(note), '') <> '' or audio_path is not null)
);
create index if not exists te_feedback_created on public.te_feedback (created_at desc);
alter table public.te_feedback enable row level security;
drop policy if exists te_feedback_read on public.te_feedback;
create policy te_feedback_read on public.te_feedback for select to authenticated
  using (employee_id = current_employee_id() or is_sw_admin());

-- The recording goes in under the sender's own id; SW Admin (and the sender) can play it.
drop policy if exists te_feedback_put on storage.objects;
create policy te_feedback_put on storage.objects for insert to authenticated
  with check (bucket_id = 'te-feedback' and (storage.foldername(name))[1] = current_employee_id()::text);
drop policy if exists te_feedback_get on storage.objects;
create policy te_feedback_get on storage.objects for select to authenticated
  using (bucket_id = 'te-feedback' and ((storage.foldername(name))[1] = current_employee_id()::text or is_sw_admin()));

create or replace function public.te_feedback_add(p_page text, p_note text, p_audio text, p_seconds int, p_device text)
returns uuid language plpgsql security definer set search_path to 'public' as $f$
declare me uuid := current_employee_id(); fid uuid;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_audio is not null and split_part(p_audio, '/', 1) <> me::text then raise exception 'That recording is not yours'; end if;
  if coalesce(btrim(p_note), '') = '' and p_audio is null then raise exception 'Record or type something first'; end if;
  if (select count(*) from te_feedback where employee_id = me and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Ten in an hour is the most — send again later';
  end if;
  insert into te_feedback (employee_id, page, note, audio_path, seconds, device)
  values (me, left(p_page, 200), nullif(left(btrim(p_note), 2000), ''), p_audio, least(greatest(coalesce(p_seconds, 0), 0), 60), left(p_device, 300))
  returning id into fid;
  return fid;
end $f$;
revoke all on function public.te_feedback_add(text, text, text, int, text) from public, anon;
grant execute on function public.te_feedback_add(text, text, text, int, text) to authenticated;

-- SW Admin's list: newest first, with who sent it.
create or replace function public.te_feedback_list()
returns table (id uuid, ecode text, name text, function_name text, page text, note text, audio_path text, seconds int,
               device text, status text, created_at timestamptz, done_at timestamptz, done_by text)
language plpgsql stable security definer set search_path to 'public' as $f$
begin
  if not is_sw_admin() then raise exception 'Only SW Admin'; end if;
  return query
  select f.id, e.ecode, e.full_name, e.function_name, f.page, f.note, f.audio_path, f.seconds, f.device, f.status,
         f.created_at, f.done_at, d.full_name || ' (' || d.ecode || ')'
    from te_feedback f join employees e on e.id = f.employee_id left join employees d on d.id = f.done_by
   order by f.created_at desc;
end $f$;
revoke all on function public.te_feedback_list() from public, anon;
grant execute on function public.te_feedback_list() to authenticated;

-- Seen or Done; Done tells the person in the Travel bell and on the phone.
create or replace function public.te_feedback_set(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path to 'public' as $f$
declare f te_feedback; me uuid := current_employee_id(); mid uuid;
begin
  if not is_sw_admin() then raise exception 'Only SW Admin'; end if;
  if p_status not in ('new', 'seen', 'done') then raise exception 'New, Seen or Done'; end if;
  select * into f from te_feedback where id = p_id for update;
  if not found then raise exception 'That feedback is gone'; end if;
  update te_feedback set status = p_status,
         seen_at = case when p_status <> 'new' then coalesce(seen_at, now()) end,
         done_at = case when p_status = 'done' then coalesce(done_at, now()) end,
         done_by = case when p_status = 'done' then coalesce(done_by, me) end
   where id = p_id;
  if p_status = 'done' and f.status <> 'done' then
    insert into push_messages (kind, title, body, url, target, sent_by, dedupe_key)
    values ('travel', 'Your feedback is done ✅',
            'Thank you, ' || split_part((select full_name from employees where id = f.employee_id), ' ', 1)
              || '. We heard your feedback on Travel of ' || to_char(f.created_at at time zone 'Asia/Kolkata', 'DD Mon') || ' and acted on it.',
            '/travel/', jsonb_build_object('kind', 'travel_feedback', 'feedback', f.id), me, 'te-feedback-done:' || f.id)
    on conflict (dedupe_key) do nothing
    returning id into mid;
    if mid is not null then
      insert into push_inbox (message_id, employee_id) values (mid, f.employee_id);
      update push_messages set people = 1 where id = mid;
      perform push_call('queued');
    end if;
  end if;
end $f$;
revoke all on function public.te_feedback_set(uuid, text) from public, anon;
grant execute on function public.te_feedback_set(uuid, text) to authenticated;
