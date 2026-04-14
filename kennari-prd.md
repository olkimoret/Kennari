# Kennari — Product Requirements Document
### Version 3.0 | For use with Claude Code

---

## 1. Product Overview

**Name:** Kennari (Icelandic for "teacher" / "guide")
**Type:** Mobile-first web app (vanilla HTML, CSS, JavaScript)
**Backend:** Supabase (free tier — auth + PostgreSQL database)
**Target user:** Adults 40+ who are beginners to strength training
**Core promise:** Remove all thinking from the gym. Kennari tells you exactly what to lift, how much, and how many reps — every single session.

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

### 2.4 Layout
- Mobile-first, max-width 480px, centered
- Full viewport height, native app feel
- Subtle SVG noise texture on body background
- 3-tab bottom nav: **Workout · Tracking · Settings**

### 2.5 Motion
- Staggered fade-in on page load
- "Complete Set" button: scale pulse + color flash on tap
- Rest timer: slides up from bottom, covers ~50% screen
- Behind timer: `backdrop-filter: blur(4px)` + dark overlay
- Tap blurred area to dismiss timer
- Set dots: smooth fill animation on completion
- Warmup → working phase: color crossfade on accent elements

---

## 3. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML5, CSS3, JavaScript (ES6+) |
| Auth | Supabase Auth (email/password) |
| Database | Supabase PostgreSQL |
| Fonts | Google Fonts (Bebas Neue + DM Sans) |
| Charts | Chart.js (CDN) |
| No frameworks | No React, Vue, Next — plain files only |

---

## 4. File Structure

```
kennari/
├── KENNARI-PRD.md
├── index.html            ← login / signup
├── onboarding.html       ← first-time setup
├── workout.html          ← active workout (core screen)
├── tracking.html         ← progress charts + goals
├── settings.html         ← user preferences
├── style.css             ← global design system
├── app.js                ← shared utilities, auth, nav
├── program.js            ← program engine (all weight logic)
├── workout.js            ← workout UI + timer logic
├── tracking.js           ← chart rendering
└── supabase.js           ← supabase client init
```

---

## 5. The Training Program

### 5.1 Workout Structure
- 3 days/week, strict A/B alternation: A-B-A-B-A-B...
- Each session = warmup sets + working sets for every exercise in that day

### 5.2 Workout Days

**Day A**
| # | Exercise | Notes |
|---|----------|-------|
| 1 | Squat | Barbell |
| 2 | Press (Overhead) | Barbell |
| 3 | Deadlift | Barbell |
| 4 | Push Up | Bodyweight — skip for v1, add later |

**Day B**
| # | Exercise | Notes |
|---|----------|-------|
| 1 | Squat | Barbell |
| 2 | Bench Press | Barbell |
| 3 | Deadlift | Barbell |
| 4 | Pull Up | Bodyweight — skip for v1, add later |

**Extra exercise (rows 7 / 13):** Optional, user-selectable from a list. Skip for v1, build later. Keep data model flexible for it.

### 5.3 Progression Rule
- Working weight = last session weight + **5 lbs**
- First session = starting weight entered during onboarding
- Failed session (missed reps): repeat same weight next session
- Failed same weight twice in a row: deload 10%, round to nearest 2.5 lbs

### 5.4 Warmup Calculation (per exercise, per session)
Warmup is done before each exercise. 4 sets, based on that exercise's working weight (W):

| Set | Reps | Weight |
|-----|------|--------|
| 1 | 5 | 40% of W |
| 2 | 4 | 50% of W |
| 3 | 3 | 60% of W |
| 4 | 2 | 80% of W |

**Rounding rule:** Round all warmup and working weights to nearest **2.5 lbs** (or 1.25 kg) so the user can actually load the bar.

**Example — Bench Press working weight = 85 lbs:**
- Set 1: 5 reps @ 34 lbs → rounded to **35 lbs**
- Set 2: 4 reps @ 42.5 lbs → rounded to **42.5 lbs**
- Set 3: 3 reps @ 51 lbs → rounded to **50 lbs**
- Set 4: 2 reps @ 68 lbs → rounded to **67.5 lbs**

### 5.5 Working Sets
- 3 sets × 5 reps @ 100% working weight
- No rounding needed (already a clean number)

### 5.6 Rest Times
- **During warmup sets:** 90 seconds
- **During working sets (between sets):** 180 seconds
- **Between exercises:** 180 seconds
- Rest times configurable in Settings

---

## 6. Weight Display Logic

All weights stored internally in **lbs**. Displayed in user's preferred unit.

### Three display modes (toggled by icons on workout screen):

```javascript
function getDisplayWeight(totalLbs, mode, barbellWeightLbs, unit) {
  let display;
  if (mode === 'total')     display = totalLbs;
  if (mode === 'dumbbell')  display = totalLbs / 2;
  if (mode === 'barbell')   display = (totalLbs - barbellWeightLbs) / 2;
  // Convert if needed
  return unit === 'kg' ? Math.round((display * 0.453592) * 4) / 4 : display;
  // Rounds kg to nearest 0.25
}
```

Default barbell weight: **45 lbs / 20 kg** (user can change in Settings)

---

## 7. Goal Calculation

User enters their bodyweight during onboarding. Goals are auto-set as % of bodyweight:

| Exercise | Goal % of Bodyweight |
|----------|---------------------|
| Squat | 125% |
| Press (Overhead) | 75% |
| Bench Press | 100% |
| Deadlift | 150% |
| Push Up | 10 reps (fixed) |
| Pull Up | 10 reps (fixed) |

**Example — 192 lbs bodyweight:**
- Squat goal: 240 lbs
- Press goal: 144 lbs
- Bench goal: 192 lbs
- Deadlift goal: 288 lbs

User can edit goals at any time from the Tracking tab.

---

## 8. Database Schema (Supabase)

### `profiles`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | FK → auth.users |
| name | text | First name |
| age | integer | |
| bodyweight_lbs | numeric | Used for goal calculation |
| unit_preference | text | 'lbs' or 'kg' |
| equipment_preference | text | 'barbell' or 'dumbbell' |
| barbell_weight_lbs | numeric | Default 45 |
| rest_warmup_seconds | integer | Default 90 |
| rest_working_seconds | integer | Default 180 |
| session_count | integer | Total completed sessions |
| created_at | timestamp | |

### `starting_weights`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | |
| user_id | uuid | FK → profiles |
| exercise | text | 'squat', 'press', 'bench', 'deadlift' |
| weight_lbs | numeric | Always stored in lbs |
| set_at | timestamp | |

### `sessions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | |
| user_id | uuid | |
| session_number | integer | Increments each session |
| workout_day | text | 'A' or 'B' |
| completed_at | timestamp | null = in progress |

### `sets`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | |
| session_id | uuid | |
| exercise | text | |
| set_type | text | 'warmup' or 'working' |
| set_number | integer | |
| reps_target | integer | |
| reps_completed | integer | |
| weight_lbs | numeric | Always stored in lbs |
| completed | boolean | |

### `personal_records`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | |
| user_id | uuid | |
| exercise | text | |
| weight_lbs | numeric | |
| reps | integer | |
| achieved_at | timestamp | |

### `goals`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | |
| user_id | uuid | |
| exercise | text | |
| target_weight_lbs | numeric | Auto-set from bodyweight, editable |
| created_at | timestamp | |

---

## 9. Screens

### 9.1 Login (`index.html`)
- "KENNARI" top left, Bebas Neue, cream
- Tagline: "Train smart. Get stronger."
- Email + password (show/hide toggle), all-caps labels
- Full-width salmon "Log In" button
- Ghost link: "New here? Create an account"
- Footer: "LONGEVITY & STRENGTH" small muted

### 9.2 Onboarding (`onboarding.html`) — 3 steps, shown once
1. **Welcome:** first name + age
2. **Your body:** bodyweight (lbs/kg toggle) + starting weight per exercise + barbell weight
3. **Goals preview:** shows auto-calculated goals, user can adjust, "Start Training" CTA

### 9.3 Workout Screen (`workout.html`) ← CORE

**Top:**
- Phase pill: blue "WARM UP" or salmon "WORKOUT"
- "Skip warm up" ghost link (top right, warmup phase only)

**Center:**
- Exercise name (large, cream)
- Huge weight number (Bebas Neue 64px, blue=warmup / salmon=working)
- Unit label (LBS or KG)
- Three icons below number: Total · Dumbbell · Barbell
  - Active icon highlighted, others muted
  - Small label: "total" / "per dumbbell" / "per side"
- Tap icon → instantly recalculates big number

**Set tracker:**
- Row of dots (4 dots warmup / 3 dots working)
- "SET 2/4 · 5 REPS" label
- Dot fills with animation on completion

**Bottom:**
- Full-width "Complete Set" button (blue=warmup / salmon=working), pinned above nav
- On tap: pulse animation → rest timer slides up

### 9.4 Rest Timer (overlay)
- Slides up from bottom, ~50% screen height
- Behind: blur + dark overlay; tap behind to dismiss
- Large countdown (Bebas Neue, amber)
- Circular SVG progress ring (amber)
- Warmup rest: 90s / Working rest: 180s
- "Skip Rest" ghost button

### 9.5 Tracking (`tracking.html`)
- Header: "Your Progress"
- Exercise pill selector (horizontal scroll)
- Line chart (Chart.js): working weight over time
- Time toggle: 4W · 8W · All
- Goal progress bar: "Current: 135 lbs · Goal: 240 lbs — 56%"
- "Edit goal" link

### 9.6 Settings (`settings.html`)
- Display name
- Unit: lbs / kg
- Bodyweight (recalculates goals)
- Barbell weight
- Warmup rest duration
- Working rest duration
- Log out (ghost/destructive)

---

## 10. Build Sequence

| Session | Files | Deliverable | How to verify |
|---------|-------|-------------|---------------|
| 1 | `style.css`, `index.html`, `app.js` | Design system + static login | Open in browser |
| 2 | `supabase.js`, `app.js`, `index.html` | Real auth (signup/login/logout) | Create account, check Supabase dashboard |
| 3 | `onboarding.html` | 3-step onboarding, saves to Supabase | Complete flow, check DB |
| 4 | `program.js` | Full program engine (warmup calc, progression, goals) | Test in console |
| 5 | `workout.html`, `workout.js` | Workout screen UI — static first | Visual check |
| 6 | `workout.js` | Wire workout logic (sets, progression, saves) | Complete full workout |
| 7 | `workout.js` | Rest timer overlay | Tap Complete Set |
| 8 | `tracking.html`, `tracking.js` | Charts + goal progress | Render with dummy data |
| 9 | `settings.html` | Settings — all prefs save | Change unit, reload |

---

## 11. Out of Scope (v1)
- Push notifications
- Social/sharing
- Extra exercise picker (keep data model flexible)
- Push-up / pull-up tracking (bodyweight, no weight calc needed — add in v2)
- AI tips (hardcoded post-v1)
- Multiple programs

---

## 12. MLP Checklist
- [ ] Sign up → onboard → first workout in under 5 min
- [ ] Warmup sets calculate correctly (round to 2.5 lbs)
- [ ] Working weight = last session + 5 lbs
- [ ] Weight display switches: total / per dumbbell / per side
- [ ] lbs ↔ kg works everywhere
- [ ] Blue = warmup, salmon = working
- [ ] Rest timer slides up, blurs bg, auto-dismisses
- [ ] Goals auto-set from bodyweight, editable
- [ ] Tracking chart renders on mobile
- [ ] No console errors on any screen

---
*Version 3.0 — Complete spec. Last updated April 2026.*
