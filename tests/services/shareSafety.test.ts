import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPosterArchiveBudget,
  assertPosterExportBudget,
  MAX_POSTER_ARCHIVE_BYTES,
  normalizeHttpUrl,
} from '../../src/services/shareService';

test('normalizeHttpUrl permits only HTTP(S), including safe relative report URLs', () => {
  assert.equal(normalizeHttpUrl('https://example.com/r/one'), 'https://example.com/r/one');
  assert.equal(normalizeHttpUrl('/r/one', 'https://compare.example'), 'https://compare.example/r/one');
  assert.equal(normalizeHttpUrl('javascript:alert(1)', 'https://compare.example'), null);
  assert.equal(normalizeHttpUrl('data:text/html,test'), null);
  assert.equal(normalizeHttpUrl('not a URL'), null);
});

test('poster export rejects excessive canvas and archive budgets', () => {
  assert.doesNotThrow(() => assertPosterExportBudget(540, 720, 2));
  assert.throws(() => assertPosterExportBudget(10_000, 10_000, 2), /POSTER_BUDGET_EXCEEDED/);

  assert.doesNotThrow(() => assertPosterArchiveBudget([{ blob: new Blob(['small']) }]));
  assert.throws(
    () => assertPosterArchiveBudget(Array.from({ length: 8 }, () => ({ blob: new Blob() }))),
    /POSTER_ARCHIVE_BUDGET_EXCEEDED/
  );
  assert.throws(
    () => assertPosterArchiveBudget([{ blob: new Blob([new Uint8Array(MAX_POSTER_ARCHIVE_BYTES + 1)]) }]),
    /POSTER_ARCHIVE_BUDGET_EXCEEDED/
  );
});
