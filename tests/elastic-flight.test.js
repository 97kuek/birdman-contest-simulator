import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlight, BASE_DESIGN, QX25_DESIGN, poseAt } from '../src/domain/flight.js';

const hull = [[-1, -.45], [1, -.45]];
for (const design of [BASE_DESIGN, QX25_DESIGN]) {
  test((design.aircraftId ?? 'ryukai') + 'の助走・離台・引き起こし・片翼突風で翼が応答する', () => {
    const neutral = createFlight(design, hull, { weather: 'calm' });
    const flight = createFlight(design, hull, { weather: 'calm' });
    assert.equal(flight.rampWingAt(0).leftTip, 0);
    assert.ok(flight.current().wing.leftTip > 0);
    assert.equal(flight.rampWingAt(100).leftTip, flight.current().wing.leftTip);
    flight.advanceTo(2);
    flight.advanceTo(2.55, 1);
    neutral.advanceTo(2.55);
    const wing = flight.current().wing;
    assert.ok(wing.leftTip > neutral.current().wing.leftTip);
    assert.equal(wing.leftTip, wing.rightTip);
    const gust = createFlight(design, hull, { weather: 'day-hard', gustOffset: 7 });
    gust.advanceTo(120);
    assert.ok(gust.result.samples.some(s => Math.abs(s.wing.leftTip - s.wing.rightTip) > .03));
    const [a,b] = gust.result.samples.slice(48,50);
    assert.ok(Math.abs(poseAt(gust.result, (a.t+b.t)/2).wing.leftTip - (a.wing.leftTip+b.wing.leftTip)/2) < 1e-9);
  });
}

test('限界を超えた時刻と側で飛行を止め、飛距離採点・着水へ進まない', () => {
  // An intentionally excessive launch to exercise the limit, outside UI settings.
  const options = { weather: 'day-hard', gustOffset: 7, push: 4.7 };
  const flight = createFlight(BASE_DESIGN, hull, options);
  flight.advanceTo(3, 1, -1);
  assert.equal(flight.failure.wing.failedSide, 'right');
  assert.ok(flight.time > 0 && flight.time < 1);
  assert.ok(flight.failure.wing.utilization >= 1 && flight.failure.wing.utilization < 1.001);
  const end = flight.current();
  flight.advanceTo(120);
  assert.equal(flight.current(), end);
  assert.equal(flight.result, null);
  assert.equal(flight.disqualified, null);
  const shore = createFlight(BASE_DESIGN, hull, { ...options, firstLand: () => 0 });
  shore.advanceTo(3, 1, -1);
  assert.ok(shore.disqualified);
  assert.equal(shore.failure, null);
});
