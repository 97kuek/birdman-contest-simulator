import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aircraftProfile } from '../src/domain/aircraft-profiles.js';
import { readFlightInstruments } from '../src/domain/flight-instruments.js';
import { createFlight, poseAt, REN_DESIGN, waterRunoutPose, WATER_RUNOUT_SECONDS } from '../src/domain/flight.js';
import { poweredFlightDynamics } from '../src/domain/powered-flight.js';
import { propellerModel, wingPolar } from '../src/domain/powered-cruise.js';
import { GRAVITY, RAD_PER_RPM } from '../src/domain/units.js';

const hull = [[-1, -.45], [1, -.45], [7, .4], [0, .9, 16.1], [0, .9, -16.1]];
const plane = aircraftProfile('ren').propulsion;
const create = (weather = 'calm') => createFlight(REN_DESIGN, hull, { weather });
const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' vs ' + expected);

test('聯の巡航設計点でプロペラ軸、揚力、抵抗が釣り合い、離台後も120秒を超えて飛ぶ', () => {
  const { lift, drag } = wingPolar(plane)(7.2, 0);
  const { thrust, acceleration } = propellerModel(plane)(144 * RAD_PER_RPM, 7.2, 203);
  near(lift, 87.7 * GRAVITY, 1e-5);
  near(thrust, 22, 1e-5);
  near(drag, thrust, 1e-5);
  near(acceleration, 0, 1e-8);
  const flight = create();
  flight.advanceTo(60);
  const first = flight.current();
  flight.advanceTo(240);
  const last = flight.current();
  assert.equal(flight.time, 240);
  assert.equal(flight.result, null);
  // At finite height 203 W exceeds the new level-flight requirement.
  assert.ok(last.height > first.height);
  near(last.speed, plane.speed, .001);
  near(last.propellerAngle - first.propellerAngle, 180 * 144 * RAD_PER_RPM, .1);
  near(last.pathLength - first.pathLength, 180 * plane.speed, .1);
  assert.equal(readFlightInstruments(last, 'ren').altitude, last.bottomHeight);
});

test('聯は舵で昇降と左右旋回ができ、風が対地速度と航跡を変える', () => {
  const control = (pitch, rudder, weather = 'calm') => {
    const f = create(weather);
    f.advanceTo(30);
    f.advanceTo(35, pitch, rudder);
    return f.current();
  };
  const neutral = control(0, 0);
  for (const sign of [-1, 1]) {
    const pitched = control(sign, 0), turned = control(0, sign);
    assert.equal(pitched.elevatorDeg, sign * 10);
    assert.equal(pitched.shift, 0);
    assert.ok(sign * (pitched.height - neutral.height) > .5);
    assert.ok(sign * (pitched.speed - neutral.speed) < -.5);
    assert.equal(turned.rudderDeg, sign * 12.5);
    assert.ok(sign * turned.bank > .05);
    assert.ok(sign * turned.right > 2);
    assert.ok(sign * turned.heading > .2);
  }
  near(control(0, 0, 'tail').groundSpeed - control(0, 0, 'head').groundSpeed, 2.4, .01);
  const drift = create('cross');
  drift.advanceTo(5);
  const cross = drift.current();
  // Early drift downwind, while the free fin turns the nose into wind.
  assert.ok(cross.right > 1 && cross.track > 0 && cross.heading < 0);
  assert.ok(cross.track - cross.heading > .1);
});

test('聯はペダル出力の変更と漕ぎ止めを記録し、回転の惰性を着水後まで再生する', () => {
  const f = create();
  const cut = 31 + 2 / 120;
  f.advanceTo(30);
  f.advanceTo(cut, 0, .5, 300);
  const boosted = f.current();
  assert.ok(boosted.rpm > 144 && boosted.verticalSpeed > 0);
  f.advanceTo(cut + 1 / 120, 0, 0, 0);
  assert.ok(f.current().rpm < boosted.rpm && f.current().rpm > 144);
  f.advanceTo(38, 0, 0, 0);
  const coast = f.current();
  assert.ok(coast.verticalSpeed < 0 && coast.rpm > 0 && coast.rpm < plane.rpm);
  assert.ok(propellerModel(plane)(coast.rpm * RAD_PER_RPM, coast.speed, 0).thrust < 0);
  f.advanceTo(200, 0, 0, 0);
  const run = f.result;
  assert.ok(run.duration > 38 && run.duration < 200);
  assert.equal(run.samples.at(-1).bottomHeight, 0);
  assert.equal(run.distance, run.samples.at(-1).pathLength);
  assert.ok(run.distance > Math.hypot(run.tailForward, run.tailRight));
  assert.equal(poseAt(run, cut - .001).watts, 300);
  assert.equal(poseAt(run, cut + .001).watts, 0);
  const replay = poseAt(run, cut);
  near(replay.propellerAngle, boosted.propellerAngle, .01);
  near(replay.rpm, boosted.rpm, 4);
  assert.deepEqual(poseAt(run, cut), replay);
  const contact = poseAt(run, run.duration);
  const settled = waterRunoutPose(contact, WATER_RUNOUT_SECONDS, hull, 'calm');
  assert.ok(settled.propellerAngle > contact.propellerAngle);
  assert.equal(settled.rpm, 0);
  assert.equal(settled.watts, 0);
});

test('聯の低回転プロペラは前進気流で回され、機体に抵抗を返す', () => {
  const rotor = propellerModel(plane);
  const stopped = rotor(0, plane.speed, 0);
  assert.ok(stopped.thrust < 0);
  assert.ok(stopped.acceleration > 0);
  const still = rotor(0, 0, 0);
  near(still.thrust, 0, 1e-9);
  near(still.acceleration, 0, 1e-9);
});

test('聯の巡航から10秒間、旋回で高度を使い、漕ぎ増すとその損失を補える', () => {
  const turnHeights = [];
  for (const watts of [0, 203, 300]) {
    const straight = create(), turn = create();
    straight.advanceTo(90);
    turn.advanceTo(90);
    const initial = straight.current();
    straight.advanceTo(100, 0, 0, watts);
    turn.advanceTo(100, 0, 1, watts);
    const a = straight.current(), b = turn.current();
    assert.equal(b.t, 100);
    assert.ok(b.height < a.height && b.track > a.track && b.bank > 0);
    // With a free pitch attitude, power changes climb rate. The speed
    // can oscillate about trim during the longitudinal transient.
    if (watts === 0) assert.ok(a.height < initial.height && a.verticalSpeed < 0);
    else assert.ok(a.height > initial.height && a.verticalSpeed > 0);
    if (watts === 203) near(a.speed, plane.speed, .001);
    turnHeights.push(b.height);
  }
  assert.ok(turnHeights[0] < turnHeights[1] && turnHeights[1] < turnHeights[2]);
});

test('聯はピッチ・バンク・方位を反映した左右の位置で風と対水面高度を読む', () => {
  const profile = aircraftProfile('ren');
  const launch = { edgeRight: 7, edgeForward: 13 };
  const calls = [];
  const level = { right: 0, forward: 0, height: 8, pathLength: 0, pitch: 0, bank: 0,
    u: plane.speed, v: 0, w: 0, heading: 0, p: 0, q: 0, r: 0 };
  const model = poweredFlightDynamics(profile, launch, 'calm', 17, (_weather, pos) => {
    calls.push(pos);
    return { headwind: 0, updraft: 0 };
  });
  const flat = model.loadsAt(level, 0);
  near(flat.lift, plane.mass * GRAVITY, .001);
  near(flat.rollMoment, 0, 1e-8);
  near(flat.left.height, flat.right.height, 1e-9);
  assert.ok(calls[1].right < launch.edgeRight && calls[2].right > launch.edgeRight);
  calls.length = 0;
  const banked = model.loadsAt({ ...level, pitch: .1, bank: .15, heading: Math.PI / 2 }, 0);
  near(calls[1].height, banked.left.height, 1e-9);
  near(calls[2].height, banked.right.height, 1e-9);
  assert.ok(calls.every(p => p.gustOffset === 17));
  assert.ok(calls[1].forward > calls[2].forward);
  assert.ok(banked.left.height > banked.right.height && banked.left.drag > banked.right.drag);
  const high = model.loadsAt({ ...level, height: 1e8 }, 0);
  near(high.drag, plane.thrust, 1e-6);
  assert.ok(flat.drag < high.drag);
});

test('聯は上昇風を受けた翼が上がり、上昇中の翼の追加荷重は小さくなる', () => {
  const state = { right: 0, forward: 0, height: 8, pathLength: 0, pitch: 0, bank: 0,
    u: plane.speed, v: 0, w: 0, heading: 0, p: 0, q: 0, r: 0 };
  function loads(side, rate = 0) {
    const field = (_mode, pos) => ({ headwind: 0, updraft: side === 0 || side * pos.right > 2 ? .5 : 0 });
    const model = poweredFlightDynamics(aircraftProfile('ren'), { edgeRight: 0, edgeForward: 0 }, 'calm', 0, field);
    return model.loadsAt({ ...state, p: rate }, 0);
  }
  const left = loads(-1), right = loads(1);
  assert.ok(left.left.lift > left.right.lift && left.rollMoment > 0);
  near(left.rollMoment, -right.rollMoment, 1e-9);
  near(loads(0).rollMoment, 0, 1e-9);
  assert.ok(loads(-1, .02).rollMoment < left.rollMoment);
});

test('聯は尾翼だけに入る風と機体角速度から復元モーメントを生じる', () => {
  const profile = aircraftProfile('ren');
  const state = { right: 0, forward: 0, height: 10, pathLength: 0, pitch: 0, bank: 0,
    heading: 0, u: plane.speed, v: 0, w: 0, p: 0, q: 0, r: 0, omega: 0, elevatorDeg: 0 };
  function rates(field, changes = {}, turn = 0) {
    const model = poweredFlightDynamics(profile, { edgeRight: 0, edgeForward: 0 }, 'calm', 0, field);
    return model.rates({ ...state, ...changes }, 0, 0, turn);
  }
  const still = () => ({ headwind: 0, updraft: 0 });
  const horizontalGust = (_mode, pos) => ({ headwind: 0, updraft: Math.abs(pos.forward + 5.30) < .1 ? .5 : 0 });
  const finGust = (_mode, pos) => ({ headwind: 0, updraft: 0, crosswind: Math.abs(pos.forward + 6.10) < .1 ? .5 : 0 });
  assert.ok(rates(horizontalGust).q < 0); // tail rises, nose falls
  near(rates(horizontalGust).r, 0, 1e-12);
  assert.ok(rates(finGust).r > 0); // wind from the right pushes fin to port
  assert.ok(rates(still, { q: .05 }).q < 0 && rates(still, { r: .05 }).r < 0);
  for (const sign of [-1, 1]) {
    const turn = rates(still, {}, sign), pitch = rates(still, { elevatorDeg: sign * 2 });
    assert.ok(sign * turn.r > 0 && sign * turn.v < 0);
    assert.ok(sign * pitch.q > 0 && sign * pitch.w < 0);
    near(rates(still, { u: plane.speed / 2 }, sign).r, turn.r / 4, 1e-10);
    assert.ok(sign * rates(still, { omega: plane.rpm * RAD_PER_RPM }, sign).r > sign * turn.r);
  }
  const parked = rates(still, { u: 0, elevatorDeg: 10 }, 1);
  near(parked.q, 0, 1e-12);
  near(parked.r, 0, 1e-12);
});

test('聯は自由空間の設計巡航で全力・全モーメントが釣り合う', () => {
  const model = poweredFlightDynamics(aircraftProfile('ren'), { edgeRight: 0, edgeForward: 0 }, 'calm', 0);
  const state = { right: 0, forward: 0, height: 1e8, pathLength: 0, pitch: 0, bank: 0,
    heading: 0, u: 7.2, v: 0, w: 0, p: 0, q: 0, r: 0, omega: 144 * RAD_PER_RPM, elevatorDeg: 0 };
  const rates = model.rates(state, 0, 0, 0, undefined, 203);
  for (const axis of ['u', 'v', 'w', 'p', 'q', 'r', 'omega']) near(rates[axis], 0, 1e-7);
});
