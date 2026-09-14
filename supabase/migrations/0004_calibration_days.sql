-- Calibration = the first 14 days including signup day (day 15 the control is gone).
alter table public.users alter column calibration_ends_on set default (current_date + 13);
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
update public.users set calibration_ends_on = created_at::date + 13 where calibration_ends_on = created_at::date + 14;
