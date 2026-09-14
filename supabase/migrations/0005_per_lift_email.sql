-- Per-exercise videos + emails ("Day N: Dumbbell incline press"), skip-rest tracking,
-- video-only capture flags, and recording restricted to accounts with records_video.

alter table public.session_lifts
  add column if not exists video_path text,
  add column if not exists video_bytes bigint,
  add column if not exists video_kind text,               -- 'lift' | 'zip' | 'clips' | 'none'
  add column if not exists email_status public.email_status not null default 'pending',
  add column if not exists email_to text,
  add column if not exists email_error text,
  add column if not exists email_sent_at timestamptz;

alter table public.session_sets
  add column if not exists has_clip boolean not null default false,
  add column if not exists rest_skipped boolean not null default false;

alter table public.users
  add column if not exists records_video boolean not null default false,
  add column if not exists record_audio boolean not null default false;

-- The admin records; everyone else just logs.
update public.users set records_video = true where role = 'admin';

-- New admins get recording automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_email text;
  new_role public.user_role := 'user';
begin
  select value into admin_email from public.app_config where key = 'admin_email';
  if admin_email is not null and lower(new.email) = lower(admin_email) then
    new_role := 'admin';
  end if;
  insert into public.users (id, email, role, calibration_ends_on, records_video)
  values (new.id, coalesce(new.email, ''), new_role, current_date + 13, new_role = 'admin')
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Users must not flip records_video themselves (it drives storage + email cost); the service role may.
create or replace function public.protect_user_role()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then
    new.role := old.role;
    new.email := old.email;
    new.records_video := old.records_video;
  end if;
  return new;
end;
$$;

-- Wipe a user's own progress (sessions cascade to lifts/sets/clips) and restart at Day 1.
create or replace function public.reset_own_progress()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.sessions where user_id = auth.uid();
  delete from public.user_exercise_state where user_id = auth.uid();
  update public.users set calibration_ends_on = current_date + 13 where id = auth.uid();
end;
$$;
revoke all on function public.reset_own_progress() from public;
grant execute on function public.reset_own_progress() to authenticated;
