/**
 * Orphan curator: publishes user-generated reports that never got a
 * featured_comparisons row (and therefore never entered the sitemap).
 *
 * Orphans are the highest-intent pages we own — real shoppers typed those pairs
 * — but the same pool also contains NSFW, private persons, local shops and joke
 * pairs that must never reach the public library. A DeepSeek batch triage sorts
 * them and every verdict is persisted in `report_curation`, so:
 *   - a report is triaged at most once (cost control + idempotency), and
 *   - the ~58 reports a human rejected on 2026-08-05 stay rejected once their
 *     verdict is recorded by the first run.
 *
 * Dry run is the default and DOES persist verdicts (they are expensive to
 * produce and cheap to reuse); only --apply creates featured rows. An approved
 * verdict left over from a dry run skips the LLM on the next --apply run.
 *
 * Usage:
 *   npx tsx server/jobs/curateOrphans.ts            # dry run, prints verdicts
 *   npx tsx server/jobs/curateOrphans.ts --apply     # publish approved orphans
 *   ORPHAN_CURATION_BATCH=125 npx tsx server/jobs/curateOrphans.ts --apply
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import path from 'node:path';
import Database from 'better-sqlite3';
import OpenAI from 'openai';
import { createFeaturedStore } from '../featured';

type DatabaseConnection = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number };
    get: (...params: unknown[]) => any;
    all: (...params: unknown[]) => any[];
  };
};

type FeaturedStore = ReturnType<typeof createFeaturedStore>;

type OrphanReport = {
  reportId: string;
  itemA: string;
  itemB: string;
  language: string;
  createdAt: string;
  excerpt: string;
  verdict: 'approved' | null;
};

export type OrphanCurationOptions = {
  db: DatabaseConnection;
  featuredStore: FeaturedStore;
  deepseekClient?: OpenAI;
  deepseekModel?: string;
  /** false (default) = dry run: verdicts are stored, nothing is published. */
  apply?: boolean;
  /** Max orphans handled per run; defaults to ORPHAN_CURATION_BATCH. */
  limit?: number;
  log?: (message: string) => void;
};

export type OrphanCurationSummary = {
  scanned: number;
  alreadyJudged: number;
  preApproved: number;
  approved: number;
  rejected: number;
  published: number;
  failed: number;
  publishedSlugs: string[];
};

const SITE_URL = process.env.SITE_URL || 'https://compare-anythings.com';
const LLM_BATCH_SIZE = 25;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function log(message: string) {
  console.log(`[curate-orphans ${new Date().toISOString()}] ${message}`);
}

function isoNow() {
  return new Date().toISOString();
}

function ensureCurationTable(db: DatabaseConnection) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS report_curation (
      report_id  TEXT PRIMARY KEY,
      verdict    TEXT NOT NULL CHECK (verdict IN ('approved', 'rejected')),
      reason     TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
}

/**
 * Cheap excerpt for triage context. The stored result is the normalized
 * comparison JSON; only the short verdict and category are pulled out, so a
 * malformed or oversized blob degrades to title-level judgment instead of
 * failing the run.
 */
function readExcerpt(resultJson: unknown): string {
  if (typeof resultJson !== 'string' || resultJson.length === 0) return '';
  try {
    const parsed = JSON.parse(resultJson) as any;
    const parts = [parsed?.entityA?.category, parsed?.recommendation?.short_verdict]
      .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0);
    return parts.join(' | ').replace(/\s+/g, ' ').trim().slice(0, 240);
  } catch {
    return '';
  }
}

const TRIAGE_RULES = `REJECT (be strict, reject when uncertain):
- NSFW, sexual, or otherwise adult content
- private individuals or personal names that are not public figures
- local shops, restaurants, clinics, schools, agencies, or other one-city services
- joke, troll, or nonsense pairs; placeholder or test text ("test", "aaa", "abc vs def")
- anything that is not two comparable real things (e.g. a product vs a feeling, or one thing typed twice)
- pairs that are unintelligible or that no stranger would ever search for

APPROVE only clear cases:
- real products, models, or SKUs (any brand, any country)
- brands, companies, media titles, games, public technologies, standards
- widely used concepts, methods, or materials with plausible search demand`;

async function triageBatch(
  client: OpenAI,
  model: string,
  batch: OrphanReport[],
): Promise<Map<string, { verdict: 'approved' | 'rejected'; reason: string }>> {
  const verdicts = new Map<string, { verdict: 'approved' | 'rejected'; reason: string }>();
  const listing = batch
    .map((report, index) => {
      const excerpt = report.excerpt ? ` | excerpt: ${report.excerpt}` : '';
      return `${index}: A="${report.itemA}" B="${report.itemB}" (lang: ${report.language})${excerpt}`;
    })
    .join('\n');

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `You are the safety and quality gate for a public comparison website. Each item below is a user-generated "A vs B" report we may publish to Google. Decide for EACH item whether it is publishable.\n\n${TRIAGE_RULES}\n\nReturn JSON: {"verdicts": [{"idx": number, "verdict": "approved" | "rejected", "reason": string}]}. Include every idx exactly once. "reason" must be at most 8 words.\n\nITEMS:\n${listing}`,
    }],
  }, { signal: AbortSignal.timeout(120_000) });

  const raw = completion.choices?.[0]?.message?.content || '{}';
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return verdicts;
  }
  const rows = Array.isArray(parsed?.verdicts) ? parsed.verdicts : [];
  for (const row of rows) {
    const index = Number(row?.idx);
    const report = Number.isInteger(index) ? batch[index] : undefined;
    if (!report) continue;
    const verdict = row?.verdict === 'approved' ? 'approved' : 'rejected';
    const reason = String(row?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'no reason given';
    verdicts.set(report.reportId, { verdict, reason });
  }
  return verdicts;
}

// --- IndexNow (same contract as autoPublish) ---

async function pingIndexNow(slugs: string[], logger: (message: string) => void) {
  const key = process.env.INDEXNOW_KEY;
  if (!key || slugs.length === 0) return;
  const host = new URL(SITE_URL).hostname;
  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${SITE_URL}/indexnow-key.txt`,
        urlList: slugs.map((slug) => `${SITE_URL}/compare/${slug}`),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    logger(`indexnow: submitted ${slugs.length} urls -> ${response.status}`);
  } catch (err: any) {
    logger(`indexnow: ping failed: ${err?.message || err}`);
  }
}

// --- Main routine (exported for the daily orchestrator) ---

export async function runOrphanCuration(options: OrphanCurationOptions): Promise<OrphanCurationSummary> {
  const logger = options.log || log;
  const apply = options.apply === true;
  const limit = Math.min(Math.max(Math.floor(options.limit ?? envInt('ORPHAN_CURATION_BATCH', 40, 1, 1_000)), 1), 1_000);
  const model = options.deepseekModel || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  const client = options.deepseekClient
    || (process.env.DEEPSEEK_API_KEY
      ? new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' })
      : undefined);
  if (!client) throw new Error('DEEPSEEK_API_KEY is required for orphan curation');

  const { db, featuredStore } = options;
  ensureCurationTable(db);

  const summary: OrphanCurationSummary = {
    scanned: 0,
    alreadyJudged: 0,
    preApproved: 0,
    approved: 0,
    rejected: 0,
    published: 0,
    failed: 0,
    publishedSlugs: [],
  };

  const orphanFilter = `
    FROM comparison_reports r
    WHERE NOT EXISTS (SELECT 1 FROM featured_comparisons f WHERE f.report_id = r.report_id)
  `;
  const totalOrphans = (db.prepare(`SELECT COUNT(*) AS c ${orphanFilter}`).get() as { c: number }).c;
  summary.alreadyJudged = (db.prepare(`
    SELECT COUNT(*) AS c ${orphanFilter}
      AND EXISTS (SELECT 1 FROM report_curation cu WHERE cu.report_id = r.report_id AND cu.verdict = 'rejected')
  `).get() as { c: number }).c;

  // Rejected verdicts are terminal; approved ones survive a dry run and go
  // straight to publishing without a second LLM call.
  const rows = db.prepare(`
    SELECT r.report_id AS reportId, r.item_a AS itemA, r.item_b AS itemB, r.language AS language,
           r.created_at AS createdAt, r.result_json AS resultJson,
           (SELECT cu.verdict FROM report_curation cu WHERE cu.report_id = r.report_id) AS verdict
    ${orphanFilter}
      AND NOT EXISTS (
        SELECT 1 FROM report_curation cu WHERE cu.report_id = r.report_id AND cu.verdict = 'rejected'
      )
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(limit) as any[];

  const reports: OrphanReport[] = rows.map((row) => ({
    reportId: row.reportId,
    itemA: String(row.itemA || '').trim(),
    itemB: String(row.itemB || '').trim(),
    language: String(row.language || 'en'),
    createdAt: row.createdAt,
    excerpt: readExcerpt(row.resultJson),
    verdict: row.verdict === 'approved' ? 'approved' : null,
  }));
  summary.scanned = reports.length;

  logger(`orphans=${totalOrphans} alreadyRejected=${summary.alreadyJudged} batch=${reports.length} mode=${apply ? 'APPLY' : 'DRY-RUN'} model=${model}`);
  if (reports.length === 0) {
    logger('nothing to curate.');
    return summary;
  }

  const recordVerdict = db.prepare(`
    INSERT INTO report_curation (report_id, verdict, reason, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(report_id) DO UPDATE SET verdict = excluded.verdict, reason = excluded.reason, created_at = excluded.created_at
  `);
  const saveVerdict = (reportId: string, verdict: 'approved' | 'rejected', reason: string) => {
    try {
      recordVerdict.run(reportId, verdict, reason, isoNow());
    } catch (err: any) {
      logger(`WARN: could not store verdict for ${reportId}: ${err?.message || err}`);
    }
  };

  // Cheap local pre-filter: a pair already featured would only create a
  // duplicate slug competing with itself in search. Match on the normalized
  // pair key (same rule as autoPublish.normalizePairKey — not imported because
  // importing autoPublish executes its main()): spacing/casing/punctuation and
  // side order are ignored, so "Z Fold 8" collides with "Z Fold8". Keys are
  // language-scoped: the same pair in another language is a separate page.
  const normalizePair = (itemA: string, itemB: string) => {
    const normalize = (value: string) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return [normalize(itemA), normalize(itemB)].sort().join('|');
  };
  const featuredKeys = new Set<string>(
    (db.prepare('SELECT item_a AS itemA, item_b AS itemB, language FROM featured_comparisons').all() as Array<{ itemA: string; itemB: string; language: string }>)
      .map((row) => `${row.language || 'en'}::${normalizePair(row.itemA, row.itemB)}`),
  );
  const pairAlreadyFeatured = (report: OrphanReport) =>
    featuredKeys.has(`${report.language || 'en'}::${normalizePair(report.itemA, report.itemB)}`);

  const needsTriage: OrphanReport[] = [];
  const approvedReports: OrphanReport[] = [];
  for (const report of reports) {
    if (!report.itemA || !report.itemB) {
      summary.rejected += 1;
      saveVerdict(report.reportId, 'rejected', 'empty item name');
      logger(`REJECT ${report.reportId}: "${report.itemA}" vs "${report.itemB}" — empty item name`);
      continue;
    }
    if (pairAlreadyFeatured(report)) {
      summary.rejected += 1;
      saveVerdict(report.reportId, 'rejected', 'duplicate-of-featured-pair');
      logger(`REJECT ${report.reportId}: ${report.itemA} vs ${report.itemB} — duplicate-of-featured-pair`);
      continue;
    }
    if (report.verdict === 'approved') {
      summary.preApproved += 1;
      approvedReports.push(report);
      continue;
    }
    needsTriage.push(report);
  }
  if (summary.preApproved > 0) logger(`${summary.preApproved} report(s) carry an approved verdict from an earlier run; skipping triage for them`);

  // A failed batch leaves its reports unjudged so the next run retries them.
  for (let index = 0; index < needsTriage.length; index += LLM_BATCH_SIZE) {
    const batch = needsTriage.slice(index, index + LLM_BATCH_SIZE);
    let verdicts: Map<string, { verdict: 'approved' | 'rejected'; reason: string }>;
    try {
      verdicts = await triageBatch(client, model, batch);
    } catch (err: any) {
      logger(`triage batch ${index / LLM_BATCH_SIZE + 1} failed: ${err?.message || err}`);
      continue;
    }
    if (verdicts.size === 0) {
      logger(`triage batch ${index / LLM_BATCH_SIZE + 1} returned no usable verdicts; reports stay unjudged`);
      continue;
    }
    for (const report of batch) {
      const decision = verdicts.get(report.reportId);
      if (!decision) {
        logger(`SKIP ${report.reportId}: ${report.itemA} vs ${report.itemB} — no verdict returned, retry next run`);
        continue;
      }
      saveVerdict(report.reportId, decision.verdict, decision.reason);
      if (decision.verdict === 'approved') {
        summary.approved += 1;
        approvedReports.push(report);
        logger(`APPROVE ${report.reportId}: ${report.itemA} vs ${report.itemB} — ${decision.reason}`);
      } else {
        summary.rejected += 1;
        logger(`REJECT ${report.reportId}: ${report.itemA} vs ${report.itemB} — ${decision.reason}`);
      }
    }
  }

  if (!apply) {
    logger(`DRY-RUN: would publish ${approvedReports.length} report(s): ${approvedReports.map((r) => `${r.itemA} vs ${r.itemB}`).join('; ') || '(none)'}`);
    logger(`dry run complete: scanned=${summary.scanned} preApproved=${summary.preApproved} approved=${summary.approved} rejected=${summary.rejected}. Re-run with --apply to publish.`);
    return summary;
  }

  for (const report of approvedReports) {
    const label = `${report.itemA} vs ${report.itemB}`;
    let featuredId: number | null = null;
    try {
      const featured = featuredStore.addFeatured(report.itemA, report.itemB, { language: report.language || 'en' });
      featuredId = featured.id;
      if (!featuredStore.updateReportId(featured.id, report.reportId)) {
        throw new Error(`updateReportId failed for featured #${featured.id}`);
      }
      summary.published += 1;
      summary.publishedSlugs.push(featured.slug);
      logger(`published: ${label} -> ${report.reportId} (/compare/${featured.slug})`);
    } catch (err: any) {
      summary.failed += 1;
      // The featured row would otherwise sit report-less and make autoPublish
      // regenerate a report we already have.
      if (featuredId !== null) {
        try { featuredStore.removeFeatured(featuredId); } catch { /* leave it for manual cleanup */ }
      }
      saveVerdict(report.reportId, 'rejected', 'duplicate-or-create-failed');
      logger(`FAILED: ${label}: ${err?.message || err} (marked rejected: duplicate-or-create-failed)`);
    }
  }

  await pingIndexNow(summary.publishedSlugs, logger);

  logger(`run complete: scanned=${summary.scanned} alreadyRejected=${summary.alreadyJudged} preApproved=${summary.preApproved} approved=${summary.approved} rejected=${summary.rejected} published=${summary.published} failed=${summary.failed}`);
  const remaining = (db.prepare(`
    SELECT COUNT(*) AS c ${orphanFilter}
      AND NOT EXISTS (SELECT 1 FROM report_curation cu WHERE cu.report_id = r.report_id AND cu.verdict = 'rejected')
  `).get() as { c: number }).c;
  if (remaining > 0) logger(`${remaining} orphan(s) still pending; re-run or raise ORPHAN_CURATION_BATCH (current ${limit}).`);
  return summary;
}

// --- CLI ---

async function main() {
  const apply = process.argv.includes('--apply');
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;

  if (!process.env.DEEPSEEK_API_KEY) {
    log('DEEPSEEK_API_KEY is not set; aborting (triage cannot run).');
    process.exitCode = 1;
    return;
  }

  const dbPath = process.env.ANALYTICS_DB_PATH || path.resolve(process.cwd(), 'server', 'compareai-analytics.db');
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 10000');
  const featuredStore = createFeaturedStore(db as any);

  await runOrphanCuration({
    db: db as any,
    featuredStore,
    apply,
    limit: Number.isFinite(limit as number) ? limit : undefined,
    log,
  });
}

// Only auto-run as a CLI; importing the module for the orchestrator must not
// start a run.
if (process.argv[1] && process.argv[1].includes('curateOrphans')) {
  main().catch((err) => {
    log(`fatal: ${err?.stack || err}`);
    process.exitCode = 1;
  });
}
