import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FlightSession } from '../src/application/flight-session.js';
import { createShoreline } from '../src/domain/shoreline.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { readModel } from '../analysis/model-fixture.js';
import { createChaseBoat } from '../src/rendering/chase-boat.js';
const boatModel = await readModel('chase-boat.glb.gz');

import { modelHull } from '../src/rendering/collision-hull.js';

const shape = [[-1, -0.45], [1, -0.45], [0, 0.5]];
// A square island with a lagoon. At yaw zero, forward is north (negative Z).
const island = [[-10, -20], [10, -20], [10, -10], [-10, -10]];
const lagoon = [[-2, -16], [-2, -14], [2, -14], [2, -16]];

test('岸線を飛び越えた区間、岸に沿う区間と陸中の水域を区別する', () => {
  const land = createShoreline([island, lagoon], 0);
  assert.equal(land(0, 0, 0, 25), 0.4);
  assert.equal(land(0, 12, 0, 12), 0);
  assert.equal(land(0, 15, 0, 15), null);
  assert.equal(land(-20, 10, 20, 10), 0.25);
  assert.equal(land(10, 20, 10, 20), 0);
  assert.equal(land(12, 0, 12, 25), null);
  const rotated = createShoreline([island], Math.PI / 2);
  assert.ok(Math.abs(rotated(0, 0, 25, 0) - 0.4) < 1e-9);
});

test('多景島・竹生島・沖島では水際を越えてから陸地に入る', () => {
  const rings = JSON.parse(readFileSync(new URL('../assets/terrain/flight-shore.json', import.meta.url)));
  const land = createShoreline(rings, 0);
  // East/north metres in the local launch frame. Each pair starts on open water.
  for (const [waterX, shoreX, north] of [[-6600, -6920, 270], [-9600, -10120, 14250], [-15700, -16875, -9475]]) {
    assert.equal(land(waterX, north, waterX, north), null);
    assert.equal(land(shoreX, north, shoreX, north), 0);
    const crossing = land(waterX, north, shoreX, north);
    assert.ok(crossing > 0 && crossing < 1);
  }
});

test('松原の実際の岸線に進入した試技は失格で終了し直前の湖上の記録を保つ', () => {
  const rings = JSON.parse(readFileSync(new URL('../assets/terrain/flight-shore.json', import.meta.url)));
  const land = createShoreline(rings, 65 * Math.PI / 180);
  const session = new FlightSession(modelHull(createAircraft()), 'day-easy', () => 0, land);
  session.select('day-easy', 30);
  const scored = session.startAttempt().advance(123, 0, 0);
  assert.equal(scored.phase, 'touchdown');
  const route = () => {
    const trial = session.startAttempt();
    trial.advance(session.launch.duration + 8, 1, 1);
    return trial;
  };
  const direct = route().advance(123, 1, 0);
  assert.equal(direct.phase, 'disqualified');
  assert.ok(direct.sample.bottomHeight > 0);
  assert.equal(direct.run, undefined);
  assert.equal(session.latest.run, scored.run);
  const stepped = route();
  let frame;
  for (let seconds = 9; seconds < 120; seconds += 0.25) {
    frame = stepped.advance(session.launch.duration + seconds, 1, 0);
    if (frame.phase === 'disqualified') break;
  }
  assert.equal(frame.sample.t, direct.sample.t);
  assert.equal(session.startAttempt().advance(123, 0, 0).phase, 'touchdown');
});

test('接水直前の陸地進入と、記録確定後の湖岸で止まる滑走を区別する', () => {
  const plain = new FlightSession(shape, 'head');
  const run = plain.startAttempt().advance(123, 0, 0).run;
  const contact = run.samples.at(-1);
  // This hull's foremost point is at most one metre ahead of the CG.
  const ashoreAfter = at => createShoreline([[[-1000, -at], [1000, -at], [1000, -1000], [-1000, -1000]]], 0);
  const before = new FlightSession(shape, 'head', () => 0, ashoreAfter(contact.forward - 0.001));
  assert.equal(before.startAttempt().advance(123, 0, 0).phase, 'disqualified');
  assert.equal(before.latest, undefined);
  const boundary = contact.forward + 3;
  const after = new FlightSession(shape, 'head', () => 0, ashoreAfter(boundary));
  const valid = after.startAttempt().advance(123, 0, 0);
  assert.equal(valid.phase, 'touchdown');
  assert.equal(valid.run.distance, run.distance);
  const stopped = after.waterPose(valid.run, 4);
  assert.ok(stopped.forward < boundary && stopped.forward > contact.forward);
  assert.equal(stopped.groundSpeed, 0);
  assert.deepEqual(after.waterPose(valid.run, 3.8), stopped);
});

test('追走艇の本体と観測席を岸の手前に保ち、水上に戻る試技に追従する', () => {
  const boat = createChaseBoat(boatModel.clone());
  const coast = createShoreline([[[20, -600], [200, -600], [200, 200], [20, 200]]], 0);
  const samples = Array.from({length: 801}, (_, i) => {
    const t = i / 20;
    return { t, right: t <= 20 ? 5 * t : 100 - 7 * (t - 20), forward: 9 * t,
      groundSpeed: 10, track: t <= 20 ? .51 : -.66 };
  });
  for (const { t } of samples) {
    boat.update(samples, t, 0, coast);
    assert.ok(boat.group.position.x + 3.3 < 20);
  }
  assert.ok(boat.group.position.x < 0 && boat.group.position.z < -180);
  const end = boat.group.position.clone();
  boat.update(samples, 10, 0, coast);
  boat.update(samples, 40, 0, coast);
  assert.deepEqual(boat.group.position, end);
});

test('岸まで同じ距離でも、翼を含む対地進路が陸に届く場合だけ警告する', () => {
  const session = new FlightSession(shape, 'head', () => 0, createShoreline([island], 0));
  const s = { right: 0, forward: 0, heading: 0, pitch: 0, bank: 0, groundSpeed: 3, track: 0 };
  assert.equal(session.shoreAhead(s), true);
  assert.equal(session.shoreAhead({ ...s, track: Math.PI }), false);
  assert.equal(session.shoreAhead({ ...s, groundSpeed: .5 }), false);
});

test('追走艇は旋回でも船首方向へ進み、着水後は惰性で減速する', () => {
  const boat = createChaseBoat(boatModel.clone());
  const samples = Array.from({length: 721}, (_, i) => {
    const t = i / 20, turn = Math.max(0, t - 24) * .09;
    return {t, right: 100 * (1 - Math.cos(turn)), forward: Math.min(t, 24) * 9 + 100 * Math.sin(turn),
      track: turn, groundSpeed: 9};
  });
  boat.update(samples, 0, 0);
  let previous = boat.group.position.clone(), yaw = boat.group.rotation.y, speed = 0;
  for (const {t} of samples.slice(1)) {
    const nextSpeed = boat.update(samples, t, 0);
    const delta = boat.group.position.clone().sub(previous);
    const middle = (yaw + boat.group.rotation.y) / 2;
    assert.ok(Math.abs(delta.x * Math.cos(middle) - delta.z * Math.sin(middle)) < .00001);
    assert.ok(Math.abs(nextSpeed - speed) <= 2 / 20 + .00001);
    assert.ok(Math.abs(boat.group.rotation.y - yaw) <= Math.PI / 8 / 20 + .00001);
    previous.copy(boat.group.position);
    yaw = boat.group.rotation.y;
    speed = nextSpeed;
  }
  assert.ok(speed > 5);
  const coastSpeed = boat.update(samples, 37, 0, null, 36);
  assert.ok(coastSpeed > 0 && coastSpeed < speed);
  assert.equal(boat.update(samples, 41, 0, null, 36), 0);
  const stopped = boat.group.position.clone();
  boat.update(samples, 40, 0, null, 36);
  assert.deepEqual(boat.group.position, stopped);
});
