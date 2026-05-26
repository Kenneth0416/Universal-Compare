import assert from 'node:assert/strict';
import test from 'node:test';
import { mapConcurrent } from '../../server/concurrency';

test('mapConcurrent: preserves order of input array', async () => {
  const items = [1, 2, 3, 4, 5];
  const result = await mapConcurrent(items, 2, async (n) => n * 10);
  assert.deepEqual(result, [10, 20, 30, 40, 50]);
});

test('mapConcurrent: caps concurrency to N in flight', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  await mapConcurrent(items, 3, async (n) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
    return n;
  });
  assert.ok(maxInFlight <= 3, `Expected max 3 concurrent, saw ${maxInFlight}`);
});

test('mapConcurrent: handles empty array', async () => {
  const result = await mapConcurrent([], 5, async (n) => n);
  assert.deepEqual(result, []);
});

test('mapConcurrent: surfaces thrown error', async () => {
  await assert.rejects(
    () => mapConcurrent([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    }),
    /boom/,
  );
});
