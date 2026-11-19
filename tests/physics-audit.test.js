import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, Quaternion, Vector3 } from 'three';
import { horizontalTailLoad } from '../src/domain/aerodynamic-lift.js';
import { aircraftDynamics, releaseState } from '../src/domain/aircraft-dynamics.js';
import { BASE_DESIGN, launchProfile, simulateFlight } from '../src/domain/flight.js';
import { geometryAt, hullAtRudder, landingMeasurement } from '../src/domain/water-contact.js';
import { windAt } from '../src/domain/weather.js';

const hull = [[-1, -0.45], [1, -0.45], [0, 0.5]];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} vs ${expected}`);

test('曲がる基準航跡の対気速度は台に固定された風と対地速度のベクトル差に等しい', () => {
  for (const weather of ['head', 'tail', 'cross']) {
    const run = simulateFlight(BASE_DESIGN, hull, { direction: 20, weather });
    for (const pose of run.samples) {
      const wind = windAt(weather, pose.pathLength, pose.t);
      const forward = pose.groundSpeed * Math.cos(pose.track);
      const right = pose.groundSpeed * Math.sin(pose.track);
      near(pose.headwind, wind.headwind * Math.cos(pose.track) + wind.crosswind * Math.sin(pose.track));
      near(pose.speed, Math.hypot(forward + wind.headwind, right + wind.crosswind, pose.verticalSpeed - wind.updraft));
    }
  }
});

test('傾きゼロ・横風ありの離台時に基準機と手動機の縦の力が一致する', () => {
  const launch = launchProfile();
  const state = releaseState(launch, true, true);
  const options = { pilot: true, wind: true, weather: 'cross', onsetMetres: 0, returnSeconds: 0.45 };
  const rates = referenceControl =>
    aircraftDynamics(BASE_DESIGN, launch, { ...options, referenceControl }).rates(state, 0, 0, 0);
  const ref = rates(true), manual = rates(false);
  near(ref.u, manual.u);
  near(ref.w, manual.w);
});

test('前・右・下の機体軸で求めた横速度と迎角が描画姿勢の逆回転と一致する', () => {
  const launch = launchProfile(1, 0, 20);
  const dynamics = aircraftDynamics(BASE_DESIGN, launch, { referenceControl: false, wind: true, weather: 'cross' });
  for (const bank of [-0.3, 0.22]) {
    const state = { ...releaseState(launch, true, true), bank, heading: 0.73, pitch: -0.17, u: 8, v: -0.5, w: -1 };
    const air = dynamics.airflow(state, 0);
    const wind = windAt('cross', 0, 0);
    const { u, v, w, pitch, heading } = state;
    const forward = u * Math.cos(heading) - v * Math.sin(heading) + wind.headwind;
    const right = u * Math.sin(heading) + v * Math.cos(heading) + wind.crosswind;
    const rotation = new Quaternion().setFromEuler(new Euler(pitch, -heading, -bank, 'YXZ'));
    const body = new Vector3(right, w - wind.updraft, -forward).applyQuaternion(rotation.invert());
    near(air.speed, body.length());
    near(air.beta, Math.atan(body.x / body.length()) * 180 / Math.PI);
    near(air.alpha, Math.atan2(-body.y, -body.z));
  }
});

test('傾斜・偏向した機体外形の最低点と最後尾が独立した3D座標変換と一致する', () => {
  const fixed = [[-1, -0.2, 0], [1, 0.1, 4], [1, 0.1, -4]];
  const fin = [[3, -0.1, 0], [3, 1, 0]];
  const hingeZ = 2;
  const hull = Object.assign([...fixed, ...fin], { fixed, fin, hingeZ, spatial: [...fixed, ...fin] });
  const pitch = 0.12, heading = 0.6;
  for (const bank of [-0.3, 0.3]) for (const rudder of [-10, 10]) {
    const deflected = hullAtRudder(hull, rudder);
    const shape = geometryAt(pitch, deflected, bank);
    const pose = { forward: 25, right: -5, heading };
    const launch = { edgeForward: 2, edgeRight: 3 };
    const landing = landingMeasurement(pose, shape, launch);
    const attitude = new Euler(pitch, -heading, -bank, 'YXZ');
    const worlds = [...fixed, ...fin].map(([z, y, x], i) => {
      const point = new Vector3(x, y, z);
      if (i >= fixed.length) {
        point.z -= hingeZ;
        point.applyAxisAngle(new Vector3(0, 1, 0), rudder * Math.PI / 180);
        point.z += hingeZ;
      }
      return point.applyEuler(attitude);
    });
    const lowest = worlds.reduce((a, b) => a.y < b.y ? a : b);
    const aft = p => p.z * Math.cos(heading) - p.x * Math.sin(heading);
    const tail = worlds.reduce((a, b) => aft(a) > aft(b) ? a : b);
    near(shape.bottom, lowest.y);
    near(landing.contactRight, pose.right + lowest.x);
    near(landing.contactForward, pose.forward - lowest.z);
    near(landing.tailRight, pose.right + tail.x);
    near(landing.tailForward, pose.forward - tail.z);
    near(landing.distance, Math.hypot(pose.right + tail.x - launch.edgeRight, pose.forward - tail.z - launch.edgeForward));
  }
});

test('局所風で左右の半翼に生じる揚力差が正負のロールを生む', () => {
  const launch = launchProfile();
  const state = { ...releaseState(launch, true, true), u: 10.5, w: 0, q: 0 };
  function rollingAccelerationBeyondSideslip(weather, gustOffset) {
    const d = aircraftDynamics(BASE_DESIGN, launch, { weather, gustOffset, wind: true, pilot: true, returnSeconds: .45 });
    const air = d.airflow(state, 0);
    const rollFromBeta = -.004723 * air.beta * (.5 * 1.164 * air.speed ** 2) * 17.92 * 24.514 / 993.022;
    return d.rates(state, 0, 0, 0).p - rollFromBeta;
  }
  near(rollingAccelerationBeyondSideslip('cross', 0), 0);
  assert.ok(rollingAccelerationBeyondSideslip('day-hard', 1) > .01);
  assert.ok(rollingAccelerationBeyondSideslip('day-hard', 2) < -.01);
});

test('尾翼揚力は尾翼位置の流速に直交し、並進と回転の仕事率の和がゼロになる', () => {
  const arm = 2.9, density = 1.164, area = 1.736;
  const axialSpeed = 8;
  for (const downSpeed of [-1, 0, 1]) for (const q of [-0.4, 0, 0.25]) {
    const alpha = Math.atan2(downSpeed, axialSpeed);
    const tail = horizontalTailLoad({ axialSpeed, downSpeed, alpha }, q, arm, density, area, 4, 0.02, 1.4);
    const forward = tail.lift * Math.sin(alpha) - tail.drag * Math.cos(alpha);
    const translationPower = axialSpeed * forward - downSpeed * tail.upwardNormal;
    const pitchPower = -arm * tail.upwardNormal * q;
    near(translationPower + pitchPower, 0);
    const localDown = downSpeed + arm * q;
    const speed = Math.hypot(axialSpeed, localDown);
    const expectedCL = 4 * (Math.atan2(localDown, axialSpeed) + 0.02);
    near(tail.upwardNormal, 0.5 * density * speed * area * expectedCL * axialSpeed);
  }
});
