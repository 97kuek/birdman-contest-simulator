import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aircraftDynamics, releaseState } from '../src/domain/aircraft-dynamics.js';
import { aircraftProfile } from '../src/domain/aircraft-profiles.js';
import { launchProfile } from '../src/domain/launch.js';
import { GRAVITY } from '../src/domain/units.js';
import { solveWingStructure, WING_STRUCTURE, wingBendShape, wingTwistShape } from '../src/domain/wing-structure.js';

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} versus ${expected}`);
}

for (const id of ['ryukai', 'qx25']) {
  const profile = aircraftProfile(id), span = profile.design.span;
  const halfWeight = profile.mass * GRAVITY / 2;
  const solve = (left, right, options = {}, width = span) => solveWingStructure(profile, width, {
    leftLift: left * halfWeight, rightLift: right * halfWeight, ...options,
  });
  test(id + ' の定常たわみは三面図の翼端変位に一致し、トリム揚力を維持する', () => {
    const steady = solve(1, 1, { leftLiftSlope: 2500, rightLiftSlope: 2500 });
    close(steady.leftTip, WING_STRUCTURE[id].referenceTip);
    close(steady.rightTip, steady.leftTip);
    close(steady.leftLift, halfWeight);
    close(steady.rightLift, halfWeight);
    close(steady.rollMoment, 0);
    assert.ok(steady.leftTwist < 0);
    assert.ok(steady.bendingOmegaRadPerSec > 0);
    assert.equal(steady.failedSide, null);
    const unloaded = solve(0, 0);
    close(unloaded.leftMoment, 0);
    close(unloaded.leftTip, 0);
    close(unloaded.leftTwist, 0);
  });
  test(id + ' の翼根モーメントは楕円荷重の重心・翼質量・腕の長さから決まる', () => {
    const withoutInertia = solve(1, 1, { normalAcceleration: 0 });
    close(withoutInertia.leftMoment, halfWeight * (span / 2) * 4 / (3 * Math.PI));
    const normal = solve(1, 1);
    assert.ok(normal.leftMoment < withoutInertia.leftMoment);
    assert.ok(normal.leftTip < withoutInertia.leftTip);
    const longer = solve(1, 1, {}, span * 1.1);
    close(longer.leftMoment / normal.leftMoment, 1.1);
    close(longer.leftTip / normal.leftTip, 1.1 ** 3);
    close(longer.limitMoment, normal.limitMoment);
    close(longer.bendingOmegaRadPerSec / normal.bendingOmegaRadPerSec, 1.1 ** -1.5);
  });
  test(id + ' の左右の突風は異なるねじれ・揚力・ロールを生じ、左右反転で符号が変わる', () => {
    const slopes = { leftLiftSlope: 2500, rightLiftSlope: 2500 };
    const rigid = solve(1.5, .5);
    const flexible = solve(1.5, .5, slopes);
    assert.ok(flexible.leftLift < rigid.leftLift && flexible.rightLift > rigid.rightLift);
    assert.ok(flexible.leftTwist < flexible.rightTwist);
    assert.ok(flexible.leftTip > flexible.rightTip);
    assert.ok(flexible.rollMoment > 0 && flexible.rollMoment < rigid.rollMoment);
    const swapped = solve(.5, 1.5, slopes);
    close(swapped.leftTip, flexible.rightTip);
    close(swapped.rightTip, flexible.leftTip);
    close(swapped.rollMoment, -flexible.rollMoment);
    close(swapped.utilization, flexible.utilization);
  });
  test(id + ' のロールで下がる側の翼根荷重が増え、既存のロール減衰は重複しない', () => {
    const launch = launchProfile();
    const options = { weather: 'calm', referenceControl: false, pilot: false };
    const dynamics = aircraftDynamics(profile.design, launch, options);
    const rigid = aircraftDynamics(profile.design, launch, { ...options, rigidWing: true });
    const level = { ...releaseState(launch, true, false, profile), pitch: 0, q: 0, w: 0, u: profile.cruiseSpeed };
    const rolling = { ...level, p: .04 };
    const steady = dynamics.loadsAt(level, 0).structure;
    const positive = dynamics.loadsAt(rolling, 0).structure;
    const negative = dynamics.loadsAt({ ...level, p: -.04 }, 0).structure;
    assert.ok(positive.leftMoment < steady.leftMoment && positive.rightMoment > steady.rightMoment);
    close(positive.leftMoment, negative.rightMoment);
    close(positive.rightMoment, negative.leftMoment);
    // Passive washout relieves part of the rolling load. Adding the same
    // rigid roll damping a second time would make the flexible rate more negative.
    const flexibleRate = dynamics.rates(rolling, 0, 0, 0).p;
    const rigidRate = rigid.rates(rolling, 0, 0, 0).p;
    assert.ok(rigidRate < flexibleRate && flexibleRate < 0);
  });
  test(id + ' の通常荷重は許容され、想定を超えた正負・偏った荷重で限界に達する', () => {
    assert.equal(solve(1.5, 1.5).failedSide, null);
    assert.equal(solve(1, 4).failedSide, 'right');
    assert.equal(solve(-4, -1).failedSide, 'left');
    assert.equal(solve(4, 4).failedSide, 'both');
    assert.ok(solve(1, 4).utilization > 1);
  });
  test(id + ' の曲げ加速度は翼根荷重に効き、定常たわみでは慣性項が消える', () => {
    const steady = solve(1, 1);
    const delta = .2;
    const vibrating = solve(1, 1, { leftTip: steady.leftTip - delta, rightTip: steady.rightTip + delta });
    close(vibrating.leftTipAcceleration, delta * steady.bendingOmegaRadPerSec ** 2);
    close(vibrating.leftTipAcceleration, -vibrating.rightTipAcceleration);
    assert.ok(vibrating.leftMoment < steady.leftMoment && vibrating.rightMoment > steady.rightMoment);
    close(vibrating.rollMoment, 0);
    const settled = solve(1, 1, { leftTip: steady.leftTip, rightTip: steady.rightTip });
    close(settled.leftTipAcceleration, 0);
    close(settled.rightMoment, steady.rightMoment);
    const damped = solve(1, 1, { leftTip: steady.leftTip, leftTipRate: 1 });
    assert.ok(damped.leftTipAcceleration < 0);
  });
  test(id + ' の翼の変形形状は翼根でゼロ、翼端で全振幅となる', () => {
    const drawing = id === 'ryukai' ? [0, .07, .25, .53, .753] : [0, .10, .36, .74, 1.234];
    drawing.forEach((rise, i) => close(wingBendShape(id, i / 4) * WING_STRUCTURE[id].referenceTip, rise));
    for (const shape of [x => wingBendShape(id, x), wingTwistShape]) {
      close(shape(0), 0);
      close(shape(1), 1);
      let previous = 0;
      for (let station = 1; station <= 32; station++) {
        const next = shape(station / 32);
        assert.ok(next >= previous && next <= 1);
        previous = next;
      }
    }
  });
}
