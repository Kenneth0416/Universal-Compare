/**
 * Finds featured_comparisons rows that describe the same comparison under a
 * different spelling ("Z Fold 8" vs "Z Fold8") and unpublishes the extras.
 *
 * Dry-run by default; pass --apply to delete. Only the featured row is deleted,
 * never its comparison_reports row: the report may still be linked from history
 * or shared URLs, and dropping the featured row is enough to take the duplicate
 * /compare/<slug> page down.
 *
 *   npx tsx scripts/dedupe-featured.ts [--apply]
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import path from 'node:path';
import Database from 'better-sqlite3';
import { createFeaturedStore, type FeaturedComparison } from '../server/featured';

const APPLY = process.argv.includes('--apply');

function log(message: string) {
  console.log(`[dedupe-featured ${new Date().toISOString()}] ${message}`);
}

// Copy of normalizePairKey in server/jobs/autoPublish.ts (importing that module
// would run the daily job). Keep the two in sync.
function normalizePairKey(itemA: string, itemB: string): string {
  const normalize = (value: string) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return [normalize(itemA), normalize(itemB)].sort().join('|');
}

function describe(item: FeaturedComparison): string {
  const slug = (item.slug || '(no slug)').padEnd(52);
  const views = String(item.viewCount ?? 0).padStart(6);
  return `#${String(item.id).padStart(5)}  ${slug} views=${views}  report=${item.reportId || '-'}`;
}

function main() {
  const dbPath = process.env.ANALYTICS_DB_PATH || path.resolve(process.cwd(), 'server', 'compareai-analytics.db');
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 10000');
  const featuredStore = createFeaturedStore(db as any);

  const groups = new Map<string, FeaturedComparison[]>();
  for (const item of featuredStore.listFeatured()) {
    // Same pair in another language is a legitimate separate page.
    const key = `${item.language || 'en'}::${normalizePairKey(item.itemA, item.itemB)}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  const duplicateGroups = [...groups.entries()].filter(([, items]) => items.length > 1);
  log(`db=${dbPath} groups=${groups.size} duplicateGroups=${duplicateGroups.length} mode=${APPLY ? 'APPLY' : 'dry-run'}`);
  if (duplicateGroups.length === 0) {
    log('no duplicate featured rows found.');
    return;
  }

  let removable = 0;
  let removed = 0;
  for (const [key, items] of duplicateGroups) {
    // Keeper: most viewed, then the one that actually has a report, then oldest.
    const ranked = [...items].sort((left, right) =>
      (right.viewCount ?? 0) - (left.viewCount ?? 0)
      || Number(!!right.reportId) - Number(!!left.reportId)
      || left.id - right.id);
    const [keeper, ...losers] = ranked;
    removable += losers.length;

    console.log(`\n${key}`);
    console.log(`  KEEP    ${describe(keeper)}`);
    for (const loser of losers) {
      console.log(`  REMOVE  ${describe(loser)}`);
      if (APPLY && featuredStore.removeFeatured(loser.id)) removed += 1;
    }
  }

  console.log('');
  if (APPLY) log(`removed ${removed}/${removable} duplicate featured rows (reports untouched).`);
  else log(`${removable} featured rows are removable. Re-run with --apply to delete them.`);
}

main();
