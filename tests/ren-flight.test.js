import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aircraftProfile } from '../src/domain/aircraft-profiles.js';
import { readFlightInstruments } from '../src/domain/flight-instruments.js';
import { createFlight, poseAt, REN_DESIGN, waterRunoutPose, WATER_RUNOUT_SECONDS } from '../src/domain/flight.js';
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
  near(last.speed, 7.2, 1e-5);
  near(last.height, first.height, 1e-4);
  near(last.propellerAngle - first.propellerAngle, 180 * 144 * RAD_PER_RPM, 1e-7);
  near(last.pathLength - first.pathLength, 180 * 7.2, .001);
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
  const cross = control(0, 0, 'cross');
  assert.ok(Math.abs(cross.right) > 1);
  assert.ok(Math.abs(cross.track - cross.heading) > .1);
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
  assert.ok(coast.verticalSpeed < 0 && coast.rpm > 0 && coast.rpm < 40);
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
