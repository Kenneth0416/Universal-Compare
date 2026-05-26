# Bulk Featured MVP Design

**Date**: 2026-05-26
**Status**: Approved, ready for implementation plan
**Builds on**: `2026-05-26-demand-sensing-design.md` (Phase 0)

## Problem

After Phase 0 demand sensing, admin can score candidate pairs but only one at a time via the existing "Check Demand" UI. To scale featured comparisons (the SEO/GEO surface area), admin needs:

- A way to bulk-source candidate pairs (entity matrix)
- A way to bulk-score them via Phase 0
- A way to bulk-promote the high-scoring ones into `featured_comparisons`

Single-add and single-preflight remain unchanged. This MVP adds a parallel batch workflow.

## Goal

10x admin throughput. From "one pair at a time" to "import 20 entities → see 190 candidate pairs → bulk preflight top 20 → bulk promote 10 to featured" in ~5 minutes of human time.

## Decisions locked

- **Pair source**: Entity matrix — admin adds entities (with category), system auto-generates all intra-category combinations
- **Bulk add behavior**: DB-only — `bulk-promote` writes to `featured_comparisons` with `reportId=null`. Does NOT trigger Phase 1-4 generation. Admin uses existing per-row "Generate" button afterwards
- **Data model**: Two new tables (`entity_pool`, `candidate_pairs`) with persisted demand scores
- **Concurrency**: Bulk preflight runs 5 Phase 0 calls in parallel (reuses existing `mapConcurrent`)
- **Max batch size**: 50 pairs per bulk-preflight or bulk-promote request
- **UI placement**: New tab "Pool" alongside existing tabs (separate from Featured tab)
- **No frontend tests**: backend tests cover correctness; UI is human-verified
- **No streaming progress**: bulk-preflight UI shows a spinner until response returns (~1-3 min for full batch); admin can navigate away and return

## Architecture

```
Admin UI (new "Pool" tab)
   │
   ├─ Entity management
   │     POST   /api/admin/entities          (single add)
   │     POST   /api/admin/entities/bulk     (CSV import)
   │     GET    /api/admin/entities?category=X
   │     DELETE /api/admin/entities/:id
   │
   ├─ Candidate query + sync
   │     POST   /api/admin/candidates/sync         (generate pairs)
   │     GET    /api/admin/candidates?category=X&status=Y&minScore=N
   │
   ├─ Bulk preflight (concurrent demand sensing)
   │     POST   /api/admin/candidates/bulk-preflight
   │             body: { pairIds: number[], language: string }
   │             ↓ mapConcurrent(pairs, 5, demandSensing.scorePair)
   │             ↓ writes demand_score / signals / topSources / last_scored_at
   │             returns: { results: BulkPreflightItemResult[] }
   │
   └─ Bulk promote (DB-only)
         POST   /api/admin/candidates/bulk-promote
                 body: { pairIds: number[], language: string, description?: string }
                 ↓ for each: featuredStore.addFeatured(...)
                 ↓ candidateStore.markPromoted(id)
                 returns: { promoted: FeaturedComparison[], skipped: SkippedItem[] }
```

### Why a new tab

Featured tab already manages "decided" featured items. Pool tab manages "exploration" — candidates being scored, promoted, rejected. Clear separation of admin mental models.

### Why not extend Phase 0's existing `/preflight` endpoint to accept arrays

Phase 0's endpoint is a thin wrapper around `DemandSensingService.scorePair`. Bulk preflight adds: concurrency control, candidate_pairs persistence, error aggregation across items. Different responsibilities, different endpoint.

## Components

### New: `server/entityPool.ts`

```typescript
export type Entity = {
  id: number;
  name: string;
  category: string;
  createdAt: string;
};

export function createEntityPoolStore(db: DatabaseConnection) {
  // schema:
  //   CREATE TABLE entity_pool (
  //     id        INTEGER PRIMARY KEY AUTOINCREMENT,
  //     name      TEXT NOT NULL,
  //     category  TEXT NOT NULL,
  //     created_at TEXT NOT NULL,
  //     UNIQUE(name, category)
  //   )
  //   CREATE INDEX idx_entity_category ON entity_pool(category)

  return {
    listEntities(category?: string): Entity[],
    addEntity(name: string, category: string): Entity,
    addEntitiesBulk(items: Array<{name: string, category: string}>): {
      added: Entity[],
      skipped: Array<{ name: string, category: string, reason: 'duplicate' | 'invalid' }>,
    },
    removeEntity(id: number): boolean,
    listCategories(): string[],
  };
}

export function parseEntityCsv(csv: string): {
  items: Array<{ name: string; category: string }>;
  rejectedRows: number;
};
```

CSV parser rules:
- Header row auto-detected if first row contains "name" or "category"
- Empty lines skipped
- Each row split by comma, trimmed
- Require both `name` and `category` non-empty
- name length ≤ 200, category length ≤ 100
- Columns beyond 2 ignored

### New: `server/candidatePairs.ts`

```typescript
export type CandidatePairStatus = 'pending' | 'scored' | 'promoted' | 'rejected';

export type CandidatePair = {
  id: number;
  entityAId: number;
  entityBId: number;
  itemAName: string;          // cached
  itemBName: string;          // cached
  category: string;
  status: CandidatePairStatus;
  demandScore: number | null;
  recommendation: string | null;
  signalsJson: string | null;
  reasoning: string | null;
  topSourcesJson: string | null;
  partial: boolean;
  lastScoredAt: string | null;
  createdAt: string;
};

export function createCandidatePairStore(
  db: DatabaseConnection,
  options: { featuredStore: FeaturedStore; entityStore: EntityPoolStore },
) {
  // schema:
  //   CREATE TABLE candidate_pairs (
  //     id              INTEGER PRIMARY KEY AUTOINCREMENT,
  //     entity_a_id     INTEGER NOT NULL,
  //     entity_b_id     INTEGER NOT NULL,
  //     item_a_name     TEXT NOT NULL,
  //     item_b_name     TEXT NOT NULL,
  //     category        TEXT NOT NULL,
  //     status          TEXT NOT NULL DEFAULT 'pending',
  //     demand_score    REAL,
  //     recommendation  TEXT,
  //     signals_json    TEXT,
  //     reasoning       TEXT,
  //     top_sources_json TEXT,
  //     partial         INTEGER NOT NULL DEFAULT 0,
  //     last_scored_at  TEXT,
  //     created_at      TEXT NOT NULL,
  //     UNIQUE(entity_a_id, entity_b_id),
  //     CHECK(entity_a_id < entity_b_id)
  //   )
  //   CREATE INDEX idx_candidate_status_category ON candidate_pairs(status, category)
  //   CREATE INDEX idx_candidate_score ON candidate_pairs(demand_score)

  return {
    syncFromEntityPool(category?: string): { created: number; total: number },
    listCandidates(opts: {
      category?: string;
      status?: CandidatePairStatus;
      minScore?: number;
      limit?: number;
      offset?: number;
    }): { items: CandidatePair[]; total: number },
    getCandidate(id: number): CandidatePair | null,
    updateScore(id: number, result: DemandSenseResult): void,
    markPromoted(id: number): boolean,   // returns true if changed (idempotent)
    markRejected(id: number): boolean,
  };
}
```

### Modified: `server/app.ts`

Add 8 new endpoints (all behind existing `requireAdmin` middleware):

```
POST   /api/admin/entities
POST   /api/admin/entities/bulk
GET    /api/admin/entities
DELETE /api/admin/entities/:id
POST   /api/admin/candidates/sync
GET    /api/admin/candidates
POST   /api/admin/candidates/bulk-preflight
POST   /api/admin/candidates/bulk-promote
```

Extend `CreateAppOptions`:

```typescript
type CreateAppOptions = {
  // ... existing
  entityStore: ReturnType<typeof createEntityPoolStore>;
  candidateStore: ReturnType<typeof createCandidatePairStore>;
};
```

### Modified: `server/index.ts`

Instantiate both stores. Pass to `createApp`.

### Modified: `src/admin/AdminApp.tsx`

Add a new tab "Pool" with three stacked sections:
1. **Entity Pool**: filter by category, add single, import CSV, table of entities
2. **Candidate Pairs**: filter by category/status/minScore, table with checkbox-per-row showing itemA vs itemB + score badge + signal summary + reasoning tooltip
3. **Bulk actions bar**: `[Bulk Preflight Selected]` `[Bulk Promote Selected]` with count

### Modified: `src/admin/adminApi.ts`

8 new client functions matching endpoints.

### Modified: `src/admin/types.ts`

```typescript
export type Entity = { id: number; name: string; category: string; createdAt: string };
export type CandidatePair = { ...full type mirroring backend... };
export type BulkPreflightItemResult =
  | { id: number; status: 'scored'; result: DemandSenseResult }
  | { id: number; status: 'error'; error: string };
export type BulkPromoteResult = {
  promoted: FeaturedComparison[];
  skipped: Array<{ candidateId: number; reason: 'already_promoted' | 'not_found' | 'create_failed' }>;
};
```

## Data flow

### Admin workflow

```
T0  Admin opens Pool tab
       GET /api/admin/entities → empty
       GET /api/admin/candidates?status=scored → empty

T1  Admin imports CSV (e.g., 8 AI assistant entities)
       POST /api/admin/entities/bulk { csv: "..." }
       → 8 entities created

T2  Admin clicks [Sync from Pool]
       POST /api/admin/candidates/sync { category: "AI Assistant" }
       → 28 candidate pairs created (8 choose 2)

T3  Admin selects 10 candidates, clicks [Bulk Preflight]
       POST /api/admin/candidates/bulk-preflight
         body: { pairIds: [...], language: 'en' }
       → mapConcurrent(pairs, 5, scorePair) → ~1 min
       → candidate_pairs updated with scores
       → response: { results: [...] }

T4  Admin reloads / paginates / returns next day
       GET /api/admin/candidates?status=scored&minScore=6
       → persisted scores returned, no rescoring needed

T5  Admin selects 4 high-scoring candidates, clicks [Bulk Promote]
       POST /api/admin/candidates/bulk-promote
         body: { pairIds: [...], language: 'en' }
       → featuredStore.addFeatured for each
       → candidate.status = 'promoted'
       → response: { promoted: [...], skipped: [...] }

T6  Admin switches to Featured tab
       → sees 4 new rows with reportId=null
       → clicks per-row "Generate" to trigger Phase 1-4 (existing behavior)
```

### Sync algorithm

```typescript
syncFromEntityPool(category?: string) {
  const entities = entityStore.listEntities(category);
  let created = 0;
  let total = 0;

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      if (entities[i].category !== entities[j].category) continue;
      total++;

      const aId = Math.min(entities[i].id, entities[j].id);
      const bId = Math.max(entities[i].id, entities[j].id);
      const aName = aId === entities[i].id ? entities[i].name : entities[j].name;
      const bName = bId === entities[j].id ? entities[j].name : entities[i].name;

      // Skip if already in candidate_pairs
      if (db.prepare('SELECT 1 FROM candidate_pairs WHERE entity_a_id=? AND entity_b_id=?').get(aId, bId)) continue;

      // Skip if already in featured_comparisons (case-insensitive, both orderings)
      const inFeatured = db.prepare(
        `SELECT 1 FROM featured_comparisons
         WHERE (LOWER(item_a)=LOWER(?) AND LOWER(item_b)=LOWER(?))
            OR (LOWER(item_a)=LOWER(?) AND LOWER(item_b)=LOWER(?))`,
      ).get(aName, bName, bName, aName);
      if (inFeatured) continue;

      db.prepare(
        `INSERT INTO candidate_pairs
         (entity_a_id, entity_b_id, item_a_name, item_b_name, category, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      ).run(aId, bId, aName, bName, entities[i].category, new Date().toISOString());
      created++;
    }
  }

  return { created, total };
}
```

### Bulk preflight handler

```typescript
app.post('/api/admin/candidates/bulk-preflight', async (req, res) => {
  if (!demandSensingService) {
    res.status(503).json({ error: 'Demand sensing service is not configured' });
    return;
  }

  const { pairIds, language } = req.body || {};
  if (!Array.isArray(pairIds) || pairIds.length === 0) {
    res.status(400).json({ error: 'pairIds must be a non-empty array' });
    return;
  }
  if (pairIds.length > 50) {
    res.status(400).json({ error: 'pairIds max 50 per batch' });
    return;
  }

  const pairs = pairIds
    .map((id) => candidateStore.getCandidate(Number(id)))
    .filter((p): p is CandidatePair => p !== null && p.status !== 'promoted');

  const results = await mapConcurrent(pairs, 5, async (pair) => {
    try {
      const result = await demandSensingService.scorePair(
        pair.itemAName,
        pair.itemBName,
        typeof language === 'string' ? language : 'en',
      );
      candidateStore.updateScore(pair.id, result);
      return { id: pair.id, status: 'scored' as const, result };
    } catch (err) {
      return { id: pair.id, status: 'error' as const, error: (err as Error).message };
    }
  });

  res.json({ results });
});
```

`mapConcurrent` doesn't exist server-side yet (only in `src/services/apiService.ts` for client use). Add a small helper to `server/app.ts` (top of file or imported from a new tiny `server/concurrency.ts`):

```typescript
// server/concurrency.ts (new file)
export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
```

This preserves input order in the output array. ~15 LOC, standalone, unit-testable.

### Bulk promote handler

```typescript
app.post('/api/admin/candidates/bulk-promote', async (req, res) => {
  const { pairIds, language, description } = req.body || {};
  // ... validation matching bulk-preflight

  const promoted: FeaturedComparison[] = [];
  const skipped: Array<{ candidateId: number; reason: string }> = [];

  for (const id of pairIds.map((x: any) => Number(x))) {
    const pair = candidateStore.getCandidate(id);
    if (!pair) { skipped.push({ candidateId: id, reason: 'not_found' }); continue; }
    if (pair.status === 'promoted') { skipped.push({ candidateId: id, reason: 'already_promoted' }); continue; }

    try {
      const featured = featuredStore.addFeatured(pair.itemAName, pair.itemBName, {
        language: typeof language === 'string' ? language : 'en',
        description: typeof description === 'string' ? description : '',
      });
      candidateStore.markPromoted(id);
      promoted.push(featured);
    } catch (err) {
      skipped.push({ candidateId: id, reason: 'create_failed' });
    }
  }

  res.json({ promoted, skipped });
});
```

### topSources / signals persistence

`updateScore` stores DemandSenseResult fields:
- `demand_score` ← `result.score`
- `recommendation` ← `result.recommendation`
- `signals_json` ← `JSON.stringify(result.signals)`
- `reasoning` ← `result.reasoning`
- `top_sources_json` ← `JSON.stringify(result.topSources)`
- `partial` ← `result.partial ? 1 : 0`
- `last_scored_at` ← `new Date().toISOString()`
- `status` ← `'scored'`

`listCandidates` parses JSON back when reading.

## Error handling

### Failure matrix

| Failure | Handling | HTTP |
|---|---|---|
| **Entity endpoints** | | |
| Empty name or category | reject | 400 |
| Name >200 chars or category >100 chars | reject | 400 |
| Duplicate (name, category) on add | reject with 'duplicate' message | 409 |
| Delete non-existent id | reject | 404 |
| **CSV import** | | |
| Completely invalid CSV (no valid rows) | reject | 400 |
| Mixed valid/invalid rows | accept valid, list rejected | 200 |
| **Candidate sync** | | |
| Empty entity pool | returns `{created:0, total:0}` | 200 |
| **Bulk preflight** | | |
| pairIds not array / empty / >50 | reject | 400 |
| Service not configured | reject | 503 |
| Single pair throw | per-item error in results | 200 |
| All pairs throw | still returns 200 with results array | 200 |
| pairIds includes promoted/missing ids | silently filtered out | 200 |
| **Bulk promote** | | |
| pairIds not array / empty / >50 | reject | 400 |
| Candidate not found | included in `skipped` with reason='not_found' | 200 |
| Already promoted | included in `skipped` with reason='already_promoted' | 200 |
| featuredStore.addFeatured throws | included in `skipped` with reason='create_failed' | 200 |
| **Auth** | | |
| All new endpoints without admin cookie | 401 | 401 |

### Race conditions

| Scenario | Handling |
|---|---|
| Two admins sync simultaneously | UNIQUE constraint on `(entity_a_id, entity_b_id)` prevents duplicates; INSERT failure silently skipped |
| Two admins promote same candidate | `markPromoted` is `UPDATE WHERE status != 'promoted'`; second call returns 0 rows → caller treats as `already_promoted` |
| Admin deletes entity during in-progress preflight | candidate_pairs cached `item_a_name`/`item_b_name`; preflight completes successfully even if entity row gone |

### Frontend UX states

- **Idle**: tables rendered with current data
- **Submitting**: button disabled, spinner replaces icon
- **Loading**: `Loader2` spin animation during fetch
- **Error**: red banner above relevant section with retry button
- **Success toast**: bottom-right ephemeral message ("8 entities added", "28 pairs created", "5 scored", "2 promoted")

## Testing

### Layer 1: Unit tests (mocked)

`tests/server/entityPool.test.ts` — ~8 cases:
- addEntity creates row with timestamp
- addEntity throws on duplicate
- addEntitiesBulk: all valid
- addEntitiesBulk: mix valid + duplicate + invalid
- parseEntityCsv: handles header
- parseEntityCsv: skips empty + trims spaces
- listEntities filters by category
- removeEntity by id (success + 404)

`tests/server/candidatePairs.test.ts` — ~10 cases:
- syncFromEntityPool: empty pool
- syncFromEntityPool: N entities same category → N(N-1)/2 created
- syncFromEntityPool: cross-category entities don't pair
- syncFromEntityPool: idempotent (skips existing candidate_pairs)
- syncFromEntityPool: skips pairs already in featured_comparisons (case-insensitive)
- syncFromEntityPool: canonical ordering (entity_a_id < entity_b_id)
- syncFromEntityPool: caches item_a_name/item_b_name
- updateScore writes full state, transitions status to 'scored'
- markPromoted idempotent (second call returns false)
- listCandidates filters by status + minScore

### Layer 2: Endpoint integration tests

Extend `tests/server/app.test.ts` — ~12 cases:
- All 8 endpoints require admin auth (401)
- POST /entities valid (201)
- POST /entities duplicate (409)
- POST /entities/bulk with CSV → 200 with added/skipped
- GET /entities filtered by category
- DELETE /entities/:id (success + 404)
- POST /candidates/sync → 200 with counts
- GET /candidates with filters
- POST /candidates/bulk-preflight happy path
- POST /candidates/bulk-preflight 503 when service missing
- POST /candidates/bulk-preflight partial failure (mix scored + error)
- POST /candidates/bulk-promote (creates featured + marks candidate)
- POST /candidates/bulk-promote idempotent (skips already-promoted)

Tests mock `demandSensingService` via overrides parameter on `createTestApp`.

### Layer 3: Real API test

New file `tests/server/candidatePairs.real.test.ts` gated by `RUN_REAL_API_TESTS=1`:
- 1 case: bulk-preflight 5 real pairs concurrently. Asserts all return result, total duration < 30s, no race conditions in `candidate_pairs` writes.

Phase 0's existing `demandSensing.real.test.ts` already validates the underlying single-pair scoring. Bulk is a concurrency layer over that.

### Layer 4: Human smoke test

After all TDD cycles:
1. Start dev server
2. Admin login
3. Pool tab → CSV import 8 entities in "AI Assistant" category
4. Click [Sync] → see 28 pending pairs
5. Select 5 pairs → click [Bulk Preflight] → wait ~1 min → scores appear
6. Select 2 high-score pairs → click [Bulk Promote] → toast confirms 2 promoted
7. Featured tab → see 2 new rows with reportId=null
8. Pool tab reload → see status='promoted' on those 2 candidates

## TDD execution plan

8 cycles, each `red test → confirm fail → minimal impl → confirm pass → commit`:

```
Cycle 1: EntityPoolStore (unit)
Cycle 2: CandidatePairStore (unit)
Cycle 3: Entity endpoints (integration)
Cycle 4: Candidate sync + list endpoints (integration)
Cycle 5: Bulk preflight endpoint (integration, mocked Phase 0)
Cycle 6: Bulk promote endpoint (integration)
Cycle 7: Real API test (1 concurrent batch)
Cycle 8: Admin UI Pool tab + manual smoke
```

User has chosen autonomous execution (no per-cycle pause).

## Out of scope (explicitly)

- Cron job for automated background generation
- Quality gate after Phase 1-4 generation (auto-detect thin reports)
- Tier system (Tier 1/2/3 sitemap segmentation)
- GSC API integration / tier auto-promotion based on impressions
- Streaming progress for bulk-preflight (SSE or WebSocket)
- Bulk delete of entities or candidates
- Cross-category pair generation
- Cascade rename when entity name changes (admin must re-sync)
- Modifying Phase 1-4 pipeline or Phase 0 service

## Files touched

| File | Change |
|---|---|
| `server/concurrency.ts` | NEW — `mapConcurrent` helper (server-side, ~15 LOC) |
| `server/entityPool.ts` | NEW — store + CSV parser |
| `server/candidatePairs.ts` | NEW — store with sync logic |
| `tests/server/entityPool.test.ts` | NEW |
| `tests/server/candidatePairs.test.ts` | NEW |
| `tests/server/candidatePairs.real.test.ts` | NEW (gated) |
| `server/app.ts` | ADD 8 endpoints, extend `CreateAppOptions` |
| `server/index.ts` | INSTANTIATE 2 stores, pass to createApp |
| `src/admin/adminApi.ts` | ADD 8 client functions |
| `src/admin/AdminApp.tsx` | ADD "Pool" tab with 3 sections |
| `src/admin/types.ts` | ADD `Entity` / `CandidatePair` / bulk result types |
| `tests/server/app.test.ts` | ADD 12 endpoint test cases |
