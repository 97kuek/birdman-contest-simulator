import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlightClock } from '../src/application/flight-clock.js';

test('中断中の入力と復元後のフレームは同じ飛行時刻を使う', () => {
  let wallTime = 500;
  const clock = createFlightClock(() => wallTime);
  clock.setPaused(true);
  wallTime += 2000;
  clock.setPaused(true);
  assert.equal(clock.now(), 500);
  wallTime += 900;
  clock.setPaused(false);
  assert.equal(clock.now(), 500);
  wallTime += 33;
  clock.setPaused(false);
  assert.equal(clock.now(), 533);
  clock.setPaused(true);
  wallTime += 800;
  clock.setPaused(false);
  assert.equal(clock.now(), 533);
});
