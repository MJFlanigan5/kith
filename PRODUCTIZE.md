# Kith → Product: Migration & Roadmap

## Architecture decision

One D1 database per family, provisioned on signup. Workers replaces Express.
No tenant_id columns — isolation is at the database boundary, not the row level.
React frontend stays on Cloudflare Pages (already does static files well).

**Why D1 over Postgres:**
- Schema is SQLite already — port is near-zero
- $0.75/million reads; a family does ~10k reads/day → 1,000 families costs ~$20/mo infra
- Per-database model means a bug can't leak one family's data to another
- You already deploy ClawHQ on Cloudflare Workers, same pipeline

---

## db.js → D1: What changes

D1 uses the same SQL. The only diff is the call API goes async.

```js
// better-sqlite3 (current)
const row  = db.prepare('SELECT * FROM events WHERE id=?').get(id);
const rows = db.prepare('SELECT * FROM events').all();
db.prepare('INSERT INTO events (title) VALUES (?)').run(title);

// D1 (Workers)
const row  = await env.DB.prepare('SELECT * FROM events WHERE id=?').bind(id).first();
const rows = (await env.DB.prepare('SELECT * FROM events').all()).results;
await env.DB.prepare('INSERT INTO events (title) VALUES (?)').bind(title).run();
```

Transactions — current code uses `db.transaction(fn)()`, D1 uses batch:

```js
// current
db.transaction(() => {
  db.prepare('DELETE FROM shared_list_items WHERE list_id=?').run(id);
  db.prepare('DELETE FROM shared_lists WHERE id=?').run(id);
})();

// D1
await env.DB.batch([
  env.DB.prepare('DELETE FROM shared_list_items WHERE list_id=?').bind(id),
  env.DB.prepare('DELETE FROM shared_lists WHERE id=?').bind(id),
]);
```

Schema migrations: Workers doesn't have `db.exec()` on startup.
Use Wrangler migrations instead (`wrangler d1 migrations apply`).
Each `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE` in db.js becomes a numbered migration file.

---

## server.js → Workers: What changes

Use **Hono** — it's Express for Workers. Route syntax is nearly identical,
response/request API is the standard Web API (no `res.json`, use `c.json()`).

```js
// current Express
app.get('/api/events', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM events ORDER BY date').all());
});

// Hono on Workers
app.get('/api/events', requireAuth, async (c) => {
  const rows = (await c.env.DB.prepare('SELECT * FROM events ORDER BY date').all()).results;
  return c.json(rows);
});
```

The `requireAuth` middleware reads the same JWT — just use `c.req.header('Authorization')`
instead of `req.headers.authorization`. Auth logic is identical.

**Things that need rework (not just async):**

| Current | Workers equivalent |
|---|---|
| `better-sqlite3` sync | D1 async (covered above) |
| `EventSource` / SSE for real-time | Durable Objects OR just poll (15s poll fallback already exists) |
| `require('crypto').randomBytes()` | `crypto.getRandomValues()` (Web Crypto, already available) |
| `node:fs` for photo uploads | R2 object storage |
| `nodemailer` for email | Resend or Cloudflare Email Workers |
| Local SQLite file | D1 (covered above) |

Photos and file uploads are the biggest lift. Current code serves files from `/photos/`.
On Workers, those go to R2. Upload becomes `env.PHOTOS.put(filename, stream)`,
serve becomes `env.PHOTOS.get(filename)` → stream response.

---

## Auth: Replace homebrew JWT with Clerk

Current system: username/password → JWT stored in localStorage, checked server-side.
Works fine for self-hosted, breaks for a product (no invite flow, no password reset,
no family member onboarding).

Clerk handles all of this in ~50 lines:

```js
// Frontend: wrap app in ClerkProvider
import { ClerkProvider, useAuth } from '@clerk/clerk-react';

// Replace localStorage token reads with:
const { getToken } = useAuth();
const token = await getToken(); // Clerk JWT, verified server-side

// Backend (Hono middleware):
import { clerkMiddleware, getAuth } from '@hono/clerk-auth';
app.use('*', clerkMiddleware());
const auth = getAuth(c);
if (!auth?.userId) return c.json({ error: 'Unauthorized' }, 401);
```

Clerk org = family. Members join via invite link. Roles: `admin` (parent) / `member` (everyone else).
Replaces the current `isAdmin` flag with Clerk's built-in org role check.

---

## What to add to make it a real product

### Must-have before launch

**1. Chore completion photos**
This is Skylight's primary differentiator for families with kids.
Kid marks chore done → prompted to take a photo → photo appears in parent's view.
Store in R2. Add `photo_url` column to chores completions table.

**2. Recurring chore auto-reset**
Currently chores go `due → done` and stay done. A real product needs
`done → resets to due` on a schedule. Add `recurrence` (daily/weekly/monthly)
and a cron job (Workers Cron Trigger) that resets chores each morning.

**3. Invite flow / family onboarding**
Without this, nobody can actually sign up without calling you.
Clerk handles the invite link mechanic. You just need a `/join/:token` page
that accepts the Clerk invite and provisions their D1 database.

**4. PWA install prompt**
The app works offline-capable already (Vite outputs a build).
Add a service worker + `manifest.json` with proper icons so it installs
to the home screen on iOS/Android. Native feel without an app store submission.

**5. Proactive push notifications**
Current push only fires when the app is open. A real product sends:
- "Trash day tomorrow" (chore reminder)
- "Electric bill due in 3 days"
- "Milk expires today"
Workers Cron Trigger runs nightly, queries each family's D1, fires Web Push
to registered tokens. Already have the push subscription infrastructure.

---

### High-value differentiators

**6. AI meal planner**
Given pantry contents + meal history, suggest a week of dinners.
One Claude API call: `{pantry: [...], recent_meals: [...]} → suggested_meals[]`.
Add a "Suggest meals" button to MealPlanScreen. Costs ~$0.01 per family per week.

**7. Smart grocery**
Learn what a family buys. When they check off grocery items, track frequency.
Surface "You usually buy X around this time" suggestions.
Pure SQLite analytics — no AI needed. `purchase_history` table, frequency query.

**8. Budget AI insights**
Monthly summary: "You spent 23% more on dining this month. Biggest change: DoorDash ($180)."
One Claude call on the first of each month per family.

**9. Subscription audit**
Flag subscriptions where `trial_ends` passed with no cancel and `active=1`.
Surface "You've had [service] for 14 months — still using it?" prompts in the UI.
Pure logic, no AI.

**10. Weekly family digest email**
Every Sunday: chores completed this week, upcoming bills, birthdays this month,
projects in progress. One email per family per week via Resend.
Highly retention-positive — families see value even when not using the app.

---

### Nice-to-have

**11. Kid mode / role-based UI**
Parents see everything. Kids see chores, grocery, countdown, meal plan — not bills,
emergency info, budget. Controlled by Clerk org role.

**12. Offline grocery list**
The #1 use case is standing in a grocery store with spotty signal.
Service worker + IndexedDB caches the grocery list. Syncs on reconnect.
Add `background sync` API for check-offs made offline.

**13. Capacitor wrapper (iOS/Android)**
Wraps the web app in a native shell for app store distribution.
Gives access to native push (more reliable than Web Push on iOS),
camera (for chore photos), and NFC (for quick-launch shortcuts).
~1 day of work if the PWA is solid first.

**14. Data export**
GDPR requirement if you have EU users. Also a trust signal.
One endpoint: `GET /api/export` → zip of all tables as JSON/CSV.

**15. Shared shopping with real-time sync**
Two people at different stores checking off grocery items at the same time
currently requires a page refresh to see each other's changes.
Durable Objects WebSocket would fix this. Or: optimistic local state + 5s poll
(much simpler and probably good enough).

---

## Build order

If shipping to strangers:

```
1. Auth (Clerk) + invite flow          — nobody can sign up without it
2. D1 migration                        — enables multi-tenant
3. Recurring chore auto-reset          — biggest daily-use gap
4. Chore photos                        — matches Skylight's anchor feature
5. PWA + push notifications            — retention
6. Weekly digest email                 — retention
7. AI meal planner                     — first AI feature, low cost, high wow
8. App store (Capacitor)               — distribution
```

---

## What stays the same

- All SQL schemas (no changes needed)
- All React frontend code (minor auth token swap)
- All business logic in route handlers
- KITH_SPEC.md as the source of truth for features
- Docker path still works for self-hosted / power users who want it

---

## Pricing model

| Tier | Price | What's included |
|---|---|---|
| Free | $0 | 1 family, core features (chores, grocery, calendar, pantry) |
| Family | $6/mo | All screens + AI features + push notifications + digest email |
| Lifetime | $99 | Family tier forever, early adopter pitch |

Comparable: Skylight calendar is $10.75/mo for a tablet-only experience.
Kith at $6/mo with more features is a clear win on paper.
