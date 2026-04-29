# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private admin dashboard that records anonymous visitors, comparison runs, AI call logs, and operational metrics.

**Architecture:** Add focused server modules for SQLite analytics and password session auth, then wire them into the existing Express proxy. Add lightweight client tracking around the comparison pipeline and render `/admin` from the same React app.

**Tech Stack:** Express, better-sqlite3, Node crypto, React 19, Vite, TypeScript, Recharts, Node test runner through tsx.

---

## File Structure

- Create `server/analytics.ts`: SQLite schema, visitor creation, comparison run lifecycle, AI call logging, admin summary queries, list queries.
- Create `server/adminAuth.ts`: signed admin session cookie helpers.
- Modify `server/index.ts`: add visitor middleware, comparison run API, admin API, and AI call logging around the existing Grok proxy.
- Create `src/services/trackingService.ts`: client helpers for comparison run start/finish.
- Modify `src/services/apiService.ts`: pass optional `runId` to every AI proxy request.
- Modify `src/services/geminiService.ts`: accept optional `runId` and forward it through the agent pipeline.
- Modify `src/App.tsx`: create and finish comparison runs around `generateComparison`.
- Create `src/admin/types.ts`: shared admin response types.
- Create `src/admin/adminApi.ts`: admin login/session/data fetch helpers.
- Create `src/admin/AdminApp.tsx`: private admin UI.
- Modify `src/main.tsx`: route `/admin` to `AdminApp`.
- Modify `.env.example`: document `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, and optional `ANALYTICS_DB_PATH`.
- Modify `package.json`: add `test` script.
- Create `tests/server/analytics.test.ts`: unit tests for analytics persistence and aggregation.
- Create `tests/server/adminAuth.test.ts`: unit tests for admin session signing and verification.

## Task 1: Analytics Persistence

**Files:**
- Create: `server/analytics.ts`
- Create: `tests/server/analytics.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing analytics tests**

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsStore } from '../../server/analytics';

test('records a visitor, run, and successful AI call', () => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'compareai-')), 'analytics.db');
  const store = createAnalyticsStore(dbPath, 'secret');
  const visitor = store.ensureVisitor({ visitorId: undefined, userAgent: 'agent', ipAddress: '127.0.0.1' });
  const run = store.startComparisonRun({ runId: 'run_1', visitorId: visitor.visitorId, itemA: 'A', itemB: 'B', language: 'en' });
  store.logAiCall({ runId: run.runId, visitorId: visitor.visitorId, callType: 'chat', model: 'grok', status: 'success', statusCode: 200, durationMs: 42 });
  store.finishComparisonRun({ runId: run.runId, visitorId: visitor.visitorId, status: 'completed' });
  const summary = store.getSummary();
  assert.equal(summary.today.users, 1);
  assert.equal(summary.today.comparisons, 1);
  assert.equal(summary.today.aiCalls, 1);
  assert.equal(summary.today.successRate, 100);
});
```

- [ ] **Step 2: Run failing test**

Run: `npm test -- tests/server/analytics.test.ts`

Expected: fails because `server/analytics.ts` does not exist.

- [ ] **Step 3: Implement analytics store**

Implement `createAnalyticsStore(dbPath, secret)` with schema creation, normalized ISO timestamps, SHA-256 IP hashing, visitor upsert, run start/finish, AI call insert, `getSummary`, `listRuns`, `listCalls`, and `listUsers`.

- [ ] **Step 4: Run analytics tests**

Run: `npm test -- tests/server/analytics.test.ts`

Expected: all analytics tests pass.

## Task 2: Admin Session Auth

**Files:**
- Create: `server/adminAuth.ts`
- Create: `tests/server/adminAuth.test.ts`

- [ ] **Step 1: Write failing auth tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminSessionToken, verifyAdminSessionToken, parseCookieHeader } from '../../server/adminAuth';

test('verifies a signed admin session token and rejects tampering', () => {
  const token = createAdminSessionToken('secret', 1700000000000);
  assert.equal(verifyAdminSessionToken(token, 'secret', 1700000000001), true);
  assert.equal(verifyAdminSessionToken(`${token}x`, 'secret', 1700000000001), false);
});

test('parses cookie headers', () => {
  assert.deepEqual(parseCookieHeader('a=1; admin_session=token'), { a: '1', admin_session: 'token' });
});
```

- [ ] **Step 2: Run failing auth test**

Run: `npm test -- tests/server/adminAuth.test.ts`

Expected: fails because `server/adminAuth.ts` does not exist.

- [ ] **Step 3: Implement auth helpers**

Implement HMAC-SHA256 session token creation and verification with a 7-day TTL, timing-safe signature compare, cookie parsing, and admin cookie names.

- [ ] **Step 4: Run auth tests**

Run: `npm test -- tests/server/adminAuth.test.ts`

Expected: all auth tests pass.

## Task 3: Express API Wiring

**Files:**
- Modify: `server/index.ts`
- Modify: `.env.example`

- [ ] **Step 1: Wire analytics store into Express**

Initialize the analytics store using `ANALYTICS_DB_PATH || server/compareai-analytics.db` and `ADMIN_SESSION_SECRET || ADMIN_PASSWORD || XAI_API_KEY || 'dev-secret'`.

- [ ] **Step 2: Add visitor middleware**

For all `/api/*` requests, read `visitor_id` from cookies, ensure a visitor, and set `visitor_id` as an `httpOnly`, `sameSite=lax`, 1-year cookie when missing.

- [ ] **Step 3: Add comparison run routes**

Add `POST /api/comparison-runs` for started runs and `PATCH /api/comparison-runs/:runId` for completed or failed runs.

- [ ] **Step 4: Extend `/api/ai` logging**

Capture `runId`, `callType`, `params.model`, duration, HTTP status, success/error, and error message without storing prompt or response bodies.

- [ ] **Step 5: Add admin routes**

Add login, logout, session, summary, runs, calls, and users routes. Protect every `/api/admin/*` route except login with the signed session cookie.

- [ ] **Step 6: Typecheck server wiring**

Run: `npm run lint`

Expected: TypeScript passes.

## Task 4: Client Tracking

**Files:**
- Create: `src/services/trackingService.ts`
- Modify: `src/services/apiService.ts`
- Modify: `src/services/geminiService.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add tracking service**

Create `startComparisonRun` and `finishComparisonRun` helpers that call `/api/comparison-runs`, catch non-fatal tracking failures in `App.tsx`, and return a run id when available.

- [ ] **Step 2: Thread run id through AI calls**

Add optional `runId?: string` to `generateComparison`, every agent function, and `callAI`. Include `runId` in the `/api/ai` request body.

- [ ] **Step 3: Update form workflow**

In `handleCompare`, start the run before `generateComparison`, mark it completed after success, and mark it failed in the catch block.

- [ ] **Step 4: Typecheck client tracking**

Run: `npm run lint`

Expected: TypeScript passes.

## Task 5: Admin UI

**Files:**
- Create: `src/admin/types.ts`
- Create: `src/admin/adminApi.ts`
- Create: `src/admin/AdminApp.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Add admin API client**

Implement login, logout, session, summary, runs, calls, and users fetch helpers with cookie credentials.

- [ ] **Step 2: Build admin page**

Render login when unauthenticated. Render metrics, 7-day trends, recent runs, failed calls, popular comparisons, and tabs for runs, calls, and users when authenticated.

- [ ] **Step 3: Route `/admin`**

In `src/main.tsx`, render `AdminApp` when `window.location.pathname` starts with `/admin`; otherwise render the existing `App`.

- [ ] **Step 4: Build verification**

Run: `npm run build`

Expected: Vite production build succeeds.

## Task 6: Final Verification and Commit

**Files:**
- All files touched by Tasks 1-5

- [ ] **Step 1: Run tests**

Run: `npm test`

Expected: all server tests pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run lint`

Expected: TypeScript passes.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: Vite build succeeds.

- [ ] **Step 4: Inspect git diff**

Run: `git status --short` and `git diff --stat`

Expected: only admin dashboard, analytics, tests, env example, and package script changes are present.

- [ ] **Step 5: Commit implementation**

Run:

```bash
git add .env.example package.json package-lock.json server src tests docs/superpowers/plans/2026-04-29-admin-dashboard.md
git commit -m "feat: add private admin analytics dashboard"
```
