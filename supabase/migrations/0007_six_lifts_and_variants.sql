-- Six lifts a day (was five), and per-lift variant chains so progression
-- continues past the 52.5 lb dumbbell ceiling.

-- 1. Six slots per day, and retired slots can park outside the grid.
alter table public.exercises drop constraint if exists exercises_order_index_check;
alter table public.exercises add constraint exercises_order_index_check check (order_index between 1 and 8);
alter table public.exercises alter column slot_day drop not null;
alter table public.exercises alter column order_index drop not null;

-- 2. Reordering a day in one statement transiently duplicates (slot_day, order_index).
alter table public.exercises drop constraint if exists exercises_slot_day_order_index_key;
alter table public.exercises
  add constraint exercises_slot_day_order_index_key unique (slot_day, order_index) deferrable initially deferred;

-- 3. Which rung of the variant ladder the lifter is on.
alter table public.user_exercise_state add column if not exists variant_index smallint not null default 0;
alter table public.session_lifts add column if not exists variant_index smallint not null default 0;
