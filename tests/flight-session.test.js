import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlightSession } from '../src/application/flight-session.js';
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
