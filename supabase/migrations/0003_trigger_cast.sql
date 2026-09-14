-- Fix: enum cast in the new-user trigger (auth signups were failing with 500).
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
