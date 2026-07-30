import assert from 'node:assert/strict';
import test from 'node:test';
import { generateOgImage } from '../../server/og';
import { renderReportSeoHtml } from '../../server/seo';

function result(itemA = 'Alpha', itemB = 'Beta'): any {
  return {
    entityA: { name: itemA, normalized_name: 'alpha', category: 'tool', subcategory: 'test', likely_domain: '', short_definition: 'Alpha definition' },
    entityB: { name: itemB, normalized_name: 'beta', category: 'tool', subcategory: 'test', likely_domain: '', short_definition: 'Beta definition' },
    relationship: { relationship_type: 'alternatives', comparison_goal: 'Choose one', can_directly_compare: true, reasoning: 'They overlap.' },
    dimensions: Array.from({ length: 4 }, (_, index) => ({
      key: `dimension-${index}`, label: `Dimension ${index}`, why_it_matters: 'It matters.', comparison_angle: 'Compare directly.',
      analysis: {
        item_a_summary: 'Alpha summary.', item_b_summary: 'Beta summary.', key_difference: 'A useful difference.',
        better_for: 'Both', optional_score_a: 8, optional_score_b: 7,
        citations: [{ url: 'https://example.com/reference', title: 'Reference' }],
      },
    })),
    prosCons: { item_a_pros: ['Fast'], item_a_cons: ['Cost'], item_b_pros: ['Simple'], item_b_cons: ['Limited'] },
    recommendation: {
      best_for_a: ['Teams'], best_for_b: ['Individuals'], which_to_choose_first: 'Choose based on fit.',
      when_not_to_compare_directly: '', short_verdict: 'Both are useful.', long_verdict: 'Choose based on fit.',
    },
    sources: [{ url: 'https://example.com/source', title: 'Source' }],
  };
}

function report(reportResult: any, language = 'en'): any {
  return {
    reportId: 'Rpt-test', runId: 'private-run', itemA: 'Fallback A', itemB: 'Fallback B', language,
    result: reportResult, visitorId: 'private', createdAt: '2025-01-01T00:00:00.000Z', viewCount: 0,
  };
}

const indexHtml = '<!doctype html><html lang="en"><head><title>Old</title></head><body><div id="root"></div></body></html>';

test('report SEO escapes stored entity scripts in HTML, attributes, and JSON-LD', () => {
  const malicious = '</title><script>alert(1)</script><img src=x onerror=alert(2)>';
  const html = renderReportSeoHtml({ report: report(result(malicious, 'Beta'), 'zh-Hant'), featured: null, indexHtml });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;\/title&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /\\u003c\/title>/);
  assert.match(html, /<html lang="zh-Hant">/);
  assert.doesNotMatch(html, /hreflang=/);
  assert.match(html, /"@context":"https:\/\/schema.org","@graph":\[/);
});

test('SEO rejects unsafe source and site URL schemes', () => {
  const unsafe = result();
  unsafe.sources[0].url = 'javascript:alert(1)';
  const html = renderReportSeoHtml({
    report: report(unsafe), featured: null, indexHtml, siteUrl: 'javascript:alert(2)',
  });
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /https:\/\/compare-anythings\.com\/r\/Rpt-test/);
});

test('single-sided scores never render a null score or average the missing side as zero', () => {
  const oneSided = result();
  for (const dimension of oneSided.dimensions) delete dimension.analysis.optional_score_b;
  const html = renderReportSeoHtml({ report: report(oneSided), featured: null, indexHtml });
  assert.match(html, /Alpha scores 8\.0\/10 overall\./);
  assert.doesNotMatch(html, /Beta scores null\/10|null\/10/);
  assert.match(html, /<th>Overall<\/th><th>8\.0\/10<\/th><th>—<\/th>/);
  assert.doesNotMatch(html, /"ratingValue":"4"/);
  assert.match(html, /"ratingValue":"8"/);
});

test('OG rendering probes a usable CJK fallback without breaking generation', async () => {
  const cjkReport = report(result('比較工具甲', '比較工具乙'), 'zh-TW');
  const png = await generateOgImage(
    'cjk-slug',
    { getReport: () => cjkReport } as any,
    { getFeaturedBySlug: () => ({ reportId: 'Rpt-test' }) } as any,
  );
  assert.ok(png);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
});

test('SEO and OG fail safely for malformed stored reports', async () => {
  const malformed = report({ entityA: { name: '<script>x</script>' }, dimensions: 'not-an-array' });
  assert.doesNotThrow(() => renderReportSeoHtml({ report: malformed, featured: null, indexHtml }));
  const png = await generateOgImage(
    'bad-slug',
    { getReport: () => malformed } as any,
    { getFeaturedBySlug: () => ({ reportId: 'Rpt-test' }) } as any,
  );
  assert.equal(png, null);
});
