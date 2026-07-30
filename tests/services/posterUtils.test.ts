import assert from 'node:assert/strict';
import test from 'node:test';
import {
  averagePosterScores,
  buildPosterFilename,
  clampPosterText,
  formatPosterScore,
  normalizePosterScore,
  sanitizePosterFilename,
  stableDimensionKeys,
} from '../../src/components/poster/posterUtils';

test('normalizePosterScore rejects invalid values and clamps to the poster scale', () => {
  assert.equal(normalizePosterScore(Number.NaN), null);
  assert.equal(normalizePosterScore(Number.POSITIVE_INFINITY), null);
  assert.equal(normalizePosterScore(undefined), null);
  assert.equal(normalizePosterScore(-4), 0);
  assert.equal(normalizePosterScore(12.5), 10);
  assert.equal(normalizePosterScore(7.25), 7.25);
});

test('averagePosterScores ignores missing scores and formats an empty score safely', () => {
  assert.equal(averagePosterScores([8, Number.NaN, undefined, 12, -2]), 6);
  assert.equal(averagePosterScores([undefined, Number.NaN]), null);
  assert.equal(formatPosterScore(null), '—');
  assert.equal(formatPosterScore(8.25), '8.3');
});

test('clampPosterText normalizes whitespace and preserves a bounded Unicode label', () => {
  assert.equal(clampPosterText('  Alpha   Beta  ', 20), 'Alpha Beta');
  const result = clampPosterText('这是一个非常长的海报维度标题', 8);
  assert.equal(Array.from(result).length, 8);
  assert.ok(result.endsWith('…'));
});

test('stableDimensionKeys remain unique and stable when dimensions are reordered', () => {
  const quality = { key: 'quality', label: 'Quality' };
  const otherQuality = { key: 'quality', label: 'Other quality' };
  const missingKey = { label: 'Quality' };
  const original = stableDimensionKeys([quality, otherQuality, missingKey, {}]);
  const reordered = stableDimensionKeys([missingKey, quality, {}, otherQuality]);

  assert.equal(new Set(original).size, original.length);
  assert.equal(reordered[1], original[0]);
  assert.equal(reordered[3], original[1]);
  assert.equal(reordered[0], original[2]);
  assert.equal(reordered[2], original[3]);
});

test('poster filenames preserve their unique suffix after truncating a long base', () => {
  const first = buildPosterFilename('A'.repeat(300), 'dimension-01');
  const second = buildPosterFilename('A'.repeat(300), 'dimension-02');
  assert.ok(first.endsWith('-dimension-01.png'));
  assert.ok(second.endsWith('-dimension-02.png'));
  assert.notEqual(first, second);
  assert.ok(first.length <= 120);
});

test('sanitizePosterFilename removes cross-platform unsafe characters and bounds length', () => {
  assert.equal(sanitizePosterFilename(' Alpha/Beta: report?.png '), 'Alpha-Beta- report-.png');
  assert.equal(sanitizePosterFilename('...'), 'compareai-poster');
  assert.ok(sanitizePosterFilename('A'.repeat(200)).length <= 120);
});
