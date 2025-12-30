# Local End-to-End Test Plan (No Deploy)

Goal: validate the **real** local flows end-to-end (generator + KV + Postgres + leaderboard), without touching Vercel deployments.

## 0) Prereqs

- Docker is running on your machine.
- You are in repo root: `~/home/projects/mazle`
- You have a local `.env.local` with (at minimum):
  - `DATABASE_URL` (Neon)
  - `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Upstash KV REST)
  - `UPSTASH_LB_REST_URL` + `UPSTASH_LB_REST_TOKEN` (Upstash leaderboard REST)
  - `GENERATOR_URL=http://mazle-generator:8080` (server-side calls inside Docker network)
  - `NEXT_PUBLIC_MAZLE_API_MODE=real`
  - (optional) `NEXT_PUBLIC_GENERATOR_URL=http://localhost:8080` (client fallback)

Security: don’t paste secrets in chat; put them only in `.env.local`.

## 1) Start the stack

Always set the required var before Make:

```bash
export UNIQUE_RUNNER_ID=$(whoami)
```

Start local with “prod-like gating” (entitlements enforced) while still running Docker locally:

```bash
make up ENV=dev NEXT_PUBLIC_ENV=prod PARA_DEPS=0 ENABLE_NGROK_FOR_DEV=0
```

Notes:
- The gateway port may not be `8080`. Watch the output line: `LAN URL: http://...:<PORT>`.
- If you edited `nginx/nginx.conf.template`, re-run the command above to restart nginx.

## 2) Confirm health (gateway + generator)

Replace `APP_PORT` with the port you see in the Make output (example uses `8081`).

```bash
APP_PORT=8081
curl -s "http://localhost:$APP_PORT/api/health"; echo
curl -s "http://localhost:$APP_PORT/health"; echo
```

Expected:
- `/api/health` → `{"status":"ok"}`
- `/health` → `{"status":"ok", ...}` (generator health proxied through nginx)

## 3) Lock in a stable guest identity (cookie jar)

This ensures all subsequent API calls identify as the same guest.

```bash
APP_PORT=8081
COOKIE_JAR=/tmp/mazle_cookies.txt
rm -f "$COOKIE_JAR"

curl -s -c "$COOKIE_JAR" "http://localhost:$APP_PORT/api/me"; echo
curl -s -b "$COOKIE_JAR" "http://localhost:$APP_PORT/api/me"; echo
```

Expected:
- Both JSON blobs have the same `displayName`.
- `entitlements` is `{ archiveAccess: false, adsRemoved: false }` until purchase/auth exists.

## 4) Verify daily KV behavior (cache miss → archive generates → KV hit)

Get “today” (NY date) and confirm daily is a cache miss at first:

```bash
APP_PORT=8081
TODAY=$(curl -s "http://localhost:$APP_PORT/api/daily" | python3 -c "import sys,json; print(json.load(sys.stdin)['date'])")
echo "TODAY=$TODAY"

curl -s "http://localhost:$APP_PORT/api/daily" | python3 -c "import sys,json; d=json.load(sys.stdin); print('date=',d.get('date'),'source=',d.get('source'),'hasPuzzle=',('puzzle' in d))"
```

Now force-generate/persist today via the archive route (allowed for today even without archive access):

```bash
curl -s -b "$COOKIE_JAR" -o /dev/null -w "archive_today HTTP=%{http_code} time=%{time_total}s\n" \
  "http://localhost:$APP_PORT/api/archive/$TODAY"
```

Re-check daily: it should now be a KV hit (`source=kv`):

```bash
curl -s "http://localhost:$APP_PORT/api/daily" | python3 -c "import sys,json; d=json.load(sys.stdin); print('date=',d.get('date'),'source=',d.get('source'),'hasPuzzle=',('puzzle' in d))"
```

## 5) Verify archive gating (past days locked without entitlement)

Pick a past day (yesterday in NY) and confirm it’s locked:

```bash
APP_PORT=8081
YESTERDAY=$(python3 -c "from datetime import date,timedelta; print((date.fromisoformat('$TODAY')-timedelta(days=1)).isoformat())")

curl -s -b "$COOKIE_JAR" "http://localhost:$APP_PORT/api/archive/days?from=$YESTERDAY&to=$TODAY" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('entitled=',d['entitled']); print('days=',d['days'])"

curl -s -b "$COOKIE_JAR" -i "http://localhost:$APP_PORT/api/archive/$YESTERDAY" | head -n 20
```

Expected:
- The `days` list shows `locked: true` for past days when not entitled.
- The puzzle fetch returns `403` with `ENTITLEMENT_REQUIRED`.

## 6) Leaderboard (guest submit → read top/me/around → reject resubmit)

Submit a score for today (daily-only):

```bash
APP_PORT=8081

curl -s -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d "{\"date\":\"$TODAY\",\"timeMs\":123456,\"attemptsUsed\":1}" \
  "http://localhost:$APP_PORT/api/leaderboard/submit"; echo
```

Read top entries (ensure you appear as `isMe: true` somewhere):

```bash
curl -s -b "$COOKIE_JAR" "http://localhost:$APP_PORT/api/leaderboard/top?date=$TODAY&limit=20" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('n=',len(d['entries'])); print('me=',[e for e in d['entries'] if e.get('isMe')])"
```

Read “my entry”:

```bash
curl -s -b "$COOKIE_JAR" "http://localhost:$APP_PORT/api/leaderboard/me?date=$TODAY"; echo
```

Try submitting again (should not update):

```bash
curl -s -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d "{\"date\":\"$TODAY\",\"timeMs\":99999,\"attemptsUsed\":1}" \
  "http://localhost:$APP_PORT/api/leaderboard/submit"; echo
```

Expected:
- First submit: `{ ok: true, updated: true, ... }`
- Second submit: `{ ok: true, updated: false, ... }`

## 7) If generator is slow (avoid nginx 502)

If puzzle generation takes longer than ~1 minute, nginx can return `502` unless timeouts are increased.
This repo sets long timeouts for `/api/generate` and now also for the frontend proxy (see `nginx/nginx.conf.template`).

If you change generator thresholds:

```bash
export UNIQUE_RUNNER_ID=$(whoami)
cd generator-rust && make up ENV=dev ENABLE_NGROK_FOR_DEV=0 2>&1 | tail -20
```

Then rerun section 4’s “archive today” request.

## 8) Auth + Stripe (not in this local plan yet)

This section validates the **real** purchase + entitlement unlock flow locally (no deploy).

### 8.1 Auth.js (Google)

Add to `.env.local`:
- `AUTH_URL=http://localhost:<APP_PORT>`
- `AUTH_SECRET=<random>`
- `GOOGLE_CLIENT_ID=...`
- `GOOGLE_CLIENT_SECRET=...`

Restart the stack (section 1), then confirm providers are exposed:

```bash
curl -s "http://localhost:$APP_PORT/api/auth/providers"; echo
```

Expected: `google` is present (not `{}`).

If you see `redirect_uri_mismatch` when signing in:
- Google Cloud Console → OAuth client → Authorized redirect URIs must include:
  - `http://localhost:<APP_PORT>/api/auth/callback/google`

### 8.2 Stripe (archive + no-ads)

Add to `.env.local`:
- `STRIPE_SECRET_KEY=sk_test_...`
- `STRIPE_ARCHIVE_PRICE_ID=price_...`

Install Stripe CLI (one-time) and start webhook forwarding:

```bash
stripe --version
stripe login
stripe listen --forward-to "http://localhost:$APP_PORT/api/stripe/webhook"
```

Copy the webhook signing secret that `stripe listen` prints and set:
- `STRIPE_WEBHOOK_SECRET=whsec_...`

Restart the stack (section 1).

Verify the offer endpoint (UI uses this to display price):

```bash
curl -s "http://localhost:$APP_PORT/api/stripe/archive-offer" | python3 -c "import sys,json; print(json.load(sys.stdin))"
```

Expected: includes `priceId` and `formattedPrice`.

Checkout guardrails:

- Guest checkout is blocked:
```bash
APP_PORT=8081
PRICE_ID=$(curl -s "http://localhost:$APP_PORT/api/stripe/archive-offer" | python3 -c "import sys,json; print(json.load(sys.stdin)['priceId'])")

GUEST_JAR=/tmp/mazle_guest_cookies.txt
rm -f "$GUEST_JAR"
curl -s -c "$GUEST_JAR" "http://localhost:$APP_PORT/api/me" >/dev/null
curl -s -i -b "$GUEST_JAR" -H 'content-type: application/json' \
  -d "{\"priceId\":\"$PRICE_ID\",\"successUrl\":\"http://localhost:$APP_PORT/\",\"cancelUrl\":\"http://localhost:$APP_PORT/\"}" \
  "http://localhost:$APP_PORT/api/stripe/checkout" | head -n 20
```
Expected: `401` `AUTH_REQUIRED`.

- Signed-in checkout works (run in browser DevTools Console):
```js
(async () => {
  const offer = await (await fetch('/api/stripe/archive-offer')).json();
  const origin = window.location.origin;
  const r = await fetch('/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      priceId: offer.priceId,
      successUrl: `${origin}/?checkout=success`,
      cancelUrl: `${origin}/?checkout=cancel`,
    }),
  });
  const json = await r.json();
  console.log('checkout', r.status, json);
  if (json?.url) window.location.href = json.url;
})();
```

After completing purchase in Stripe (test mode), verify entitlements:

```js
await fetch('/api/me').then(r => r.json())
```

Expected:
- `entitlements.archiveAccess === true`
- `entitlements.adsRemoved === true`

Optional guardrail check (should not create another checkout session):

```js
(async () => {
  const offer = await (await fetch('/api/stripe/archive-offer')).json();
  const origin = window.location.origin;
  const r = await fetch('/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      priceId: offer.priceId,
      successUrl: `${origin}/?checkout=success`,
      cancelUrl: `${origin}/?checkout=cancel`,
    }),
  });
  console.log(r.status, await r.json());
})();
```

Expected: `200` with `{ alreadyOwned: true }`.

Then confirm a past day is unlocked (DevTools Console):

```js
(async () => {
  const { date: today } = await (await fetch('/api/daily')).json();
  const y = new Date(today + "T00:00:00Z"); y.setUTCDate(y.getUTCDate() - 1);
  const yesterday = y.toISOString().slice(0,10);
  const r = await fetch(`/api/archive/${yesterday}`);
  console.log('archive', yesterday, r.status, await r.json());
})();
```

### 8.3 Leaderboard negative cases

- Reject non-today submission:
```bash
APP_PORT=8081
TODAY=$(curl -s "http://localhost:$APP_PORT/api/daily" | python3 -c "import sys,json; print(json.load(sys.stdin)['date'])")
NOT_TODAY=$(python3 -c "from datetime import date,timedelta; print((date.fromisoformat('$TODAY')-timedelta(days=1)).isoformat())")
curl -s -i -H 'content-type: application/json' \
  -d "{\"date\":\"$NOT_TODAY\",\"timeMs\":123,\"attemptsUsed\":1}" \
  "http://localhost:$APP_PORT/api/leaderboard/submit" | head -n 20
```
Expected: `400` `DATE_NOT_TODAY`.

- Reject invalid checkout price (DevTools Console):
```js
(async () => {
  const origin = window.location.origin;
  const r = await fetch('/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      priceId: 'price_NOT_REAL',
      successUrl: `${origin}/?checkout=success`,
      cancelUrl: `${origin}/?checkout=cancel`,
    }),
  });
  console.log(r.status, await r.json());
})();
```
Expected: `400` `INVALID_PRICE`.

## What We’ve Validated Locally (Checklist)

- Generator reachable via nginx (`/health`) and Next API reachable (`/api/health`).
- Daily puzzle cache miss/hit flow works (archive generates → KV stores → daily becomes `source=kv`).
- Archive gating works (past days 403 without entitlement; today is always playable; out-of-range dates 404).
- Leaderboard works (submit once only; reads top/me/around; rejects `DATE_NOT_TODAY`; validates `attemptsUsed`).
- Auth.js Google sign-in works locally (correct redirect URI).
- Stripe checkout + webhook works locally, and entitlements unlock archive + no-ads.
