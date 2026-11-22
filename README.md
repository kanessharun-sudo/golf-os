# Golf OS — Web Platform

Multi-tenant tee-time booking, live batch scoring, dual 9/18-hole handicaps, caddy marketplace with an append-only ledger, and social golfer profiles. Tenant #1: ASC Centre Golf Course, Bengaluru.

**Phase 1 status:** database schema, ASC Centre seed, Next.js 15 foundation and strict database types. Phases 2–5 are gated.

## Bootstrap (exact commands)

```bash
# 1. App (Next.js 15, App Router, TypeScript, Tailwind v4, ESLint, src/ dir)
npx create-next-app@15 golf-os --ts --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --turbopack --use-npm --yes
cd golf-os

# 2. Runtime dependencies
npm install @supabase/supabase-js @supabase/ssr framer-motion lucide-react recharts \
  zod clsx tailwind-merge class-variance-authority server-only tw-animate-css

# 3. shadcn/ui (components.json is committed; add components as each phase needs them)
npx shadcn@latest add button card input label dialog sheet tabs badge separator skeleton sonner

# 4. Supabase CLI: link and apply migrations
npm install -D supabase
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push            # applies supabase/migrations/001 → 002

# 5. Environment
cp .env.example .env.local      # fill in Supabase, Razorpay, Resend keys
npm run dev
```

After linking, `npm run db:types` writes `src/types/database.generated.ts`. Diff it against the hand-tuned `src/types/database.ts`; the JSONB contracts (`CoursePricing`, `CourseMedia`) must stay narrowed by hand.

## Folder tree

```
golf-os/
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql      # tables, enums, RPCs, triggers, RLS, Realtime, Storage
│   │   └── 002_seed_asc_centre.sql     # ASC Centre course, tees, holes, yardages, caddies
│   └── tests/
│       ├── 00_supabase_shim.sql        # auth/storage/roles stand-ins for vanilla Postgres
│       ├── 10_phase1_behaviour.sql     # 40+ assertions over booking, caddies, scoring, ledger, RLS
│       └── run_local.sh
├── src/
│   ├── app/
│   │   ├── layout.tsx                  # fonts (Cormorant Garamond / Inter / JetBrains Mono)
│   │   ├── globals.css                 # Tailwind v4 + @config + shadcn tokens on the Augusta palette
│   │   ├── (golfer)/                   # public + golfer surfaces → /, /courses/[slug], /rounds/[id]/score, /golfer/[username]
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   ├── (caddy)/caddy/layout.tsx    # /caddy/* — requireRole(["caddy"])
│   │   └── (admin)/admin/layout.tsx    # /admin/*  — requireRole(["course_admin","super_admin"])
│   ├── lib/
│   │   ├── env.ts                      # zod-validated public/server env
│   │   ├── utils.ts                    # cn(), formatPaise(), formatTeeTime()
│   │   ├── auth/session.ts             # getSessionContext(), requireRole()
│   │   └── supabase/{client,server,admin,middleware}.ts
│   ├── middleware.ts                   # session refresh + auth gate for /caddy /admin /rounds /account /bookings
│   └── types/database.ts               # strict types for every table, enum, JSONB contract and RPC
├── tailwind.config.ts                  # pine #0B2B1E · alabaster #F7F5F0 · brass #C5A059
├── components.json                     # shadcn/ui config
└── .env.example
```

Phase routes land inside these groups: Phase 2 `(golfer)/courses/[slug]` and `/login`; Phase 3 `(golfer)/rounds/[bookingId]/score`; Phase 4 `(golfer)/golfer/[username]`; Phase 5 `(caddy)/caddy/*`, `(admin)/admin/*`.

## Database design notes

| Area | Rule | Where it is enforced |
|---|---|---|
| Tenancy | Every tenant row has `course_id`; composite FKs `(course_id, id)` block cross-course references | Constraints |
| Money | Integer paise in `*_paise` columns (Razorpay native unit) | Column types |
| Tee slot | Key = course, date, tee time, start hole (back 9 starts on 10). Max 4 seats; private 4-ball takes the whole slot | `acquire_slot_hold`, `bookings_before_write` (advisory lock per slot) |
| Checkout hold | 7 minutes (`courses.checkout_hold_minutes`); one live hold per golfer; expired holds are ignored immediately | `acquire_slot_hold`, `slot_occupancy` |
| Caddy overlap | 135 min (9) / 270 min (18) windows; overlapping assignments are impossible | `get_available_caddies` + `EXCLUDE USING gist` |
| Scoring | Par/SI snapshotted per hole; Net Double Bogey cap (par + 5 without an index) | `hole_scores_before_write` |
| Handicaps | WHS 5.2 table over last 20 differentials, separate 9 and 18 tracks, cap 54.0; unrated tees fall back to slope 113 and par | `recalculate_player_handicaps`, `tee_rating_for_format` |
| Ledger | Append-only, running balance computed under a caddy row lock, never negative | `caddy_ledger_*` triggers + privilege revoke |
| Payouts | Requested → approved → processing → paid/failed; amount ≤ balance; UPI ID snapshotted from caddy record | `caddy_payout_*` triggers |

Verified on PostgreSQL 16: all migrations apply, the seed is idempotent, the behaviour suite passes, and 20 concurrent single-seat hold requests for one slot yield exactly 4 holds.

## Phase 2: booking and checkout

| Route | What it does |
| --- | --- |
| `/courses/[slug]` | Public showcase: hero, scorecard, tees, rate card, cancellation policy, caddy roster |
| `/courses/[slug]/book` | Tee sheet from `get_tee_sheet`; date strip, 18/front 9/back 9, 1–4 players, private four-ball |
| `/checkout/[holdId]` | 7-minute hold countdown → players, tee, round type → caddy per player → quote → Razorpay |
| `/bookings`, `/bookings/[id]` | Golfer's bookings, reference, players, caddies, payment, policy-aware cancel |
| `/login`, `/auth/callback` | Google, email code or magic link, phone OTP |
| `POST /api/payments/verify` | Checkout success handler (signature + Razorpay payment lookup) |
| `POST /api/webhooks/razorpay` | `payment.authorized`, `payment.captured`, `order.paid`, `refund.processed` |

Payment settlement lives in `src/lib/payments/settle.ts`; both the verify route and the
webhook call it, and the database makes the race safe. Refunds are claimed in
`payment_events` before Razorpay is called, so one payment is never refunded twice.

### One-time setup

1. **Supabase Auth → URL configuration:** add `${NEXT_PUBLIC_SITE_URL}/auth/callback` to redirect URLs.
2. **Supabase Auth → Providers:** enable Google (OAuth client from Google Cloud) and Phone (Twilio/MessageBird/Vonage; Indian SMS needs a DLT-registered sender and template).
3. **Supabase Auth → Email templates → Magic link:** include both `{{ .Token }}` (6-digit code) and a link to
   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}`.
4. **Razorpay → Webhooks:** URL `${NEXT_PUBLIC_SITE_URL}/api/webhooks/razorpay`, secret = `RAZORPAY_WEBHOOK_SECRET`,
   events `payment.authorized`, `payment.captured`, `order.paid`, `refund.processed`.
5. **Resend:** verify the sending domain used in `EMAIL_FROM`.
6. **WhatsApp/SMS:** point `WHATSAPP_WEBHOOK_URL` (or `SMS_WEBHOOK_URL`) at your provider bridge. It receives
   `{ to, template, params, idempotency_key }` with templates `booking_confirmed` and `booking_cancelled`.
   Leave both empty and those messages are logged as `skipped`.
7. **Cron:** call `select public.expire_stale_holds();` every minute (Supabase `pg_cron`). Expired holds are
   already ignored by every read; the job just tidies their rows and lapsed caddy holds.
