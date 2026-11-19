import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlightSession } from '../src/application/flight-session.js';
import { WEATHER, windAt, windReading } from '../src/domain/weather.js';
import { poseAt } from '../src/domain/flight.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' vs ' + expected);
const hull = [[-1, -.45], [1, -.45], [0, .5]];

test('湖風と陸風は逆向き、突風の三成分は空間・時刻に沿って連続する', () => {
  const samples = [];
  for (let i = 0; i < 50; i++) {
    const position = { forward: 8 * i, right: 6 * Math.sin(i), pathLength: 100 };
    const day = windAt('day-normal', position, i), night = windAt('night-normal', position, i);
    assert.ok(day.headwind > 0 && night.headwind < 0);
    const a = windAt('day-hard', position, i);
    const b = windAt('day-hard', { ...position, right: position.right + .001 }, i + .001);
    for (const key of Object.keys(a)) assert.ok(Math.abs(a[key] - b[key]) < .002);
    samples.push(a);
  }
  for (const [key, amplitude] of [['headwind', 'along'], ['crosswind', 'lateral'], ['updraft', 'vertical']]) {
    const range = Math.max(...samples.map(p => p[key])) - Math.min(...samples.map(p => p[key]));
    assert.ok(range > WEATHER['day-hard'].field[amplitude]);
  }
  const nearWater = { right: 5, forward: 105 };
  const surface = windAt('day-hard', { ...nearWater, height: 0 }, 15);
  const high = windAt('day-hard', { ...nearWater, height: 8 }, 15);
  close(surface.updraft, 0);
  close(surface.crosswind, high.crosswind);
  close(surface.headwind, high.headwind);
  const field = WEATHER['day-hard'].field;
  const at = { right: 17.9, forward: 50.3 };
  // Follow a patch downwind to see the same disturbance at its new position.
  assert.deepEqual(windAt('day-hard', at, 0), windAt('day-hard', {
    right: at.right - field.cross * 5, forward: at.forward - field.head * 5 }, 5));
  assert.notDeepEqual(windAt('day-hard', at, 0), windAt('day-hard', { ...at, right: at.right + 20 }, 0));
});

test('台上・任意の発進角・リプレイ・着水後の風が各時点の座標に合う', () => {
  for (const mode of ['day-normal', 'night-normal', 'day-hard']) {
    const session = new FlightSession(hull, mode, () => 11.75);
    session.select(mode, -25);
    session.prepareAttempt();
    const run = session.reference;
    const live = session.startAttempt();
    live.advance(session.launch.duration + 120, 0, 0);
    const manual = session.latest.run;
    const poses = [session.onDeck, ...run.samples.filter((p, i) => i % 50 === 0),
      ...manual.samples.filter((p, i) => i % 50 === 0), session.waterPose(run, 2)];
    for (const s of poses) {
      const t = s.windTime ?? s.t;
      const wind = windAt(mode, s, t), reading = windReading(mode, s.heading, s, t);
      close(s.headwind, wind.headwind * Math.cos(s.heading) + wind.crosswind * Math.sin(s.heading));
      close(s.updraft, wind.updraft);
      close(reading.speed, Math.hypot(wind.headwind, wind.crosswind));
      if (s.t !== undefined) close(s.speed, Math.hypot(s.groundSpeed * Math.cos(s.track) + wind.headwind,
        s.groundSpeed * Math.sin(s.track) + wind.crosswind, s.verticalSpeed - wind.updraft));
    }
    const sought = poseAt(manual, 2.35);
    const recorded = manual.samples.find(row => Math.abs(row.t - 2.35) < 1e-8);
    close(windAt(mode, sought, sought.t).updraft, recorded.updraft);
  }
});

test('再挑戦の風を引き直し、基準機・リプレイ・過去の試技に試技時の風を使う', () => {
  const offsets = [4.25, 23.7, 8.9];
  const session = new FlightSession(hull, 'day-hard', () => offsets.shift());
  const play = () => {
    session.startAttempt().advance(session.launch.duration + 120, 0, 0);
    return session.latest.run;
  };
  session.prepareAttempt();
  const prepared = session.onDeck;
  session.select('day-hard', 5);
  assert.equal(session.onDeck.gustOffset, prepared.gustOffset);
  const first = play();
  assert.equal(first.gustOffset, 4.25);
  const second = play();
  assert.equal(second.gustOffset, 23.7);
  assert.notEqual(second.distance, first.distance);
  const sought = poseAt(first, 2.14);
  assert.equal(sought.gustOffset, first.gustOffset);
  assert.notEqual(windAt('day-hard', sought, sought.t).crosswind,
    windAt('day-hard', { ...sought, gustOffset: second.gustOffset }, sought.t).crosswind);
  session.select('night-normal', 20);
  const night = play();
  const reference = session.referenceFor(first);
  assert.equal(reference.weather, first.weather);
  assert.equal(reference.gustOffset, first.gustOffset);
  assert.equal(reference.launch.direction, first.launch.direction);
  assert.equal(session.referenceFor(first), reference);
  assert.equal(session.referenceFor(night).gustOffset, 8.9);
  session.select('day-hard', 5);
  assert.equal(session.latest.run, second);
});

test('昼夜の各難易度で背景風と三成分の揺らぎを段階的に強める', () => {
  for (const period of ['day', 'night']) {
    const modes = ['easy', 'normal', 'hard'].map(key => WEATHER[period + '-' + key]);
    for (const mode of modes) {
      assert.equal(mode.period, period);
      assert.equal(Math.sign(mode.field.head), period === 'day' ? 1 : -1);
    }
    for (const [a, b] of [[modes[0], modes[1]], [modes[1], modes[2]]]) {
      assert.ok(a.lakeWindSpeed < b.lakeWindSpeed);
      for (const key of ['along', 'lateral', 'vertical']) assert.ok(a.field[key] < b.field[key]);
    }
  }
});

test('斜めの助走中も、三次元の対地速度と風の差から対気速度が決まる', () => {
  const session = new FlightSession(hull, 'night-hard', () => 4.25);
  session.select('night-hard', 25);
  const attempt = session.startAttempt();
  const s = attempt.advance(session.launch.duration * .8, 0, 0).sample;
  const wind = windAt(session.weather, s, s.windTime);
  close(s.speed, Math.hypot(s.groundSpeed * Math.cos(s.track) + wind.headwind,
    s.groundSpeed * Math.sin(s.track) + wind.crosswind, s.verticalSpeed - wind.updraft));
});
