# Blythe Workout

iPhone-first PWA at **https://blytheworkout.com**. Six dumbbell lifts per workout, five workouts in a fixed rotation (Day 1 → Day 5, then back to Day 1), aiming for five in each Monday–Sunday week. The same program for everyone; only starting weights differ.

Stack: Next.js 16 (App Router, TypeScript, Tailwind v4), Supabase (auth + Postgres + Storage for form videos), Vercel (hosting, deploys automatically from `main` on GitHub). Red-sky design: ink `#070709`, umber `#4B2D2E`, rust `#824334`, ember `#F42C1D`, crimson `#AE1918`, oxblood `#701C1A`, plus bone `#F3EAE6` for text. Big Shoulders for headings and numbers, Instrument Sans for everything else.

## Where things live

| Thing | Where |
|---|---|
| Production | Vercel project `blythe-workout`, connected to GitHub `BlytheRutherford/blythe-workout` — every push to `main` deploys. Domains `blytheworkout.com` + `www` (308 → apex) |
| Database / auth / storage | Supabase project `blythe-workout` (us-east-1, Free plan) |
| Program definition | `lib/engine/program.ts` (single source of truth; `npm run gen:seed` writes `supabase/seed.sql`) |
| Progression engine | `lib/engine/progression.ts`, tests in `tests/engine.test.ts` (`npm test`) |

## Environment

Set in Vercel (Production + Preview) and `.env.local` for development:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=        # the sb_publishable_… key works here too
SUPABASE_SERVICE_ROLE_KEY=            # the sb_secret_… key works here too
ADMIN_EMAIL=you@example.com
NEXT_PUBLIC_SITE_URL=https://blytheworkout.com
```

Older variables (`RESEND_API_KEY`, `EMAIL_FROM`, `EDGE_FUNCTION_SECRET`, `CRON_SECRET`) belonged to the set-video emails, which are gone. They can be deleted from Vercel.

## Running it

```
npm install
npm run dev          # http://localhost:3000
npm test             # progression engine
npm run typecheck
npm run gen:seed     # regenerate supabase/seed.sql from lib/engine/program.ts
npm run seed:admin   # creates/promotes ADMIN_EMAIL, seeds trained starting loads
```

Database: apply `supabase/migrations/*.sql` in order, then `supabase/seed.sql` (SQL editor, `supabase db push`, or the Management API).

## How a workout works

1. **Today** shows the next workout in the rotation (say *Day 3 · Legs + posterior*), its six lifts with weight × reps from the engine, and how many of this week's five are done. Any day of the week can be a workout day.
2. **The rotation never skips.** The next workout is always the one after the last one trained: do Day 1 on Monday, rest Tuesday, and Wednesday is Day 2. A workout started but abandoned on an earlier day still counts if at least one working set was logged. One workout per calendar day.
3. **Live lift**: the lift name, an optional *Watch form video* link, the set (*Set 2 of 3*), the giant `40 × 9`, *Last time*, set bars and **Log set**. The first lift has two warm-up sets first (≈50 % × 5, ≈75 % × 3) logged with *Warm-up done*; they never touch the engine.
4. **Change the weight on any set** with − / + (legal Bowflex loads only). The change applies to that set and the rest of the lift, and is saved immediately. Bodyweight lifts have no weight control.
5. **Log set** → the set is stored at the weight used → **rest**: an ember ring drains to 0:00 and the next set opens (between sets: the lift's rest; between lifts: 90 s; after warm-ups: 45 s). *Skip rest* is allowed and recorded on the set.
6. Skipping a lift from the `‹` menu counts as a miss. Closing the app mid-lift and coming back another day also counts it as a miss; untouched lifts are left alone.
7. **Form videos** (admin): Settings → Form videos takes one clip per exercise; it shows as a link on that lift's live screen. There is no other video in the app.

**Reset all exercises** (Settings) deletes every workout and set for the account, puts every lift back to its starting load and restarts the rotation at Day 1. To reset lifts but keep history, delete the account's `user_exercise_state` rows and set `users.program_start_on` to today: workouts before that date no longer count toward the rotation or the week.

## The rotation

Six lifts × 3 working sets = 18 working sets a workout, ≈ 47–52 min including rests and dumbbell changes.

| Workout | Lifts |
|---|---|
| **Day 1 · chest + core** | incline DB press · flat DB press · DB pullover · lateral raise · hanging knee raise · half-kneeling anti-rotation press |
| **Day 2 · back + arms** | pull-up · single-arm DB row · chest-supported DB row · rear-delt fly · incline DB curl · dead bug |
| **Day 3 · legs + posterior** | goblet squat · RFE split squat · DB RDL · prone DB leg curl · DB hip thrust · single-leg calf raise |
| **Day 4 · push + arms** | decline/flat DB press · seated DB overhead press · overhead DB extension · hammer curl · lateral raise · feet-elevated push-up |
| **Day 5 · back + posterior** | pull-up · two-arm bent-over row · reverse lunge · DB RDL · hanging leg raise · seated single-leg calf raise |

Pull-ups (Day 2 and Day 5) share one progression, so reps go up each time either workout is done, as long as every set is hit. All pull-up variations start at 5 reps (range 5–10).

## Never running out of road at 52.5 lb

The dumbbells stop at 52.5 lb per hand, so load progression on any given movement is finite. Every lift therefore has a **ladder** (`VARIANTS` in `lib/engine/program.ts`): an ordered list of progressively harder versions of the same movement, each restarting at a low load so double progression can run again for months.

A lift only climbs a rung when it is genuinely finished — all three sets at 52.5 lb (or at the bodyweight rep cap) *and* at the top of the extended rep range. Then the engine swaps the movement, resets the load, clears the "last log" caption and shows the new cue. For example `goblet squat → heel-elevated goblet squat → front-racked squat (two dumbbells, double the load) → heel-elevated front-racked squat → sissy squat`, or `pull-up → weighted pull-up (dumbbell between the feet) → archer pull-up`.

The ladders use only what the evidence supports for a fixed load ceiling: convert to **unilateral** (matches bilateral for hypertrophy, and one limb carries the whole load), add **range of motion** with a deficit, move to a harder **mechanical position** (steeper incline, overhead, rear-foot-elevated), add **lengthened partials**, or hand the movement to **bodyweight**, where the ceiling is effectively unlimited. Tempo and drop sets are deliberately *not* progression steps — the 2025 tempo meta-analysis found eccentric speed barely matters, and intensity techniques don't beat straight sets when volume is equated.

**Exercises are not rotated on a calendar.** Randomly varying exercises showed no benefit over a fixed selection (Baz-Valle 2019) and excessive rotation actively hurts (Kassiano 2022); the cost is losing the progression log. Variety comes instead from breadth inside the week — two structurally distinct movements per muscle — plus earned graduation up the ladder.

## Progression engine (pure TypeScript)

Legal Bowflex 552 loads only: 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 30, 35, 40, 45, 50, 52.5. 27.5 and 32.5 never appear; anything else snaps to the next legal load.

- Double progression per lift, 8–12 reps (calves 10–15 standing, 12–20 seated, leg curl 10–15, pull-ups 5–10).
- **Weight changed mid-lift**: the lift settles on the median of its three set weights (40 · 35 · 35 → 35; 30 · 35 · 35 → 35; 40 · 40 · 35 → 40) and the next workout builds from it. If a later set went lighter than that weight after reaching it (40 · 40 · 35), the same prescription is held, without counting a miss. Starting light and moving up progresses normally (`settleLift`).
- All three sets hit and reps below the ceiling → same weight, +1 rep. At the ceiling → next legal load, reps back to the floor.
- Miss (lift started, left before three LOG SETs) → hold once. Second straight miss → one increment down, reps to the floor. A prescription is never issued a third time without graduating or deloading.
- 52.5 at the ceiling → stay and add bonus reps (*Dumbbell max. Adding reps.*) up to `rangeMax + 8`; once those are beaten the lift graduates to the next rung of its ladder. Bodyweight lifts do the same.
- **Adaptive ceiling (evidence-based addition):** the top of the range rises with the size of the next dumbbell jump — `clamp(floor + round(jump% / 2.5), max, max + 8)` — so a 25 → 30 lb step (+20 %) happens at 16 reps rather than 12 and lands at roughly equal difficulty (25 × 16 ≈ 30 × 8 by Epley). Small jumps (45 → 50, 50 → 52.5) keep the plain 8–12.
- Starting loads = trained seed × multiplier (sedentary 0.45, lightly active 0.55, moderately active 0.70, returning lifter 0.85 × bodyweight/160 lb clamped ±20 %, trained 1.0), snapped **down** to a legal load, capped at 40 lb unless trained. Change any of them on the live screen at any time.

## Program evidence and deviations from the original spec

The spec was reviewed against current literature (Sept 2026) before coding. Everything below is documented in `lib/engine/program.ts` and easy to change there.

| Change | Why (sources) |
|---|---|
| Rest: 120 s on the day's first two compounds, 90 s other compounds, 75 s unilateral/isolation/hanging, 60 s core (spec: 90/60/75) | ≤60 s measurably cuts reps and hypertrophy; trained lifters need >2 min on heavy compounds. Singer 2024 (Front Sports Act Living), Grgic 2017. Session still ≈ 40 min. |
| Two warm-up sets on lift #1 (50 % × 5, 75 % × 3) instead of one at 50 % | Schoenfeld's warm-up protocol; high-load/low-volume warm-ups improve session performance. |
| Loaded Russian twist → **half-kneeling anti-rotation press** (Mon #5) | Loaded flexion + rotation is the documented disc-injury mechanism; train the flexion *moment*, not the motion (McGill; Marshall & McGill). |
| Day 5 anti-rotation slot → **DB RDL** (shares progression with Day 3) | Hamstrings/glutes were trained once a week; ACSM 2026 and Pelland 2025 support ≥2 sessions per muscle per week. |
| Sixth lift added to every day: **lateral raise** (Mon), **incline DB curl** (Tue), **Nordic curl** (Wed), **feet-elevated push-up** (Thu), **reverse lunge** moved to Fri, **RFE split squat** added to Wed | 15 working sets/day ≈ 41 min, under the 45–60 min budget; quads (6 sets/wk), hamstrings, side delts and biceps were all below ACSM 2026's ≥10 sets/muscle/week. The RFE split squat also dodges the dumbbell ceiling — one leg carries ~2× the load of a goblet squat. |
| **Knee-flexion hamstring lift** alongside the RDL: first the Nordic curl, now the **prone DB leg curl** (Oct 2026) | Maeo 2024 (MRI, n=42): hip-hinge and knee-flexion hamstring work grow different heads; neither substitutes for the other. The assisted Nordic was hard to load and progress at home, so it was replaced by a dumbbell leg curl that progresses by weight like every other lift. Its ladder: prone → incline prone (hips bent; seated-style curls grew the hamstrings more than lying ones, Maeo 2021) → sliding leg curl → single-leg sliding leg curl. |
| Skull crusher → **seated two-hand overhead DB extension**, seed 25 lb | Overhead position grows all three triceps heads more (Maeo 2023); "40 lb" per hand was implausible next to a 35 lb flat press. |
| Bench back extension → **DB hip thrust** (10–15) | A flat bench can't anchor the feet; hip thrust adds glute volume safely with the same bench. |
| Day 5 calf raise → **seated single-leg calf raise** (12–20) | Soleus needs bent-knee work; keep Day 3's straight-leg raise for gastrocnemius (Kassiano 2023 favours the long-length stretch). |
| Seated OH press seed 25 → 30 lb | DB shoulder press ≈ 80 % of incline DB press at intermediate level; 25/40 was the outlier. |
| Adaptive rep ceiling (above) | Adjustable dumbbells jump 5–50 % per step, not the 2–10 % classic double progression assumes. |
| No scheduled deloads | A planned deload week reduced strength gains with no hypertrophy benefit (Coleman 2024); reactive-only is correct. |

Kept as specified: everything else — five workouts, 8–12 default range, hit/miss rules, Day 4 decline/flat alternation by ISO week (shared progression), goblet squat, DB pullover (a chest lift, not a lat lift), hanging knee/leg raises, the walk outside the app, `52.5` cap behaviour.

Sources: Singer et al. 2024 <https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1429789/full> · Grgic et al. 2017 · Robinson et al. 2024 <https://link.springer.com/article/10.1007/s40279-024-02069-2> · Pelland et al. 2025 <https://link.springer.com/article/10.1007/s40279-025-02344-w> · ACSM 2026 position stand <https://acsm.org/resistance-training-guidelines-update-2026/> · Maeo et al. 2023 <https://onlinelibrary.wiley.com/doi/10.1080/17461391.2022.2100279> · Kassiano et al. 2023 <https://pubmed.ncbi.nlm.nih.gov/37015016/> · McGill, *Spine flexion: myths, truths and issues* <https://www.backfitpro.com/documents/Spine-flexion-myths-truths-and-issues.pdf> · Coleman et al. 2024 <https://peerj.com/articles/16777/> · Schumann et al. 2022 (concurrent training) <https://link.springer.com/doi/10.1007/s40279-022-01688-x>.

## Data

`users`, `exercises`, `user_exercise_state`, `sessions` (`day_index` = position in the rotation, 1–5), `session_lifts` (the workout's prescription snapshot), `session_sets` (`actual_weight` = the weight used on that set), `form_videos`, `photos`. RLS on everywhere; users own their rows; everyone signed in can read `form_videos` and the `form` bucket; only the admin writes them. Storage: `form/{exercise_key}.mp4`, `photos/{user}/…`. The `clips` table, the `sessions` bucket and the video/email columns are left over from set recording and are no longer written.

Admin: the auth trigger promotes `app_config.admin_email` to `role = admin`; `/admin/form-videos` (one clip per lift, Set / Replace) is admin-only.

## Known limits

- Supabase's built-in auth mailer sends **2 emails/hour** (confirmations, password resets). Configure custom SMTP in Supabase → Auth → SMTP for a normal limit.
- The screen stays on during a workout via the Wake Lock API (reliable in installed web apps from iOS 18.4).
