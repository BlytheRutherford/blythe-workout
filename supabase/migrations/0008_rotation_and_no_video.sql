-- Five-workout rotation (not tied to weekdays), weight changes on any set,
-- and no more set videos or lift emails.

-- Workouts before this date don't count toward the rotation or the week.
-- Set when a lifter's exercises are reset without wiping their history.
alter table public.users add column if not exists program_start_on date;

-- Recording is gone, so nobody records any more. The columns stay (old rows
-- still have them) but nothing reads them.
update public.users set records_video = false where records_video;

-- New accounts never record.
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
  values (new.id, coalesce(new.email, ''), new_role, current_date + 13, false)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- "Reset all exercises" wipes history too, so the rotation restarts at Day 1 on its own.
create or replace function public.reset_own_progress()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.sessions where user_id = auth.uid();
  delete from public.user_exercise_state where user_id = auth.uid();
  update public.users set program_start_on = null where id = auth.uid();
end;
$$;
revoke all on function public.reset_own_progress() from public;
grant execute on function public.reset_own_progress() to authenticated;
