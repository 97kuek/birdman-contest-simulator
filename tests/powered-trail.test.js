import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Group } from 'three';
import { createFlightTrail } from '../src/rendering/flight-trail.js';
import { FLIGHT_LIMIT_SECONDS, SAMPLES_PER_SECOND } from '../src/domain/flight.js';

test('滑空機の時間枠を超えた軌跡でも途中の座標を維持し、着水までシークできる', () => {
  const facility = new Group();
  const trail = createFlightTrail(null, '#fff', { facility, release() {} });
  const line = facility.children[0].children[0];
  const count = (FLIGHT_LIMIT_SECONDS + 10) * SAMPLES_PER_SECOND;
  const samples = Array.from({ length: count }, (_, i) => ({ right: i, forward: 2 * i, height: 3 }));
  trail.extend(samples.slice(0, 20));
  trail.extend(samples);
  const positions = line.geometry.getAttribute('position');
  assert.ok(positions.count >= count);
  assert.equal(positions.getX(12), 12);
  assert.equal(positions.getZ(count - 1), -2 * (count - 1));
  const run = { samples, duration: (count - 1) / SAMPLES_PER_SECOND, tailRight: count, tailForward: count * 2 };
  trail.showContact(run);
  assert.equal(trail.replayTo(run, 3), false);
  assert.equal(line.geometry.drawRange.count, 3 * SAMPLES_PER_SECOND + 1);
  assert.equal(trail.replayTo(run, run.duration), true);
  assert.equal(line.geometry.drawRange.count, count);
  trail.dispose();
});
