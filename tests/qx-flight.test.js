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
    const rate = rates({ ...state, elevatorDeg: command * qx.elevatorLimitDeg }, 0, command, 0);
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
  for (const [t, elevator, rudder] of [[0, 0, 17], [.123, -1.968, 17], [.125, -2, -17], [.25, 4 / 3, 0], [.3, 0, 0]]) {
    const sample = poseAt(run, t);
    near(sample.elevatorDeg, elevator);
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

test('剛体比較時に機体を省略した竜海の操舵試技と基準飛行が計算済みの着水時刻と距離に一致する', () => {
  const flight = createFlight(BASE_DESIGN, hull, { weather: 'head', rigidWing: true, contestOpening: false });
  flight.advanceTo(.5, -1, 1);
  flight.advanceTo(1, 1, -1);
  flight.advanceTo(120);
  const ref = simulateFlight(BASE_DESIGN, hull, { weather: 'head', rigidWing: true, contestOpening: false });
  for (const [run, duration, distance] of [
    [flight.result, 32.55959336707358, 307.27255022533507],
    [ref, 51.06963445504252, 409.6225972269924],
  ]) {
    assert.equal(run.aircraftId, 'ryukai');
    assert.ok(run.samples.every(sample => sample.elevatorDeg === 0));
    near(run.duration, duration, 1e-7);
    near(run.distance, distance, 1e-7);
  }
});

test('QXの短い前後入力は長押しより浅く、離しても機首が跳ねず、逆方向にも同じように効く', () => {
  const response = (command, duration) => {
    const flight = createFlight(QX25_DESIGN, hull, { weather: 'calm' });
    flight.advanceTo(4);
    flight.advanceTo(4 + duration, command);
    const pressed = flight.current();
    flight.advanceTo(7);
    return { pressed, pitches: flight.samples.map(s => s.pitch) };
  };
  const neutral = response(0, .1);
  for (const sign of [-1, 1]) {
    const tap = response(sign, .1);
    const peak = Math.max(...tap.pitches.map((pitch, i) => sign * (pitch - neutral.pitches[i]) * 180 / Math.PI));
    assert.ok(peak > .1 && peak < 1, '0.1 s tap, including the response after release: ' + peak);
    near(tap.pressed.elevatorDeg, sign * 1.6);
    near(response(sign, .25).pressed.elevatorDeg, sign * 4);
    near(response(sign * .3, 1).pressed.elevatorDeg, sign * 3);
    near(response(sign, 1).pressed.elevatorDeg, sign * 10);
  }
});

test('QXの舵角は20 Hz記録の間の短い操作も再生でき、描画周期に依存しない', () => {
  const f = createFlight(QX25_DESIGN, hull, { weather: 'head' });
  const live = [];
  for (let i = 1; i <= 18; i++) {
    f.advanceTo(i / 120, i <= 2 ? .8 : i < 5 ? -1 : 0);
    live.push(f.current());
  }
  f.advanceTo(120);
  for (const sample of live) {
    near(poseAt(f.result, sample.t).elevatorDeg, sample.elevatorDeg);
  }
  const batched = createFlight(QX25_DESIGN, hull, { weather: 'head' });
  batched.advanceTo(2 / 120, .8);
  batched.advanceTo(4 / 120, -1);
  batched.advanceTo(120);
  assert.deepEqual(batched.result.samples, f.result.samples);
});

test('QXは離台直後に頭を上げ、前後一度ずつの修正で約5秒後に姿勢が落ち着く', () => {
  const session = new FlightSession(hull, 'head', undefined, undefined, 'qx25');
  const attempt = session.startAttempt();
  const release = session.launch.duration;
  const at = (time, input = 0) => attempt.advance(release + time, input).sample;
  const first = at(0);
  near(first.verticalSpeed, -session.launch.speed * session.launch.dropStep);
  assert.ok(at(.3).pitch > first.pitch);
  at(1);
  const noseDown = at(1.4, -1);
  const trough = at(2.05);
  assert.ok(trough.pitch < noseDown.pitch && noseDown.pitch < 0);
  at(2.45, 1);
  const recovery = at(3.5);
  assert.ok(recovery.pitch > trough.pitch && recovery.pitch < 0);
  assert.ok(Math.abs(at(5).pitchRate) < Math.PI / 180);
});
