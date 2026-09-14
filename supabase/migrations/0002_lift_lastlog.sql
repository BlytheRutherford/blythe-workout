-- Snapshot of the previous log for the live-screen caption ("last log 40 × 8").
alter table public.session_lifts
  add column if not exists last_weight numeric(4,1),
  add column if not exists last_reps smallint;
