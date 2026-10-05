# Kennari — Product Requirements Document
### Version 4.0 | For use with Claude Code

> v4.0 syncs this document with the code as it stands in October 2026. The existing program is now called **Lite Viking**. A second program, 5/3/1, is specced separately in `PRD-531.md`.

---

## 1. Product Overview

**Name:** Kennari (Icelandic for "teacher" / "guide")
**Type:** Mobile-first web app (vanilla HTML, CSS, JavaScript)
**Backend:** Supabase (free tier — auth + PostgreSQL database)
**Target user:** Adults 40+ who are beginners to strength training
**Core promise:** Remove all thinking from the gym. Kennari tells you exactly what to lift, how much, and how many reps — every single session.

Kennari supports multiple programs. 5/3/1 is specced in PRD-531.md.

**Programs**
| Program | Status | Spec |
|---------|--------|------|
| Lite Viking | Live. Everything in this document describes it unless stated otherwise. | This file |
| 5/3/1 | Specced, not built | `PRD-531.md` |

All Lite Viking database reads and writes on `sessions` are scoped to `program = 'lite_viking'` (see section 8).

---

## 2. Design System

### 2.1 Aesthetic Direction
Refined dark minimalism. Calm, confident, premium. Not a "bro" fitness app.
The one thing users remember: **huge, instantly readable numbers.**

### 2.2 Color Palette
```css
--bg: #1E2428;
--surface: #2A3038;
--surface-raised: #323B45;
--accent: #E07B6A;           /* salmon — working sets, primary CTA */
--accent-dark: #C4655A;
--accent-warmup: #5B8DB8;    /* blue — warmup phase */
--accent-warmup-dark: #4A7399;
--cream: #F2E8D9;
--text-muted: #B8BDC4;
--success: #6BAF92;
--warning: #E8B96A;          /* rest timer */
--border: #3A424C;
```

### 2.3 Typography
- **Display/numbers:** `Bebas Neue` (Google Fonts)
- **Body/UI:** `DM Sans` (Google Fonts)
- Scale: `--text-xs: 11px` · `--text-sm: 13px` · `--text-base: 15px` · `--text-lg: 18px` · `--text-xl: 24px` · `--text-2xl: 32px` · `--text-display: 64px`
- Radius: `--radius-sm: 8px` · `--radius: 14px` · `--radius-pill: 100px`

### 2.4 Layout
- Mobile-first, max-width 480px, centered
- Full viewport height, native app feel; safe-area aware CTAs on mobile
- Subtle SVG noise texture on body background
- 3-tab bottom nav: **Workout · Tracking · Settings**

### 2.5 Motion
- Staggered fade-in on page load
- "Complete Set" button: scale pulse + color flash on tap
- Bottom cards (rest timer, confirm, weight adjust): slide up from bottom over a blurred, dimmed overlay (`backdrop-filter: blur(4px)`); tap the overlay to dismiss
- Set dots: smooth fill animation on completion
- Warmup → working phase: color crossfade on accent elements
- Intro slides: slide transitions between slides and into the auth gate

---

## 3. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML5, CSS3, JavaScript (ES6+ modules) |
| Auth | Supabase Auth (email/password), `@supabase/supabase-js@2` via jsDelivr ESM |
| Database | Supabase PostgreSQL |
| Fonts | Google Fonts (Bebas Neue + DM Sans) |
| Charts | Chart.js (CDN) |
| Client storage | `localStorage` (`kennari_intro_seen`), `sessionStorage` (`kennari_workout`, in-progress workout) |
| No frameworks | No React, Vue, Next — plain files only |

---

## 4. File Structure

```
Kennari-App/
├── index.html            ← intro slides, auth gate, login, signup (all one page)
├── onboarding.html       ← first-time setup (4 steps)
├── onboarding.js         ← onboarding logic, saves profile / starting weights / goals
├── home.html             ← dashboard: greeting, next workout, tip, start CTA
├── home.js               ← dashboard logic
├── workout.html          ← active workout (core screen)
├── workout.js            ← workout UI, rest timer, weight adjust popup, persistence
├── tracking.html         ← progress charts + goals
├── tracking.js           ← chart rendering, goals, personal best
├── settings.html         ← user preferences
├── settings.js           ← settings logic
├── style.css             ← global design system
├── app.js                ← shared: auth guard (requireAuth), login redirect, auth listener
├── program.js            ← Lite Viking engine (all weight logic)
├── program531.js         ← 5/3/1 engine (logic only, not wired to any screen yet)
├── supabase.js           ← supabase client init + auth helpers
├── Assets/               ← images (Norse_pattern.png)
├── migrations/           ← manual SQL migrations (run in Supabase SQL Editor)
│   ├── 000_base_schema.sql ← base tables + RLS for a fresh Supabase project
│   ├── 001_531.sql       ← 5/3/1 columns + training_maxes table
│   └── 002_indexes.sql   ← lookup indexes
├── favicon.svg           ← tab icon (linked from every page)
├── netlify.toml          ← hides docs/, migrations/ and .claude/ from the public site
└── docs/                 ← project docs (in the repo, not served by Netlify)
    ├── kennari-prd.md    ← this file
    └── PRD-531.md        ← 5/3/1 spec
```

`program.js` stays the Lite Viking engine; `program531.js` holds the 5/3/1 logic (see `PRD-531.md`).

---

## 5. The Training Program — Lite Viking

### 5.1 Workout Structure
- Strict A/B alternation: A-B-A-B...
- The next day is derived from the last **completed** Lite Viking session (`workout_day`): none → A; A → B; B → A. No calendar; the next workout is always the next in sequence.
- Each exercise is done one at a time: warmup sets, then working sets, then rest, then the next exercise.

### 5.2 Workout Days

**Day A**
| # | Exercise | Working sets |
|---|----------|--------------|
| 1 | Squat | 3 × 5 |
| 2 | Press (Overhead) | 3 × 5 |
| 3 | Deadlift | 1 × 5 |

**Day B**
| # | Exercise | Working sets |
|---|----------|--------------|
| 1 | Squat | 3 × 5 |
| 2 | Bench Press | 3 × 5 |
| 3 | Deadlift | 1 × 5 |

Push Up, Pull Up and the optional extra exercise are not built. Keep the data model flexible for them.

### 5.3 Progression Rule
Working weight is calculated per exercise from the last two completed Lite Viking sessions that included it:
- No history: the latest `starting_weights` row for that exercise (falls back to 45 lbs).
- Last session not failed: last weight + **progression increment**.
- Last session failed once: repeat the same weight.
- Failed twice in a row at the same weight: deload to 90%, rounded to nearest 2.5 lbs.
- **Progression increment** is `profiles.weight_increment_lbs` (2.5, 5 or 10 lbs, default 5). Set in Settings.
- A session "failed" for an exercise if any working set was not completed, or `reps_completed < reps_target`.
- Known limitation: the workout screen currently logs every completed set as `reps_completed = reps_target`, so failure is not yet detectable from real data.

### 5.4 Warmup Calculation (per exercise, per session)
4 warmup sets, based on the exercise's working weight (W):

| Set | Reps | Weight |
|-----|------|--------|
| 1 | 5 | 40% of W |
| 2 | 4 | 50% of W |
| 3 | 3 | 60% of W |
| 4 | 2 | 80% of W |

**Rounding rule:** all warmup weights are rounded to nearest **2.5 lbs** and never go below **45 lbs** (the bare bar).

**Example — Bench Press working weight = 85 lbs:**
- Set 1: 5 reps @ 34 → **45 lbs** (floor)
- Set 2: 4 reps @ 42.5 → **45 lbs** (floor)
- Set 3: 3 reps @ 51 → **50 lbs**
- Set 4: 2 reps @ 68 → **67.5 lbs**

### 5.5 Working Sets
- Squat, Press, Bench: 3 sets × 5 reps @ working weight
- Deadlift: 1 set × 5 reps @ working weight

### 5.6 Rest Times
- After a warmup set, and after the last warmup set before working sets: `rest_warmup_seconds` (default 90)
- Between working sets, and between exercises: `rest_working_seconds` (default 180)
- No rest after the final set of the workout
- Both configurable in Settings (minimum 10 seconds)

---

## 6. Weight Display Logic

All weights are stored internally in **lbs**. Displayed in the user's preferred unit.

### Three display modes (toggled by icons on the workout screen)

```javascript
function getDisplayWeight(weightLbs, mode, barbellWeightLbs, unit) {
  let raw;
  if (mode === 'total')    raw = weightLbs;
  if (mode === 'dumbbell') raw = weightLbs / 2;                       // per dumbbell
  if (mode === 'barbell')  raw = (weightLbs - barbellWeightLbs) / 2;  // per side
  raw = Math.max(raw, 0);
  const roundedLbs = roundToNearest(raw, 2.5);
  return unit === 'kg' ? roundToNearest(roundedLbs * 0.453592, 1.25) : roundedLbs;
}
```

- Value is rounded to 2.5 lbs first, then converted; kg values round to nearest **1.25 kg**.
- Default barbell weight: **45 lbs / 20 kg** (user can change in Settings).

---

## 7. Goal Calculation

User enters bodyweight during onboarding. Goals are auto-set as a % of bodyweight, **rounded to the nearest 5 lbs**:

| Exercise | Goal % of Bodyweight |
|----------|---------------------|
| Squat | 125% |
| Press (Overhead) | 75% |
| Bench Press | 100% |
| Deadlift | 150% |

**Example — 192 lbs bodyweight:** Squat 240, Press 145, Bench 190, Deadlift 290 (each rounded to 5).

The user can edit goals at any time from the Tracking tab. Changing bodyweight in Settings does **not** recalculate goals. Push Up / Pull Up goals are not built.

---

## 8. Database Schema (Supabase)

Only columns the code actually uses are listed. All tables use RLS (user reads/writes own rows only).

### `profiles`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | = auth user id (one row per user; its existence means "onboarded") |
| name | text | First name |
| age | integer | |
| bodyweight_lbs | numeric | Used for goal calculation |
| unit_preference | text | 'lbs' or 'kg' |
| barbell_weight_lbs | numeric | Default 45 |
| rest_warmup_seconds | integer | Default 90 |
| rest_working_seconds | integer | Default 180 |
| weight_increment_lbs | numeric | Progression step: 2.5, 5 or 10. Default 5 |
| session_count | integer | Completed sessions (incremented on every finished workout) |
| active_program | text | **Added by migration 001.** 'lite_viking' (default) or '531'. Not read by code yet |

### `starting_weights`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | |
| user_id | uuid | |
| exercise | text | 'squat', 'press', 'bench', 'deadlift' |
| weight_lbs | numeric | Always lbs. Latest row per exercise wins |
| set_at | timestamp | |

Lite Viking only. 5/3/1 never reads or writes this table.

### `sessions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | |
| user_id | uuid | |
| session_number | integer | Count of completed sessions + 1 at workout start |
| workout_day | text | Lite Viking: 'A' or 'B'. 5/3/1: lift key |
| completed_at | timestamp | null = in progress |
| program | text | **Added by migration 001.** Default 'lite_viking'. Lite Viking reads filter on it and inserts set it explicitly |
| is_test | boolean | **Added by migration 001.** Default false. 5/3/1 test days |

Warmup sets are not saved. A session row is created on the first completed **working** set, not when the workout screen opens, so a workout with only warmups leaves no record. "I'm done for today" also stamps `completed_at`.

### `sets`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | |
| session_id | uuid | FK → sessions (sets are scoped to a program through their session) |
| exercise | text | |
| set_type | text | 'working' only for Lite Viking. Warmup sets are no longer stored (they are recalculated from the working weight); older rows may still be 'warmup' |
| set_number | integer | |
| reps_target | integer | |
| reps_completed | integer | Currently always = reps_target |
| weight_lbs | numeric | Always lbs |
| completed | boolean | |

### `goals`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | |
| user_id | uuid | |
| exercise | text | |
| target_weight_lbs | numeric | Auto-set from bodyweight, editable |

### `training_maxes` (5/3/1, added by migration 001)
See `PRD-531.md` section 4. Not used by Lite Viking.

### Not used by the code
`personal_records` and `profiles.equipment_preference` / `created_at` appeared in earlier versions of this document. The code does not read or write them (personal best is computed from `sets`).

---

## 9. Screens and Flow

### 9.0 Navigation flow
1. Open `index.html`. If a session exists: profile row present → `home.html`, otherwise → `onboarding.html`.
2. Not logged in and `kennari_intro_seen` not set: intro slides. Otherwise: auth gate.
3. Login success → `home.html`. Signup success → `onboarding.html`.
4. Onboarding save → `home.html`.
5. Protected pages call `requireAuth()` and redirect to `index.html` when signed out (also on `SIGNED_OUT` from another tab).

### 9.1 Intro, auth gate, login, signup (`index.html`)
- **Intro (first-ever open only), 3 slides:** "You don't need another program. You need to show up." → "Two workouts. Same exercises. We handle the rest." → "Show up." with CONTINUE / GET STARTED buttons and an "I already have an account" skip link. Sets `kennari_intro_seen` in `localStorage`.
- **Auth gate:** "Let's start." Primary CTA "New to Kennari" (signup), secondary "Log in".
- **Login:** email + password (show/hide toggle), all-caps labels, friendly error messages, back arrow to auth gate.
- **Signup:** email + password (show/hide toggle), "Create account", back arrow to auth gate.

### 9.2 Onboarding (`onboarding.html`) — 5 steps, shown once
0. **Choose your program:** two cards, Lite Viking and 5/3/1, each with a one-line description. No default; "Next" asks the user to choose. Saved as `profiles.active_program`. Cannot be changed later for now.
1. **Name + age** (heading personalizes as the name is typed), with a Back button to step 0
2. **Your body:** bodyweight (lbs/kg toggle) + barbell weight (default 45)
3. **Starting weights** (Lite Viking only): one per exercise, optional. Button reads "Skip" until a field is filled, then "Next". Empty fields fall back to the barbell weight.
4. **Your first goals:** auto-calculated from bodyweight, "Start Training" CTA

5/3/1 skips step 3 (test days replace starting weights) and the progress dots show 4 steps instead of 5.

Saves `profiles` (session_count 0, `active_program`), `starting_weights` (4 rows, **Lite Viking only**), `goals` (4 rows, both programs), then goes to `home.html`. If a profile already exists, redirects to `workout.html`.

Note: Home and Workout do not read `active_program` yet, so a 5/3/1 account is still served Lite Viking screens until those are built.

### 9.3 Home (`home.html`)
- KENNARI wordmark
- Greeting by recency (first workout / today / yesterday / N days ago / 7+ days "Good to have you back") plus a "Last workout" line
- "Your Next Workout" card: "TRAINING A" or "TRAINING B", exercise list with set counts (e.g. "3×5"), "~45 min"
- Random tip from a hardcoded list
- "Start Workout" CTA → `workout.html`

### 9.4 Workout Screen (`workout.html`) ← CORE

**Top:**
- Phase pill: blue "WARM UP" or salmon "WORKOUT"
- Header action: "Skip warm up" during warmup; **"I'm done for today"** during working sets

**Center:**
- Exercise name (large, cream), session label ("TRAINING A")
- Huge weight number (Bebas Neue 64px, blue = warmup / salmon = working), unit label (LBS / KG)
- Three icons: Total · Dumbbell · Barbell, with small label "total" / "per dumbbell" / "per side"
- Pencil button next to the weight opens the **weight adjustment popup** (working phase only)
- Reps line "5 REPS"; set line "SET 2 / 4 · 50%" (warmup shows percentage)

**Set tracker:**
- One card per exercise in the workout (completed / active / upcoming), each with dots: 4 for the active warmup, 3 for the active working phase, 3 filled when completed
- Dot fills on completion

**Bottom:**
- Full-width "Complete Set" button (blue = warmup / salmon = working), pinned above the nav
- On tap: pulse, set saved, rest timer slides up

**Weight adjustment popup** (bottom card):
- Shows the current working weight in the user's unit
- −/+ buttons step by the user's progression increment (`weight_increment_lbs`; shown in kg as half)
- Or type an exact weight; rounds to 2.5 lbs, minimum 45 lbs
- Save button appears only when the value changed
- Save re-calculates warmup and working sets for the current exercise on screen. It also inserts a new `starting_weights` row (so next session's progression starts from it) and updates already-logged working sets of this session for that exercise

**Done-for-today confirmation:** bottom card "Done for today? Your progress so far will be saved." with confirm / cancel. Confirming stamps the session `completed_at` and increments `session_count`. If no set was completed yet, no session is created and the user returns to Home.

**Workout complete:** overlay "Workout Complete" with a summary line and a button back to Home.

**Persistence:** the position in the workout (exercise, phase, set, display mode, session id, the workout itself) is stored in `sessionStorage` so navigating away and back resumes it. Cleared on finish. Discarded if it belongs to a different user.

### 9.5 Rest Timer (overlay)
- Slides up from bottom, ~50% screen height; blur + dark overlay behind; tap behind to skip
- Large countdown (Bebas Neue, amber) with circular SVG progress ring
- "Skip Rest" ghost button; auto-dismisses at 0 and advances to the next set
- Durations per section 5.6

### 9.6 Tracking (`tracking.html`)
- Header: "Your Progress"
- Exercise pill selector: Squat · Press · Bench Press · Deadlift
- Line chart (Chart.js): weight of the first working set per completed session, with a dashed amber goal line. Needs at least 2 points, otherwise an empty state.
- Time toggle: 4W · 8W (default) · ALL
- Goal card: current vs goal, percentage bar, "Edit goal" (saves to `goals`)
- Personal best card: heaviest logged working set for the exercise (shown with "5 reps")
- Reads only completed Lite Viking sessions

### 9.7 Settings (`settings.html`)
Sections, each saved independently:
- **Profile:** display name, age, bodyweight (Save button)
- **Equipment:** barbell weight (Save button)
- **Units:** lbs / kg toggle (saves immediately, no Save button)
- **Rest Timers:** warm up and working seconds (Save button)
- **Progression:** "Weight added each session": 2.5 / 5 / 10 lbs, with a kg equivalent label. The saved value is highlighted on open; picking another enables the Save button (`weight_increment_lbs`)
- **Account:** shows email, Log out

---

## 10. Build History

| Session | Deliverable |
|---------|-------------|
| 1 | Design system + static login |
| 2 | Real auth (signup/login/logout) |
| 3 | Onboarding saves to Supabase |
| 4 | `program.js` engine (warmup calc, progression) |
| 5–7 | Workout screen: UI, logic, saves, rest timer |
| 7–8 | Tracking charts + goal progress |
| 9 | Settings |
| 10 | Home dashboard |
| Later | Intro/auth flow rebuild, onboarding to 4 steps, workout redesign (exercise cards), done-for-today confirmation, persistent in-progress workout, weight adjustment popup, configurable progression increment |
| Next | 5/3/1 foundation: backup branch, migration 001, Lite Viking isolation (this change). 5/3/1 logic and UI follow per `PRD-531.md` |

---

## 11. Out of Scope
- Push notifications
- Social/sharing
- Extra exercise picker (keep data model flexible)
- Push-up / pull-up tracking (bodyweight, no weight calc needed — add in v2)
- AI tips (hardcoded post-v1)

---

## 12. MLP Checklist
- [ ] Sign up → onboard → first workout in under 5 min
- [ ] Warmup sets calculate correctly (round to 2.5 lbs, never below the bar)
- [ ] Working weight = last session + the user's progression increment
- [ ] Weight display switches: total / per dumbbell / per side
- [ ] lbs ↔ kg works everywhere
- [ ] Blue = warmup, salmon = working
- [ ] Rest timer slides up, blurs bg, auto-dismisses
- [ ] Goals auto-set from bodyweight, editable
- [ ] Tracking chart renders on mobile
- [ ] Leaving mid-workout and coming back resumes at the same set
- [ ] No console errors on any screen

---
*Version 4.0 — Synced with code October 2026. Program name: Lite Viking.*
