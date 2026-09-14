-- Blythe Workout — schema
-- Run with: supabase db push  (or the Management API query endpoint)

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- config
create table if not exists public.app_config (
  key text primary key,
  value text not null
);
alter table public.app_config enable row level security;
-- nobody reads config through the API; only SECURITY DEFINER functions.

-- ---------------------------------------------------------------- users
create type public.user_role as enum ('user', 'admin');
create type public.activity_level as enum (
  'sedentary', 'lightly_active', 'moderately_active', 'returning_lifter', 'trained'
);

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  delivery_email text,
  role public.user_role not null default 'user',
  height_cm numeric(5,1),
  weight_lb numeric(5,1),
  activity_level public.activity_level,
  calibration_ends_on date not null default (current_date + 13),
  onboarded_at timestamptz,
  burn_overlay boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.users enable row level security;

create policy "users read own row" on public.users
  for select to authenticated using (id = (select auth.uid()));
create policy "users update own row" on public.users
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Nobody promotes themselves: role only changes via the service role.
create or replace function public.protect_user_role()
returns trigger language plpgsql as $$
begin
  -- API users run as the `authenticated` role; the service role and SQL admins may change these.
  if current_user = 'authenticated' then
    new.role := old.role;
    new.email := old.email;
  end if;
  return new;
end;
$$;
create trigger users_protect_role before update on public.users
  for each row execute function public.protect_user_role();

-- Create the profile row when an auth user is created; admin if it matches app_config.admin_email.
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
  insert into public.users (id, email, role, calibration_ends_on)
  values (new.id, coalesce(new.email, ''), new_role, current_date + 13)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' from public.users where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------- exercises
create table if not exists public.exercises (
  id serial primary key,
  slug text not null unique,
  exercise_key text not null,
  name text not null,
  slot_day smallint not null check (slot_day between 1 and 5),
  order_index smallint not null check (order_index between 1 and 5),
  rest_seconds smallint not null,
  range_min smallint not null,
  range_max smallint not null,
  is_unilateral boolean not null default false,
  is_bodyweight boolean not null default false,
  category text not null,
  seed_weight numeric(4,1) not null default 0,
  seed_reps smallint not null default 8,
  variant_rule text,
  rep_unit text,
  unique (slot_day, order_index)
);
alter table public.exercises enable row level security;
create policy "exercises readable" on public.exercises for select to authenticated using (true);

-- ---------------------------------------------------------------- per-user lift state
create table if not exists public.user_exercise_state (
  user_id uuid not null references public.users (id) on delete cascade,
  exercise_key text not null,
  working_weight numeric(4,1) not null default 0,
  target_reps smallint not null default 8,
  consecutive_hits smallint not null default 0,
  consecutive_misses smallint not null default 0,
  note text,
  last_hit_weight numeric(4,1),
  last_hit_reps smallint,
  last_logged_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_key)
);
alter table public.user_exercise_state enable row level security;
create policy "state owner all" on public.user_exercise_state
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- sessions
create type public.session_status as enum ('in_progress', 'complete', 'abandoned');
create type public.email_status as enum ('pending', 'stitching', 'sent', 'failed');

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  session_date date not null,
  day_index smallint not null check (day_index between 1 and 5),
  day_number integer,
  status public.session_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  walk_done boolean not null default false,
  email_status public.email_status not null default 'pending',
  email_to text,
  email_error text,
  email_sent_at timestamptz,
  video_path text,
  video_bytes bigint,
  video_kind text, -- 'day' | 'zip' | 'clips'
  created_at timestamptz not null default now(),
  unique (user_id, session_date)
);
alter table public.sessions enable row level security;
create policy "sessions owner all" on public.sessions
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create index if not exists sessions_user_date on public.sessions (user_id, session_date desc);

-- Per-lift prescription snapshot for the day.
create type public.lift_status as enum ('pending', 'in_progress', 'completed', 'missed');

create table if not exists public.session_lifts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  exercise_id integer not null references public.exercises (id),
  exercise_key text not null,
  display_name text not null,
  order_index smallint not null,
  prescribed_weight numeric(4,1) not null,
  prescribed_reps smallint not null,
  rest_seconds smallint not null,
  note text,
  status public.lift_status not null default 'pending',
  progression_applied boolean not null default false,
  started_at timestamptz,
  finished_at timestamptz,
  unique (session_id, order_index)
);
alter table public.session_lifts enable row level security;
create policy "lifts owner all" on public.session_lifts
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create type public.set_kind as enum ('warmup', 'work');
create type public.set_result as enum ('pending', 'completed', 'missed');

create table if not exists public.session_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  lift_id uuid not null references public.session_lifts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  kind public.set_kind not null,
  set_number smallint not null,
  prescribed_weight numeric(4,1) not null,
  prescribed_reps smallint not null,
  actual_weight numeric(4,1),
  actual_reps smallint,
  result public.set_result not null default 'pending',
  logged_at timestamptz,
  unique (lift_id, kind, set_number)
);
alter table public.session_sets enable row level security;
create policy "sets owner all" on public.session_sets
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- clips
create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  lift_id uuid not null references public.session_lifts (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  exercise_key text not null,
  set_number smallint not null,
  storage_path text not null,
  mime text not null,
  bytes bigint,
  duration_ms integer,
  trimmed_ms integer not null default 0,
  created_at timestamptz not null default now(),
  unique (lift_id, set_number)
);
alter table public.clips enable row level security;
create policy "clips owner all" on public.clips
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- form videos (admin)
create table if not exists public.form_videos (
  exercise_key text primary key,
  storage_path text not null,
  mime text not null,
  bytes bigint,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id)
);
alter table public.form_videos enable row level security;
create policy "form videos readable" on public.form_videos for select to authenticated using (true);
create policy "form videos admin write" on public.form_videos
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- photos (optional)
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  storage_path text not null,
  taken_on date not null default current_date,
  created_at timestamptz not null default now()
);
alter table public.photos enable row level security;
create policy "photos owner all" on public.photos
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- storage buckets + policies
insert into storage.buckets (id, name, public, file_size_limit)
values ('form', 'form', false, null), ('sessions', 'sessions', false, null), ('photos', 'photos', false, null)
on conflict (id) do nothing;

-- form/{slug}.mp4 — everyone signed in can read, only admin writes.
create policy "form read" on storage.objects for select to authenticated using (bucket_id = 'form');
create policy "form admin insert" on storage.objects for insert to authenticated with check (bucket_id = 'form' and public.is_admin());
create policy "form admin update" on storage.objects for update to authenticated using (bucket_id = 'form' and public.is_admin());
create policy "form admin delete" on storage.objects for delete to authenticated using (bucket_id = 'form' and public.is_admin());

-- sessions/{user}/{date}/{exercise}.mp4 — owner only.
create policy "sessions read own" on storage.objects for select to authenticated
  using (bucket_id = 'sessions' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "sessions insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'sessions' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "sessions update own" on storage.objects for update to authenticated
  using (bucket_id = 'sessions' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "sessions delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'sessions' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- photos/{user}/... — owner only.
create policy "photos read own" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------- helpers
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger users_touch before update on public.users for each row execute function public.touch_updated_at();
create trigger state_touch before update on public.user_exercise_state for each row execute function public.touch_updated_at();

-- Delete own account (auth row cascades to everything).
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
