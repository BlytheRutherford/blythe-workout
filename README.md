# Blythe Workout

iPhone-first PWA at **https://blytheworkout.com**. Five dumbbell lifts a day, Monday–Friday, the same program for everyone; only starting weights differ. On the recording account every set is filmed (front camera, video-only so background music keeps playing); as soon as a lift's three sets are done they are stitched into one video and emailed as **"Day N: Dumbbell incline press"**.

Stack: Next.js 16 (App Router, TypeScript, Tailwind v4), Supabase (auth + Postgres + Storage + Edge Function), Vercel (hosting, cron), Resend (mail). Butter Black design: `#0A0A0A` background, `#F3E5AB` for every title, hero number and pill. IBM Plex Sans for UI, Fraunces for giant numbers.

## Where things live

| Thing | Where |
|---|---|
| Production | Vercel project `blythe-workout`, domains `blytheworkout.com` + `www` (308 → apex) |
| Database / auth / storage | Supabase project `blythe-workout` (us-east-1, Free plan) |
| Email | Resend, sending domain `blytheworkout.com`; Edge Function `send-day-email` |
| Program definition | `lib/engine/program.ts` (single source of truth; `npm run gen:seed` writes `supabase/seed.sql`) |
| Progression engine | `lib/engine/progression.ts`, tests in `tests/engine.test.ts` (`npm test`) |

## Environment

Set in Vercel (Production + Preview) and `.env.local` for development:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=        # the sb_publishable_… key works here too
SUPABASE_SERVICE_ROLE_KEY=            # the sb_secret_… key works here too
ADMIN_EMAIL=you@example.com
RESEND_API_KEY=
EMAIL_FROM=Blythe Workout <noreply@blytheworkout.com>
NEXT_PUBLIC_SITE_URL=https://blytheworkout.com
EDGE_FUNCTION_SECRET=                 # shared secret between the app and the Edge Function
CRON_SECRET=                          # Vercel Cron → /api/cron/cleanup
```

Edge Function secrets (`supabase secrets set`): `RESEND_API_KEY`, `EMAIL_FROM`, `EDGE_FUNCTION_SECRET`.

Until Resend has verified `blytheworkout.com`, `EMAIL_FROM` must stay `Blythe Workout <onboarding@resend.dev>`, and Resend will only deliver to the Resend account's own address. Once the domain shows **Verified** in Resend, switch `EMAIL_FROM` (Vercel env + Edge Function secret) and redeploy.

## Running it

```
npm install
npm run dev          # http://localhost:3000
npm test             # progression engine
npm run typecheck
npm run gen:seed     # regenerate supabase/seed.sql from lib/engine/program.ts
npm run seed:admin   # creates/promotes ADMIN_EMAIL, seeds trained starting loads
```

Database: apply `supabase/migrations/*.sql` in order, then `supabase/seed.sql` (SQL editor, `supabase db push`, or the Management API). Deploy the mail function with `supabase functions deploy send-day-email --no-verify-jwt`.

Deploy: `npx vercel deploy --prod` (project is linked in `.vercel/`). Vercel Cron calls `/api/cron/cleanup` daily to delete videos older than 8 days (signed links last 7).

## How a day works

1. **Today** lists the day's five lifts with weight × reps from the engine. Weekends show *Yoga day · Yoga With Adriene · No lift prescribed.* The 2-mile walk is outside the app (gray note only). The lifetime day number ("Day N") is fixed when the day starts.
2. **Live lift**: `MON · 1/5`, lift name, optional *Form video* link, `THIS LOG` + giant `40 × 9`, gray *last log*, three set pips, *Change starting weight* (first 14 days only), and one pill: **RECORD** (accounts without `records_video` get **LOG SET** instead and never touch the camera). The first lift of the day has two warm-up sets first (≈50 % × 5, ≈75 % × 3) logged with *Warm-up done*; they never touch the engine.
3. **RECORD** → front camera, video only (from the tap) → giant **3 · 2 · 1** (tap to cancel, nothing written) → recording starts at 0 with the overlay `MON · DAY 1 · INCLINE PRESS` / `40 × 9` and `● REC 0:12`. Only pill: **LOG SET**. The preview is mirrored; the file is not.
4. **LOG SET** → stop → the last 3 s are dropped (whole 1-s fragments, never to empty) → clip queued for upload (IndexedDB-backed, retried) → the set is stored as a hit at the shown prescription → **rest** with a giant timer and auto-advance at 0:00 (between sets: the lift's rest; between lifts: 90 s; after warm-ups: 45 s). A faint *skip rest* link appears after 8 s; skipping is allowed, discouraged, and recorded on the set (`rest_skipped`, visible in the CSV and in the lift email).
5. Leaving a lift early (the `‹` at the top, with an inline confirm) counts as a miss. Closing the app mid-lift and coming back another day also counts it as a miss; untouched lifts are left alone.
6. **When a lift's third set is logged and its clips are uploaded**, the server stitches the three clips into one file with ffmpeg (stream copy, `+faststart`, `+genpts`), uploads `sessions/{user}/{date}/{exercise}.mp4`, and emails **"Day N: Dumbbell incline press"** with a 7-day signed link and the set list (file attached when under 20 MB). If concat fails: zip of clips + `youtube-description.txt`. If the zip can't be stored: per-clip links. A clip that never uploads is not waited for forever — closing the day (or the daily cron) emails whatever exists. Email failure never fails the workout; per-lift **Retry** is on the Day-complete screen.
7. The **overlay is burned into the file** through a canvas composite when the browser allows it (Settings → *Burn weight × reps into video*); if the composite is refused the raw camera stream is recorded and the on-screen overlay stays.
8. **Microphone is off by default.** Capturing the mic makes iOS switch to a record audio session, which pauses whatever music is playing; video-only capture leaves it alone. Settings → *Record microphone* turns sound on (and says it pauses music). Nothing in the app plays audio.

Camera fallback: if `getUserMedia` fails, *Choose from Camera Roll* (native picker) or *Log without video* appear under RECORD.

**Reset all exercises** (Settings) deletes every session, set, clip and video for the account, puts every lift back to its starting load, reopens the 14-day calibration and restarts at Day 1 — for testing the app before the real start.

## Progression engine (pure TypeScript)

Legal Bowflex 552 loads only: 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 30, 35, 40, 45, 50, 52.5. 27.5 and 32.5 never appear; anything else snaps to the next legal load.

- Double progression per lift, 8–12 reps (calves 10–15 standing, 12–20 seated).
- All three sets hit and reps below the ceiling → same weight, +1 rep. At the ceiling → next legal load, reps back to the floor.
- Miss (lift started, left before three LOG SETs) → hold once. Second straight miss → one increment down, reps to the floor. A prescription is never issued a third time without graduating or deloading.
- 52.5 at the ceiling → stay, add bonus reps (*Dumbbell max. Adding reps.*). Bodyweight lifts progress by reps only.
- **Adaptive ceiling (evidence-based addition):** the top of the range rises with the size of the next dumbbell jump — `clamp(floor + round(jump% / 2.5), max, max + 8)` — so a 25 → 30 lb step (+20 %) happens at 16 reps rather than 12 and lands at roughly equal difficulty (25 × 16 ≈ 30 × 8 by Epley). Small jumps (45 → 50, 50 → 52.5) keep the plain 8–12.
- Starting loads = trained seed × multiplier (sedentary 0.45, lightly active 0.55, moderately active 0.70, returning lifter 0.85 × bodyweight/160 lb clamped ±20 %, trained 1.0), snapped **down** to a legal load, capped at 40 lb unless trained. Adjustable per lift for the first 14 days.

## Program evidence and deviations from the original spec

The spec was reviewed against current literature (Sept 2026) before coding. Everything below is documented in `lib/engine/program.ts` and easy to change there.

| Change | Why (sources) |
|---|---|
| Rest: 120 s on the day's first two compounds, 90 s other compounds, 75 s unilateral/isolation/hanging, 60 s core (spec: 90/60/75) | ≤60 s measurably cuts reps and hypertrophy; trained lifters need >2 min on heavy compounds. Singer 2024 (Front Sports Act Living), Grgic 2017. Session still ≈ 40 min. |
| Two warm-up sets on lift #1 (50 % × 5, 75 % × 3) instead of one at 50 % | Schoenfeld's warm-up protocol; high-load/low-volume warm-ups improve session performance. |
| Loaded Russian twist → **half-kneeling anti-rotation press** (Mon #5) | Loaded flexion + rotation is the documented disc-injury mechanism; train the flexion *moment*, not the motion (McGill; Marshall & McGill). |
| Friday anti-rotation slot → **DB RDL** (shares progression with Wednesday) | Hamstrings/glutes were trained once a week; ACSM 2026 and Pelland 2025 support ≥2 sessions per muscle per week. |
| Skull crusher → **seated two-hand overhead DB extension**, seed 25 lb | Overhead position grows all three triceps heads more (Maeo 2023); "40 lb" per hand was implausible next to a 35 lb flat press. |
| Bench back extension → **DB hip thrust** (10–15) | A flat bench can't anchor the feet; hip thrust adds glute volume safely with the same bench. |
| Friday calf raise → **seated single-leg calf raise** (12–20) | Soleus needs bent-knee work; keep Wednesday's straight-leg raise for gastrocnemius (Kassiano 2023 favours the long-length stretch). |
| Seated OH press seed 25 → 30 lb | DB shoulder press ≈ 80 % of incline DB press at intermediate level; 25/40 was the outlier. |
| Adaptive rep ceiling (above) | Adjustable dumbbells jump 5–50 % per step, not the 2–10 % classic double progression assumes. |
| No scheduled deloads | A planned deload week reduced strength gains with no hypertrophy benefit (Coleman 2024); reactive-only is correct. |

Kept as specified: everything else — five days, 3 × 5 lifts, 8–12 default range, hit/miss rules, Thursday decline/flat alternation by ISO week (shared progression), goblet squat, DB pullover (a chest lift, not a lat lift), hanging knee/leg raises, weekend yoga, the walk outside the app, `52.5` cap behaviour, calibration window.

Sources: Singer et al. 2024 <https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1429789/full> · Grgic et al. 2017 · Robinson et al. 2024 <https://link.springer.com/article/10.1007/s40279-024-02069-2> · Pelland et al. 2025 <https://link.springer.com/article/10.1007/s40279-025-02344-w> · ACSM 2026 position stand <https://acsm.org/resistance-training-guidelines-update-2026/> · Maeo et al. 2023 <https://onlinelibrary.wiley.com/doi/10.1080/17461391.2022.2100279> · Kassiano et al. 2023 <https://pubmed.ncbi.nlm.nih.gov/37015016/> · McGill, *Spine flexion: myths, truths and issues* <https://www.backfitpro.com/documents/Spine-flexion-myths-truths-and-issues.pdf> · Coleman et al. 2024 <https://peerj.com/articles/16777/> · Schumann et al. 2022 (concurrent training) <https://link.springer.com/doi/10.1007/s40279-022-01688-x>.

## Data

`users`, `exercises`, `user_exercise_state`, `sessions`, `session_lifts` (the day's prescription snapshot), `session_sets`, `clips`, `form_videos`, `photos`. RLS on everywhere; users own their rows; everyone signed in can read `form_videos` and the `form` bucket; only the admin writes them. Storage: `form/{slug}.mp4`, `sessions/{user}/{date}/{exercise}-set{n}.mp4` and `day-N.mp4`, `photos/{user}/…`.

Admin: the auth trigger promotes `app_config.admin_email` to `role = admin` and turns on `records_video`; `/admin/form-videos` (one official clip per lift, SET / REPLACE) is admin-only. Recording + emails are per-account (`users.records_video`, service-role only) — the admin has it; other accounts just log sets.

## Known limits

- Supabase Free caps a single file at **50 MB**. A three-set lift video at 1.5 Mbps is typically 15–30 MB, so it fits; if a lift ever exceeds it the pipeline falls back to per-clip links.
- Supabase's built-in auth mailer sends **2 emails/hour** (confirmations, password resets). Configure custom SMTP with Resend in Supabase → Auth → SMTP once the domain is verified for a normal limit.
- iOS keeps the screen on during recording/rest via the Wake Lock API (reliable in installed web apps from iOS 18.4). Camera permission is asked once per launch in an installed PWA — that's an iOS behaviour.
- Chrome/Android record WebM; the day video is then `.webm`.
