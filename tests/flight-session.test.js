import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlightSession } from '../src/application/flight-session.js';
import { FlightRecords } from '../src/application/flight-records.js';
import { MAX_LAUNCH_HEADING_DEGREES, WATER_RUNOUT_SECONDS } from '../src/domain/flight.js';

const hull = [
  [-1, -0.45],
  [1, -0.45],
  [0, 0.5],
];

test('同条件の基準機を共有し、接水後の演出を試技の記録から分離する', () => {
  const session = new FlightSession(hull, 'head');
  const baseline = session.reference;
  assert.equal(session.reference, baseline);
  const attempt = session.startAttempt();
  const { duration } = session.launch;
  assert.equal(attempt.advance(0, 0, 0).phase, 'push');
  assert.equal(attempt.advance(duration, 0, 0).phase, 'release');
  attempt.advance(duration + 0.5, 1, -1);
  assert.equal(session.latest, undefined);
  const { phase, run } = attempt.advance(duration + 120, 0, 0);
  assert.equal(phase, 'touchdown');
  assert.equal(session.latest.run, run);
  assert.equal(session.latest.number, attempt.number);
  assert.equal(run.inputs[0].direction, 1);
  assert.equal(run.turnInputs[0].direction, -1);
  const contact = run.samples.at(-1);
  const floated = session.waterPose(run, WATER_RUNOUT_SECONDS);
  assert.equal(floated.t, contact.t);
  assert.equal(floated.groundSpeed, 0);
  assert.ok(Math.hypot(floated.right - contact.right, floated.forward - contact.forward) > 0);

  session.select('cross', 100);
  assert.equal(session.launch.direction, MAX_LAUNCH_HEADING_DEGREES);
  assert.equal(session.latest, undefined);
  session.select('head', 0);
  assert.equal(session.latest.run, run);
});

test('聯の助走から離台に駆動位相を引き継ぎ、同じ発進から漕ぎ方で飛行が分かれる', () => {
  const session = new FlightSession(hull, 'calm', () => 0, undefined, 'ren');
  assert.equal(session.reference, null);
  assert.equal(session.onDeck.rpm, 0);
  const run = watts => {
    const attempt = session.startAttempt();
    const release = session.launch.duration;
    const justBefore = attempt.advance(release - 0.001, 0, 0).sample;
    const atRelease = attempt.advance(release, 0, 0).sample;
    assert.ok(Math.abs(atRelease.propellerAngle - justBefore.propellerAngle) < 0.02);
    assert.equal(atRelease.watts, 203);
    return attempt.advance(release + 5, 0, 0, watts).sample;
  };
  const coast = run(0), pedal = run(300);
  assert.equal(coast.watts, 0);
  assert.equal(pedal.watts, 300);
  assert.ok(pedal.rpm > coast.rpm);
  assert.ok(pedal.pathLength > coast.pathLength);
});

test('聯の方位調整中は発進計算を保留し、確定後は同じ風と台上姿勢から回転を始める', () => {
  const session = new FlightSession(hull, 'day-hard', () => 7.5, undefined, 'ren');
  session.prepareAttempt();
  let preview;
  for (const direction of [-24, 8, 23]) {
    session.select('day-hard', direction);
    preview = session.onDeck;
    assert.equal(session.launch.driveAt, undefined);
    assert.equal(preview.heading, session.launch.heading);
  }
  assert.deepEqual(session.onDeckAt(0), preview);
  const confirmed = session.launch;
  assert.ok(session.onDeckAt(2).rpm > 0);
  const attempt = session.startAttempt();
  assert.equal(session.launch, confirmed);
  assert.equal(attempt.advance(confirmed.duration, 0, 0).phase, 'release');
});

test('直近3条件のリプレイを残し、古い方位でも距離・試技番号・自己ベストを参照できる', () => {
  const session = new FlightSession(hull, 'head');
  const records = new FlightRecords(() => null);
  const trials = [];
  for (const direction of [0, 3, 6, 3, 9, 12]) {
    session.select('head', direction);
    const attempt = session.startAttempt();
    const { run } = attempt.advance(session.launch.duration + 120, 0, 0);
    trials.push(run);
    records.record(session.latest.summary);
  }
  for (const [direction, index, canReplay] of [[0, 0, false], [3, 3, true], [6, 2, false], [9, 4, true], [12, 5, true]]) {
    session.select('head', direction);
    const { run, number, summary } = session.latest;
    assert.equal(number, index + 1);
    assert.equal(run, canReplay ? trials[index] : undefined);
    assert.equal(summary.distance, trials[index].distance);
    assert.equal(summary.duration, trials[index].duration);
    assert.equal(summary.samples, undefined);
    assert.equal(summary.launch, undefined);
    assert.equal(records.forRun(summary).metres, trials[index].distance.toFixed(2));
  }
  assert.equal(records.forRun(session.latest.summary).best,
    Math.max(...trials.map(run => Math.round(run.distance * 100))));
});
