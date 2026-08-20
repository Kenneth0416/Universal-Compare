/**
 * Regenerate the report content of published pages in place (same slug/URL),
 * so pages created before the GEO prompt upgrades (2026-08-05: quotable
 * sentences + concrete statistics) and the citation fix (2026-08-18) get the
 * modern citable treatment that AI search engines quote.
 *
 * The old report row is never deleted: every refresh is logged in
 * report_refresh_log and can be rolled back instantly.
 *
 * Usage (on the server, from /var/www/compare-ai):
 *   npx tsx scripts/refresh-stale-reports.ts <slug> [slug...]     # refresh pages
 *   npx tsx scripts/refresh-stale-reports.ts --rollback <slug>    # restore old report
 *   npx tsx scripts/refresh-stale-reports.ts --list               # show stale candidates
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import path from 'node:path';
import Database from 'better-sqlite3';
import { createFeaturedStore } from '../server/featured';

const API_BASE = process.env.AUTOPUBLISH_API_BASE || 'http://127.0.0.1:3001';
const BATCH_SECRET = process.env.BATCH_INTERNAL_SECRET || '';
// Reports generated before this date predate the GEO prompt upgrades.
const STALE_BEFORE = '2026-08-05';

function log(message: string) {
  console.log(`[refresh-stale ${new Date().toISOString()}] ${message}`);
}

type Source = { url: string; title: string; snippet?: string; proof?: string };

function interleaveValidSources(left: Source[], right: Source[]): Source[] {
  const seen = new Set<string>();
  const balanced: Source[] = [];
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength && balanced.length < 20; index += 1) {
    for (const source of [left[index], right[index]]) {
      if (balanced.length >= 20) break;
      if (!source) continue;
      try {
        const url = new URL(source.url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
        const normalized = url.toString().replace(/\/+$/, '').toLowerCase();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        balanced.push({ ...source, url: url.toString() });
      } catch {
        // skip malformed source URLs
      }
    }
  }
  return balanced;
}

async function apiCall<T>(pathname: string, body: unknown, timeoutMs = 240_000): Promise<T> {
  const delays = [0, 5_000, 15_000];
  let lastError: Error = new Error('unreachable');
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-batch': BATCH_SECRET },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      lastError = new Error(`network error on ${pathname}: ${err?.message || err}`);
      continue;
    }
    if (response.ok) return await response.json() as T;
    const errorBody = await response.json().catch(() => ({})) as { error?: string };
    lastError = new Error(`${pathname} -> ${response.status}: ${errorBody.error || 'unknown'}`);
    if (response.status !== 429 && response.status !== 503 && response.status !== 502) throw lastError;
  }
  throw lastError;
}

async function generateReport(itemA: string, itemB: string, language: string): Promise<string> {
  const [resA, resB] = await Promise.all([
    apiCall<{ profile: any; sources: Source[] }>('/api/ai/phases/researcher', { itemName: itemA, language }),
    apiCall<{ profile: any; sources: Source[] }>('/api/ai/phases/researcher', { itemName: itemB, language }),
  ]);
  const allSources = interleaveValidSources(resA.sources, resB.sources);
  const framework = await apiCall<{ relationship: any; dimensions: any[] }>('/api/ai/phases/architect', {
    profileA: resA.profile, profileB: resB.profile, language,
  });
  const analyzedDimensions: any[] = [];
  for (const dimension of framework.dimensions) {
    analyzedDimensions.push(await apiCall<any>('/api/ai/phases/analyst', {
      profileA: resA.profile, profileB: resB.profile, dimension, sources: allSources, language,
    }));
  }
  const [prosCons, recommendation] = await Promise.all([
    apiCall<any>('/api/ai/phases/pros-cons', {
      profileA: resA.profile, profileB: resB.profile, dimensions: analyzedDimensions, sources: allSources, language,
    }),
    apiCall<any>('/api/ai/phases/recommendation', {
      profileA: resA.profile, profileB: resB.profile, dimensions: analyzedDimensions, sources: allSources, language,
    }),
  ]);
  const result = {
    entityA: resA.profile, entityB: resB.profile, relationship: framework.relationship,
    dimensions: analyzedDimensions, prosCons, recommendation, sources: allSources,
  };
  const { reportToken } = await apiCall<{ reportToken: string }>('/api/ai/phases/finalize', { result, language });
  const saved = await apiCall<{ reportId: string }>('/api/reports', {
    itemA, itemB, language, result: { ...result, reportToken }, reportToken,
  }, 60_000);
  return saved.reportId;
}

async function main() {
  const args = process.argv.slice(2);
  const dbPath = process.env.ANALYTICS_DB_PATH || path.resolve(process.cwd(), 'server', 'compareai-analytics.db');
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 10000');
  const featuredStore = createFeaturedStore(db as any);

  db.exec(`
    CREATE TABLE IF NOT EXISTS report_refresh_log (
      slug TEXT NOT NULL,
      old_report_id TEXT NOT NULL,
      new_report_id TEXT NOT NULL,
      refreshed_at TEXT NOT NULL
    );
  `);

  const staleFeatured = () => db.prepare(`
    SELECT f.id, f.item_a AS itemA, f.item_b AS itemB, f.slug, f.language, f.report_id AS reportId,
           f.view_count AS viewCount, r.created_at AS reportCreatedAt
    FROM featured_comparisons f
    JOIN comparison_reports r ON r.report_id = f.report_id
    WHERE r.created_at < ?
    ORDER BY f.view_count DESC
  `).all(STALE_BEFORE) as Array<{ id: number; itemA: string; itemB: string; slug: string; language: string; reportId: string; viewCount: number; reportCreatedAt: string }>;

  if (args[0] === '--list') {
    for (const row of staleFeatured()) {
      console.log(`${String(row.viewCount).padStart(5)} views | ${row.reportCreatedAt.slice(0, 10)} | ${row.slug}`);
    }
    return;
  }

  if (args[0] === '--rollback') {
    const slug = args[1];
    if (!slug) throw new Error('--rollback needs a slug');
    const entry = db.prepare(
      'SELECT old_report_id AS oldId FROM report_refresh_log WHERE slug = ? ORDER BY refreshed_at DESC LIMIT 1',
    ).get(slug) as { oldId: string } | undefined;
    if (!entry) throw new Error(`no refresh log entry for ${slug}`);
    const featured = featuredStore.listFeatured().find((item) => item.slug === slug);
    if (!featured) throw new Error(`no featured row for ${slug}`);
    if (!featuredStore.updateReportId(featured.id, entry.oldId)) throw new Error('updateReportId failed');
    log(`rolled back ${slug} -> ${entry.oldId}`);
    return;
  }

  if (!BATCH_SECRET) {
    log('BATCH_INTERNAL_SECRET missing; aborting.');
    process.exitCode = 1;
    return;
  }
  if (args.length === 0) {
    log('no slugs given. Use --list to see stale candidates.');
    return;
  }

  for (const slug of args) {
    const featured = featuredStore.listFeatured().find((item) => item.slug === slug);
    if (!featured || !featured.reportId) {
      log(`SKIP ${slug}: no featured row with a report`);
      continue;
    }
    try {
      log(`refreshing ${slug} (${featured.itemA} vs ${featured.itemB})`);
      const newReportId = await generateReport(featured.itemA, featured.itemB, featured.language || 'en');
      db.prepare('INSERT INTO report_refresh_log (slug, old_report_id, new_report_id, refreshed_at) VALUES (?, ?, ?, ?)')
        .run(slug, featured.reportId, newReportId, new Date().toISOString());
      if (!featuredStore.updateReportId(featured.id, newReportId)) throw new Error('updateReportId failed');
      log(`refreshed ${slug}: ${featured.reportId} -> ${newReportId} (old kept for rollback)`);
    } catch (err: any) {
      log(`FAILED ${slug}: ${err?.message || err} (page unchanged)`);
    }
  }
}

main().catch((err) => {
  log(`fatal: ${err?.stack || err}`);
  process.exitCode = 1;
});
