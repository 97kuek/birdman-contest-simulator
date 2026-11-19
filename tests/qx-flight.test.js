import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FlightSession } from '../src/application/flight-session.js';
import { aircraftDynamics, releaseState } from '../src/domain/aircraft-dynamics.js';
import { aircraftProfile } from '../src/domain/aircraft-profiles.js';
import { BASE_DESIGN, createFlight, launchProfile, poseAt, QX25_DESIGN, simulateFlight } from '../src/domain/flight.js';
import { cgShiftFromBody } from '../src/domain/pilot-shift.js';
import { hullAtControls } from '../src/domain/water-contact.js';

const hull = [[-1, -.45], [1, -.45], [0, .5]];
const near = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) < tolerance, actual + ' vs ' + expected);
};

test('QXの図面値から全機重心と尾翼モーメントを計算し、同じ前後入力で両方を操作する', () => {
  const qx = aircraftProfile('qx25');
  near(cgShiftFromBody(.1, qx), .1 * (117 - 51 - 4) / 117);
  near(qx.tailArea * qx.tailArm / (qx.area * qx.chord), .395);
  const launch = launchProfile();
  const { rates } = aircraftDynamics(QX25_DESIGN, launch, { weather: 'calm', wind: true, pilot: true, returnSeconds: .45 });
  const state = { ...releaseState(launch, true, true, qx), u: 9.5, w: 0, pitch: 0, q: 0 };
  const neutral = rates(state, 0, 0, 0);
  for (const command of [-1, 1]) {
    const rate = rates(state, 0, command, 0);
    // At identical pilot position, only the elevator changes the aerodynamic loads.
    const tailForceChange = -.5 * qx.airDensity * state.u ** 2 * 1.88
      * qx.tailLiftSlopePerDegree * command * 10 * qx.elevatorEffectiveness;
    near(rate.w - neutral.w, tailForceChange / 117);
    near(rate.q - neutral.q, -qx.tailArm * tailForceChange / qx.pitchInertia);
    assert.equal(Math.sign(rate.bodyShift), command);
  }
});

test('QXの基準は同じ発進条件の無操作飛行で、操舵反転を記録・再生できる', () => {
  const session = new FlightSession(hull, 'head', undefined, undefined, 'qx25');
  const ref = session.reference, attempt = session.startAttempt(), release = session.launch.duration;
  assert.equal(ref.aircraftId, 'qx25');
  assert.equal(ref.samples.at(-1).right, 0);
  assert.ok(ref.duration > 30 && ref.duration < 60);
  assert.ok(Math.abs(poseAt(ref, 10).speed - 9.5) < .5);
  const first = attempt.advance(release, 0, 0).sample;
  near(session.onDeck.height - first.height, 10 * session.launch.dropStep);
  near(first.height, session.launch.edgeHeight + .635 + .45);
  assert.equal(first.shift, 0);

  attempt.advance(release + .125, -1, 1);
  attempt.advance(release + .25, 1, -1);
  const { run } = attempt.advance(release + 120, 0, 0);
  assert.equal(run.aircraftId, 'qx25');
  assert.deepEqual(session.referenceFor(run), ref);
  assert.equal(run.samples.at(-1).bottomHeight, 0);
  assert.notEqual(run.distance, ref.distance);
  for (const [t, elevator, rudder] of [[0, -10, 17], [.123, -10, 17], [.125, 10, -17], [.25, 0, 0]]) {
    const sample = poseAt(run, t);
    assert.equal(sample.elevatorDeg, elevator);
    assert.equal(sample.rudderDeg, rudder);
    near(sample.shift, cgShiftFromBody(sample.bodyShift, aircraftProfile('qx25')));
  }
  for (const command of [-1, 1]) {
    const flight = createFlight(QX25_DESIGN, hull, { weather: 'head' });
    flight.advanceTo(120, command);
    const last = flight.result.samples.at(-1);
    assert.equal(last.bottomHeight, 0);
    assert.equal(last.elevatorDeg, command * 10);
    assert.ok(Number.isFinite(flight.result.distance));
  }
});

test('QXの舵角で水平尾翼後縁を上げ、方位舵はそのヒンジまわりに動く', () => {
  const hull = Object.assign([], {
    fixed: [[0, 0, 0]], fin: [[5, 1, 0]], elevator: [[4, 1, 1]],
    hingeZ: 4, elevatorHingeZ: 3, elevatorHingeUp: 1,
  });
  const [fixed, fin, tail] = hullAtControls(hull, 17, 10);
  assert.deepEqual(fixed, [0, 0, 0]);
  near(fin[2], Math.sin(17 * Math.PI / 180));
  near(tail[0], 3 + Math.cos(10 * Math.PI / 180));
  near(tail[1], 1 + Math.sin(10 * Math.PI / 180));
  assert.equal(tail[2], 1);
});

test('機体を省略した竜海の操舵試技と基準飛行が従来の数値に一致する', () => {
  const flight = createFlight(BASE_DESIGN, hull, { weather: 'head' });
  flight.advanceTo(.5, -1, 1);
  flight.advanceTo(1, 1, -1);
  flight.advanceTo(120);
  const ref = simulateFlight(BASE_DESIGN, hull, { weather: 'head' });
  for (const [run, duration, distance] of [
    [flight.result, 32.55583131025747, 307.21661158943715],
    [ref, 50.83150111958256, 408.3915983676386],
  ]) {
    assert.equal(run.aircraftId, 'ryukai');
    assert.ok(run.samples.every(sample => sample.elevatorDeg === 0));
    near(run.duration, duration, 1e-7);
    near(run.distance, distance, 1e-7);
  }
});
