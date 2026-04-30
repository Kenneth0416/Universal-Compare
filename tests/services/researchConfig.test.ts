import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildResearchRequest,
  normalizeXSearchMode,
} from '../../src/services/researchConfig';

test('normalizes x search mode with auto as the safe default', () => {
  assert.equal(normalizeXSearchMode(undefined), 'auto');
  assert.equal(normalizeXSearchMode(''), 'auto');
  assert.equal(normalizeXSearchMode('AUTO'), 'auto');
  assert.equal(normalizeXSearchMode('off'), 'off');
  assert.equal(normalizeXSearchMode('always'), 'always');
  assert.equal(normalizeXSearchMode('unexpected'), 'auto');
});

test('builds web-only research request when x search is off', () => {
  const request = buildResearchRequest('Claude Code', 'off');

  assert.deepEqual(request.tools, [{ type: 'web_search' }]);
  assert.equal(request.tool_choice, 'auto');
  assert.match(request.input[0].content, /Do not use X Search/i);
});

test('builds automatic x search request that lets the model decide', () => {
  const request = buildResearchRequest('Claude Code', 'auto');

  assert.deepEqual(request.tools, [{ type: 'web_search' }, { type: 'x_search' }]);
  assert.equal(request.tool_choice, 'auto');
  assert.match(request.input[0].content, /Use X Search only if/i);
  assert.match(request.input[0].content, /recent public sentiment/i);
});

test('builds always-on x search request for social signal research', () => {
  const request = buildResearchRequest('Claude Code', 'always');

  assert.deepEqual(request.tools, [{ type: 'web_search' }, { type: 'x_search' }]);
  assert.equal(request.tool_choice, 'auto');
  assert.match(request.input[0].content, /Use X Search to gather recent public discussion/i);
});
