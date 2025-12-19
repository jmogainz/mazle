# Mazle Epic: OIDC Auth + Stripe Entitlements + Global Leaderboards

This document is the **complete integration plan** for adding OIDC-only accounts, Stripe-based feature entitlements, and a Wordle-scale global leaderboard to Mazle, while keeping local dev automation consistent with the DevOps Toolkit workflow.

---

## 1) Goals & Constraints

**Goals**
- OIDC-only auth (Google + Apple) using Auth.js in Next.js.
- Stateless sessions (JWT in HttpOnly cookie), no app-level refresh token flow.
- Guest-first UX: generate a random username on first visit; allow claim on sign-in.
- Stripe one-time purchase unlocks **all historical puzzles** (calendar view).
- Global real-time leaderboard (5-7k QPS peak) with low latency and a few seconds of drift acceptable.
- Local dev: `make up ENV=dev` spins up a Postgres DB and seeds sample data automatically.

**Constraints**
- PaaS only (Vercel + Fly.io allowed).
- No app-level access/refresh token scheme.
- Dev mode: **all features enabled**, no Stripe gating.

---

## 2) Target Architecture (High-level)

### Core Services
- **Next.js (Vercel)**: UI, API routes, Auth.js, Stripe webhook, leaderboard reads/writes.
- **Auth.js**: OIDC Google + Apple, JWT session strategy.
- **Neon Postgres**: users, guest profiles, entitlements, historical puzzles, leaderboard snapshots.
- **Upstash Redis**: hot path for leaderboard writes/reads.
- **Stripe**: checkout session, webhook for entitlements.
- **Generator**: Rust service on Fly.io + WASM fallback.

### Runtime Modes
- **Prod**: Vercel + Neon + Upstash + Stripe + Fly generator.
- **Dev (local)**: Dockerized Next.js + Postgres + seed container + optional backend.

---

## 3) Data Model (Neon Postgres)

### Tables (minimum viable)
```
users (
  id UUID PK,
  email TEXT UNIQUE,
  name TEXT,
  image_url TEXT,
  created_at TIMESTAMP
)

guest_profiles (
  guest_id UUID PK,
  display_name TEXT UNIQUE,
  created_at TIMESTAMP
)

user_links (
  user_id UUID FK users(id),
  guest_id UUID FK guest_profiles(guest_id),
  claimed_at TIMESTAMP,
  PRIMARY KEY (user_id, guest_id)
)

leaderboard_entries (
  date DATE,
  subject_type TEXT,         -- "guest" or "user"
  subject_id UUID,
  moves INT,
  time_ms INT,
  created_at TIMESTAMP,
  PRIMARY KEY (date, subject_type, subject_id)
)

daily_puzzles (
  date DATE PK,
  seed TEXT,
  puzzle_blob JSONB,
  created_at TIMESTAMP
)

purchases (
  user_id UUID FK users(id),
  stripe_customer_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_price_id TEXT,
  created_at TIMESTAMP
)

entitlements (
  user_id UUID FK users(id),
  key TEXT,                  -- "archive_access"
  granted_at TIMESTAMP,
  expires_at TIMESTAMP NULL,
  source TEXT                -- "stripe"
)
```

**Notes**
- `subject_type` lets leaderboard entries work for guests before claim.
- After claim, we can either **migrate entries** to `subject_type="user"` or keep a mapping that resolves guest -> user.
- `daily_puzzles` supports the historical calendar.

---

## 4) Auth: OIDC-only with Auth.js (Stateless JWT)

### Key Decisions
- **Auth.js in App Router**: handlers in `app/api/auth/[...nextauth]/route.ts`.
- **JWT session strategy** only; no DB sessions.
- Session lifespan = 10 days.

### Auth.js routing (official reference snippet)
Source: Auth.js Next.js reference
```
// app/api/auth/[...nextauth]/route.ts
export { GET, POST } from "../../../../auth"
```

Source: Auth.js Next.js reference
```
// auth.ts
export const { handlers: { GET, POST }, auth } = NextAuth({...})
```

### Google provider snippet (official)
Source: Auth.js Google provider reference
```
Google({ clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET })
```

### Auth configuration (Mazle plan)
```
session: {
  strategy: "jwt",
  maxAge: 10 * 24 * 60 * 60,
  updateAge: 24 * 60 * 60
}
```

**Provider setup reminders**
- Google callback URI must end in `/api/auth/callback/google`.
- Apple web sign-in requires a **Services ID** linked to a primary App ID and the website domains configured in Apple Developer.

---

## 5) Guest -> Claim Flow

### Guest creation (first visit)
1) Client generates random username (e.g., `FrostyZubat83`).
2) Client calls `POST /api/guest` to mint `guest_id`.
3) Server stores `guest_profiles`.
4) `guest_id` stored in **HttpOnly cookie** + optional localStorage for UI.

### Claim flow (OIDC)
1) User clicks "Claim name / Save history."
2) Redirect to Auth.js sign-in (Google/Apple).
3) On callback:
   - Create `users` row if missing.
   - Link `guest_id` to `user_id`.
   - **Migrate leaderboard ownership** or store mapping.
4) If display name collision, prompt rename.

---

## 6) Leaderboard (Wordle-scale)

### Hot path: Redis sorted sets
Use `lb:{date}` sorted set key per day.

Source: Upstash Redis ZADD (TS example)
```
await redis.zadd("key",
  { score: 2, member: "member" },
  { score: 3, member: "member2" },
)
```

Source: Upstash Redis ZRANGE (TS example)
```
const res = await redis.zrange("key", 1, 3)
```

### Read path
- Global reads from Redis replicas with **seconds of drift** accepted.
- Cache "top N" for 1-5 seconds at the edge to smooth spikes.

### Write path
- All writes go to a **primary Redis region** to preserve ordering consistency.
- Optional: write-behind queue to persist top N in Postgres for historical audit.

### Daily snapshot
- Nightly job copies top N to `leaderboard_entries` in Postgres.

---

## 7) Stripe: One-time purchase -> Entitlement

### Checkout flow
- Create a single product + price in Stripe: "Historical Puzzle Archive".
- Use Checkout to complete the one-time purchase.
- Include `user_id` in `metadata` on the Checkout session.

### Webhook verification (official Stripe snippet)
Source: stripe-node repository (webhook signing)
```
const event = stripe.webhooks.constructEvent(
  webhookRawBody,
  webhookStripeSignatureHeader,
  webhookSecret
)
```

### Webhook handler behavior
- On `checkout.session.completed`, lookup `user_id` from metadata.
- Insert `entitlements` row with key `archive_access`.
- Insert a row in `purchases`.

### Dev mode override
- In dev, skip entitlement checks entirely:
```
const DEV_MODE = process.env.MAZLE_DEV_MODE === "1"
if (DEV_MODE) return allow
```

---

## 8) Local Dev Automation (DevOps Toolkit)

### Required changes
- **Add db compose to `COMPOSE_FILE`** in root `Makefile`:
```
COMPOSE_FILE := mazle.compose.yaml:mazle.wasm.compose.yaml:$(DEVOPS_TOOLKIT_PATH)/backend/docker/db.compose.yaml
```

- **Activate db & migrate profiles inside `mazle.compose.yaml`** (override behavior):
```
services:
  db:
    profiles:
      - db
  migrate:
    profiles:
      - migrate
```
**Note:** The toolkit `migrate` service requires `BWS_ACCESS_TOKEN` and expects `DB_URL` + `LD_SDK_KEY` in BWS. If you are not using BWS locally, either supply those secrets or skip the `migrate` profile and run a local migration step instead.

### Seed container in `app_pre`
- Add `seed-db` service in `mazle.compose.yaml` under `profiles: [app_pre]`.
- It runs a single Node script (exits on success).
```
services:
  seed-db:
    profiles:
      - app_pre
    command: ["node", "scripts/seed-db.js"]
```

### Seed strategy
- **Idempotent**: insert only if records missing.
- Seeds:
  - 10-50 guest profiles
  - 10-50 user accounts (fake)
  - Leaderboard entries for today
  - Daily puzzles for last N days

---

## 9) API Surface (Proposed)

### Auth & Guest
```
POST /api/guest
POST /api/auth/[...nextauth]
POST /api/claim
```

### Leaderboard
```
POST /api/leaderboard/submit
GET  /api/leaderboard/top?date=YYYY-MM-DD
GET  /api/leaderboard/me?date=YYYY-MM-DD
```

### Entitlements & Archive
```
POST /api/stripe/checkout
POST /api/stripe/webhook
GET  /api/archive/days
GET  /api/archive/:date
```

---

## 10) Security & Privacy

- Only Google/Apple (no credentials auth).
- JWT session cookie is HttpOnly and encrypted (Auth.js).
- Stripe webhook: verify signatures with raw request body.
- Rate limit writes to leaderboard API.
- Enforce unique display names at claim time.

---

## 11) Observability

- Log leaderboard writes/reads counts by day.
- Track drift window (Redis replica lag).
- Stripe webhook failures -> alert.
- Monitor DB query performance on archive calendar endpoints.

---

## 12) Rollout Plan

### Phase 1 - Foundations
- Add db compose and seed container.
- Create migrations for auth/leaderboard/entitlements tables.

### Phase 2 - Auth
- Implement Auth.js config and Google/Apple providers.
- Implement guest + claim flow.

### Phase 3 - Leaderboard
- Redis leaderboard write/read endpoints.
- Snapshot job to Postgres.

### Phase 4 - Stripe
- Checkout session creation + webhook + entitlements.
- Calendar UI gating by entitlement.

### Phase 5 - Load & QA
- Load test leaderboard endpoints at 5-7k QPS.
- Validate global ranking drift tolerance.

---

## 13) Open Questions
- Should guest scores migrate to user immediately on claim or remain "guest" with alias?
- How many historical puzzles to store (and for how long)?
- Will we allow name changes after claim?

---

## 14) Reference Links (official)
- Auth.js Next.js Reference (handlers, auth): https://authjs.dev/reference/nextjs  
- Auth.js Session Strategy (JWT): https://authjs.dev/concepts/session-strategies  
- Auth.js Google Provider: https://authjs.dev/reference/core/providers/google  
- Apple "Sign in with Apple" Web Setup: https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web  
- Stripe Webhook Signatures: https://docs.stripe.com/webhooks/signatures  
- Stripe Node Webhook Example: https://github.com/stripe/stripe-node#webhook-signing  
- Stripe Checkout Session Create: https://docs.stripe.com/api/checkout/sessions/create  
- Upstash Redis ZADD: https://upstash.com/docs/redis/sdks/ts/commands/zset/zadd  
- Upstash Redis ZRANGE: https://upstash.com/docs/redis/sdks/ts/commands/zset/zrange  
- Redis Leaderboards Overview: https://redis.io/solutions/leaderboards/
