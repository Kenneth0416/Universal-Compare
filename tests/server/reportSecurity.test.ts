import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createFeaturedStore } from '../../server/featured';
import { createReportStore, toPublicReportDto } from '../../server/reports';

export function comparisonResult(itemA = 'Alpha', itemB = 'Beta') {
  return {
    entityA: { name: itemA, normalized_name: 'alpha', category: 'tool', subcategory: 'test', likely_domain: '', short_definition: 'Alpha definition' },
    entityB: { name: itemB, normalized_name: 'beta', category: 'tool', subcategory: 'test', likely_domain: '', short_definition: 'Beta definition' },
    relationship: { relationship_type: 'alternatives', comparison_goal: 'Choose one', can_directly_compare: true, reasoning: 'They overlap.' },
    dimensions: Array.from({ length: 4 }, (_, index) => ({
      key: `dimension-${index}`,
      label: `Dimension ${index}`,
      why_it_matters: 'It matters.',
      comparison_angle: 'Compare directly.',
      analysis: {
        item_a_summary: 'Alpha summary.',
        item_b_summary: 'Beta summary.',
        key_difference: 'A useful difference.',
        better_for: 'Both',
        optional_score_a: 8,
        optional_score_b: 7,
        citations: [{ url: 'https://example.com/reference', title: 'Reference' }],
      },
    })),
    prosCons: { item_a_pros: ['Fast'], item_a_cons: ['Cost'], item_b_pros: ['Simple'], item_b_cons: ['Limited'] },
    recommendation: {
      best_for_a: ['Teams'], best_for_b: ['Individuals'], which_to_choose_first: 'Choose based on fit.',
      when_not_to_compare_directly: '', short_verdict: 'Both are useful.', long_verdict: 'Choose the one matching the workflow.',
    },
    sources: [{ url: 'https://example.com/source', title: 'Source' }],
  };
}

test('report writes fail closed for malformed nested values and unsafe URLs', () => {
  const db = new Database(':memory:');
  const store = createReportStore(db);
  const unsafe = comparisonResult();
  unsafe.sources[0].url = 'javascript:alert(1)';
  assert.equal(store.saveReport({ itemA: 'A', itemB: 'B', language: 'en', result: unsafe }), null);

  const badScore = comparisonResult();
  badScore.dimensions[0].analysis.optional_score_a = 11;
  assert.equal(store.saveReport({ itemA: 'A', itemB: 'B', language: 'en', result: badScore }), null);

  const tooFew = comparisonResult();
  tooFew.dimensions.length = 3;
  assert.equal(store.saveReport({ itemA: 'A', itemB: 'B', language: 'en', result: tooFew }), null);

  const missingAnalysisFields = comparisonResult() as any;
  for (const dimension of missingAnalysisFields.dimensions) {
    delete dimension.analysis.optional_score_a;
    delete dimension.analysis.optional_score_b;
    delete dimension.analysis.citations;
  }
  assert.equal(
    store.saveReport({ itemA: 'A', itemB: 'B', language: 'en', result: missingAnalysisFields }),
    null,
  );
  db.close();
});

test('run ids are unique and idempotently return the original report', () => {
  const db = new Database(':memory:');
  const store = createReportStore(db);
  const first = store.saveReport({ runId: 'same-run', itemA: 'A', itemB: 'B', language: 'en', result: comparisonResult() });
  const second = store.saveReport({ runId: 'same-run', itemA: 'Changed', itemB: 'Values', language: 'en', result: comparisonResult('Changed', 'Values') });
  assert.ok(first);
  assert.deepEqual(second, first);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM comparison_reports').get().count, 1);
  db.close();
});

test('duplicate run-id migration preserves reports and chooses one canonical id', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE comparison_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, report_id TEXT NOT NULL UNIQUE, run_id TEXT,
    item_a TEXT NOT NULL, item_b TEXT NOT NULL, language TEXT NOT NULL,
    result_json TEXT NOT NULL, visitor_id TEXT NOT NULL, created_at TEXT NOT NULL,
    view_count INTEGER NOT NULL DEFAULT 0
  )`);
  const json = JSON.stringify(comparisonResult());
  const insert = db.prepare('INSERT INTO comparison_reports (report_id, run_id, item_a, item_b, language, result_json, visitor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insert.run('Rpt-first', 'duplicate', 'A', 'B', 'en', json, '', '2025-01-01T00:00:00.000Z');
  insert.run('Rpt-second', 'duplicate', 'A', 'B', 'en', json, '', '2025-01-02T00:00:00.000Z');
  const store = createReportStore(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM comparison_reports').get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM comparison_reports WHERE run_id = 'duplicate'").get().count, 1);
  assert.equal(store.saveReport({ runId: 'duplicate', itemA: 'A', itemB: 'B', language: 'en', result: comparisonResult() })?.reportId, 'Rpt-first');
  db.close();
});

test('featured links and feedback cannot outlive their report', () => {
  const db = new Database(':memory:');
  const reports = createReportStore(db);
  const featured = createFeaturedStore(db);
  assert.throws(() => featured.addFeatured('Missing', 'Report', { reportId: 'Rpt-missing' }));

  const saved = reports.saveReport({ itemA: 'A', itemB: 'B', language: 'en', result: comparisonResult(), visitorId: 'private' });
  assert.ok(saved);
  const linked = featured.addFeatured('A', 'B', { reportId: saved.reportId });
  reports.submitFeedback(saved.reportId, 'visitor', true);
  assert.equal(featured.updateReportId(linked.id, 'Rpt-missing'), false);
  assert.equal(reports.deleteReport(saved.reportId), true);
  assert.equal(featured.getFeaturedBySlug(linked.slug), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM report_feedback').get().count, 0);
  db.close();
});

test('featured creation reuses an existing SQLite transaction', () => {
  const db = new Database(':memory:');
  const reports = createReportStore(db);
  const featured = createFeaturedStore(db);
  const saved = reports.saveReport({ itemA: 'A', itemB: 'B', language: 'en', result: comparisonResult() });
  assert.ok(saved);

  const createInsideTransaction = db.transaction(() =>
    featured.addFeatured('A', 'B', { reportId: saved.reportId }));
  const created = createInsideTransaction();
  assert.equal(created.reportId, saved.reportId);
  db.close();
});

test('public report DTO omits internal visitor and run identifiers', () => {
  const db = new Database(':memory:');
  const store = createReportStore(db);
  const saved = store.saveReport({ runId: 'private-run', itemA: 'A', itemB: 'B', language: 'en', result: comparisonResult(), visitorId: 'private-visitor' });
  assert.ok(saved);
  const report = store.getReport(saved.reportId);
  assert.ok(report);
  const dto = toPublicReportDto(report);
  assert.equal('runId' in dto, false);
  assert.equal('visitorId' in dto, false);
  assert.equal(store.getReport(saved.reportId)?.runId, 'private-run');
  db.close();
});
