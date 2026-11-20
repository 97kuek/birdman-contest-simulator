import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldCallForLanding } from '../src/domain/runway-support.js';
import { createRunwayTrial } from '../src/application/runway-trial.js';
import { createRenAircraft } from '../src/rendering/aircraft/ren.js';
import { createLandingRoll } from '../src/domain/runway-rollout.js';
import { geometryAt, hullAtControls } from '../src/domain/water-contact.js';
import { modelHull } from '../src/rendering/collision-hull.js';

const hull = modelHull(createRenAircraft());

test('無風・ペダル停止でもスターターが押し出し、手放した後は再び押さずに停止する', () => {
  const trial = createRunwayTrial(hull);
  assert.equal(trial.onGround.forward, 38);
  assert.equal(trial.onGround.groundSpeed, 0);
  assert.equal(trial.onGround.starterAttached, true);
  assert.equal(trial.onGround.starterForceN, 0);
  const push = trial.advance(2, 0, 0, 0);
  assert.ok(push.sample.forward > 10 && push.sample.groundSpeed > 0);
  assert.ok(push.sample.starterForceN > 0);
  assert.equal(push.sample.watts, 0);
  assert.equal(push.sample.crankAngle, 0);
  const coast = trial.advance(6, 0, 0, 0);
  assert.equal(coast.phase, 'roll');
  assert.equal(coast.sample.starterAttached, false);
  assert.equal(coast.sample.starterForceN, 0);
  assert.ok(Math.abs(coast.sample.starterReleasedAt - 5.5) < .01);
  const rest = trial.advance(40, 0, 0, 0);
  assert.equal(rest.sample.groundSpeed, 0);
  assert.equal(rest.sample.bottomHeight, 0);
  assert.equal(rest.sample.height, trial.onGround.height);
  assert.equal(trial.advance(50, 0, 0, 0).sample.forward, rest.sample.forward);
  assert.equal(trial.duration, null);
  assert.throws(() => trial.advance(51, 0, 0, -1), RangeError);
});

test('両輪が浮くまで水平滑走し、無風直進の漕ぎ止めでは舗装上に接地して停止する', () => {
  const trial = createRunwayTrial(hull);
  const pre = trial.advance(8, 0, 0, 300);
  const climb = trial.advance(35, 0, 0, 300);
  assert.equal(pre.phase, 'roll');
  assert.equal(climb.phase, 'flight');
  for (const sample of [pre.sample, climb.sample]) {
    assert.equal(sample.starterAttached, false);
    assert.equal(sample.starterForceN, 0);
    assert.ok(Math.abs(sample.starterReleasedAt - 4.39) < .02);
    assert.ok(Math.abs(sample.starterReleaseForward - 53.13) < .1);
  }
  assert.ok(trial.duration > 10 && trial.duration < 12);
  assert.ok(climb.sample.forward > pre.sample.forward && climb.sample.pathLength > pre.sample.pathLength);
  assert.ok(climb.sample.bottomHeight > .5 && climb.sample.verticalSpeed > 0);
  assert.equal(climb.sample.right, 0);
  assert.equal(climb.sample.courseLeg, undefined);
  trial.advance(50, 0, 0, 300);
  const contact = trial.advance(73, 0, 0, 0);
  const slow = trial.advance(78, 0, 0, 0);
  const stopped = trial.advance(105, 0, 0, 0);
  assert.equal(contact.phase, 'rollout');
  assert.equal(slow.phase, 'rollout');
  assert.equal(slow.sample.starterForceN, 0);
  assert.equal(stopped.sample.starterReleasedAt, pre.sample.starterReleasedAt);
  assert.equal(slow.sample.bottomHeight, 0);
  assert.ok(slow.sample.t > contact.sample.t && slow.sample.forward > contact.sample.forward);
  assert.ok(slow.sample.groundSpeed < contact.sample.groundSpeed);
  assert.equal(stopped.phase, 'landed');
  assert.equal(stopped.sample.groundSpeed, 0);
  assert.ok(stopped.sample.forward < 850);
  assert.deepEqual(stopped, trial.advance(110, 1, 1, 300));
});

test('直進の北端と横風の側端はフレームを飛ばしても最初の逸脱地点で試技を終了する', () => {
  for (const weather of ['calm', 'cross']) {
    const trial = createRunwayTrial(hull, weather);
    const result = trial.advance(180, 0, 0, 300);
    assert.equal(result.phase, 'aborted');
    assert.equal(result.reason, 'off-runway');
    if (weather === 'calm') assert.ok(Math.abs(result.sample.forward - 858) < 1e-6);
    else {
      assert.ok(Math.abs(Math.abs(result.sample.right) - 23) < 1e-6);
      assert.ok(result.sample.forward < 850);
    }
  }
});

test('着陸滑走で北端の余裕8 mを使い切った地点で終了する', () => {
  const trial = createRunwayTrial(hull);
  trial.advance(76, 0, 0, 300);
  const contact = trial.advance(113, 0, 0, 0);
  assert.equal(contact.phase, 'rollout');
  const atEnd = trial.advance(180, 0, 0, 0);
  assert.equal(atEnd.phase, 'aborted');
  assert.equal(atEnd.reason, 'off-runway');
  assert.ok(Math.abs(atEnd.sample.forward - 858) < 1e-6);
  assert.ok(atEnd.sample.groundSpeed > 0);
});

test('「ペラ回します」からGOまで車輪を保持し、回転位相・余力を発進時に引き継ぐ', () => {
  const trial = createRunwayTrial(hull, 'calm', 0, { preSpin: true });
  const still = trial.onGroundAt(0), spinning = trial.onGroundAt(2), go = trial.onGroundAt(4.1);
  assert.equal(still.rpm, 0);
  assert.ok(spinning.rpm > 0 && go.rpm > spinning.rpm);
  for (const s of [still, spinning, go]) {
    assert.equal(s.forward, 38);
    assert.equal(s.groundSpeed, 0);
    assert.equal(s.starterForceN, 0);
  }
  assert.ok(go.reserve < spinning.reserve && go.crankAngle > spinning.crankAngle);
  const rolling = trial.advance(0, 0, 0, 300).sample;
  for (const key of ['rpm', 'crankAngle', 'propellerAngle', 'reserve', 'watts']) assert.equal(rolling[key], go[key]);
  assert.deepEqual(trial.onGroundAt(15), go);
});

test('単列車輪は接地時の傾きと角速度を残し、左右反転した着陸を翼係が到着後に支える', () => {
  function land(turn) {
    const trial = createRunwayTrial(hull);
    trial.advance(50, 0, 0, 300);
    trial.advance(70, 0, 0, 0);
    let before, first, earliest, maxBank = 0;
    for (let step = 70 * 30 + 1; step < 116 * 30; step++) {
      const t = step / 30;
      const { phase, sample } = trial.advance(t, 0, t <= 73 ? turn : 0, 0);
      assert.notEqual(phase, 'aborted');
      if (phase === 'flight') { before = sample; continue; }
      first ??= sample;
      assert.ok(Math.abs(sample.bank) < .3);
      if (sample.caughtWing === null) {
        assert.equal(sample.wingCaughtAt, null);
        maxBank = Math.max(maxBank, Math.abs(sample.bank));
      } else {
        earliest ??= sample;
        assert.ok(sample.catchers.left.holding || sample.catchers.right.holding);
      }
      if (phase === 'landed') {
        assert.equal(sample.caughtWing, 'both');
        assert.ok(sample.catchers.frame.holding && sample.catchers.tail.holding);
        assert.ok(sample.wingCaughtAt > sample.catchReadyAt && sample.catchReadyAt === sample.touchdownAt);
        assert.ok(Math.abs(sample.bank) < .005);
        return { before, first, earliest, maxBank };
      }
    }
    assert.fail('Rollout did not finish.');
  }
  const straight = land(0), left = land(-1), right = land(1);
  assert.equal(straight.maxBank, 0);
  for (const [landing, sign] of [[left, -1], [right, 1]]) {
    assert.ok(sign * landing.first.bank > .03 && sign * landing.first.rollRate > .01);
    assert.ok(Math.abs(landing.first.bank - landing.before.bank) < .005);
    assert.ok(Math.abs(landing.first.rollRate - landing.before.rollRate) < .005);
    assert.ok(landing.maxBank > Math.abs(landing.first.bank));
    assert.ok(landing.maxBank < 7 * Math.PI / 180);
    assert.ok(['left', 'right'].includes(landing.earliest.caughtWing));
    assert.ok(landing.earliest.groundSpeed > 3);
    assert.ok(sign * landing.earliest.bank > .08);
  }
  assert.notEqual(left.earliest.caughtWing, right.earliest.caughtWing);
  assert.ok(Math.abs(left.maxBank - right.maxBank) < .0001);
  assert.ok(Math.abs(left.earliest.wingCaughtAt - right.earliest.wingCaughtAt) < .001);
});

test('追走車の合図は進行端を基準にし、高度が高いほど手前で予告する', () => {
  const sample = { forward: 600, track: 0, groundSpeed: 7, bottomHeight: 1 };
  assert.equal(shouldCallForLanding(sample, 850), false);
  assert.equal(shouldCallForLanding({ ...sample, bottomHeight: 4 }, 850), true);
  assert.equal(shouldCallForLanding({ ...sample, forward: 100, track: Math.PI }, 850), true);
  assert.equal(shouldCallForLanding({ ...sample, track: Math.PI / 2 }, 850), false);
});

test('予回転して発進し、設計者の合図で漕ぎ止めると無風では滑走路内で停止する', () => {
  for (const watts of [203, 300]) {
    const trial = createRunwayTrial(hull, 'calm', 0, { preSpin: true });
    let call, frame;
    for (let step = 1; step <= 1600; step++) {
      frame = trial.advance(step / 10, 0, 0, call ? 0 : watts);
      if (!call && frame.phase === 'flight' && shouldCallForLanding(frame.sample, 850)) call = frame.sample;
      if (frame.phase === 'landed' || frame.phase === 'aborted') break;
    }
    assert.ok(call && call.forward > 400 && call.forward < 650);
    assert.equal(frame.phase, 'landed');
    assert.equal(frame.sample.groundSpeed, 0);
    assert.ok(frame.sample.forward > call.forward && frame.sample.forward < 850);
  }
});

test('翼端で接地すると接地側へ首を振り、水平の両輪接地では回頭しない', () => {
  const airborne = createRunwayTrial(hull).advance(32, 0, 0, 300).sample;
  function touch(degrees) {
    const bank = degrees * Math.PI / 180;
    const geom = geometryAt(0, hullAtControls(hull, 0, 0, airborne.wing), bank);
    const contact = { ...airborne, forward: 480, t: 0, heading: 0, track: 0, pitch: 0, pitchRate: 0,
      yawRate: 0, rollRate: Math.sign(bank) * .18, bank, height: -geom.bottom, contactSide: geom.contactSide,
      verticalSpeed: -.36, groundSpeed: 7 };
    const advance = createLandingRoll(hull, contact, 'calm', 0);
    const sample = { ...contact };
    let maxFriction = 0;
    for (let tick = 1; tick <= 240; tick++) {
      sample.t = tick / 120;
      sample.forward += sample.groundSpeed * Math.cos(sample.track) / 120;
      sample.right += sample.groundSpeed * Math.sin(sample.track) / 120;
      advance(sample, 1 / 120);
      maxFriction = Math.max(maxFriction, sample.tipDragN);
    }
    return { yaw: sample.heading, track: sample.track, maxFriction };
  }
  const left = touch(-18), right = touch(18), level = touch(0);
  assert.ok(left.yaw < -.1 && right.yaw > .1 && right.maxFriction > 0);
  assert.ok(left.track < 0 && right.track > 0);
  assert.ok(Math.abs(left.yaw + right.yaw) < 1e-6);
  assert.equal(level.yaw, 0);
  assert.equal(level.maxFriction, 0);
});

test('発進中の車輪の浮き沈みで出力を切らず、中立舵のまま浮上を続ける', () => {
  for (const [weather, seed, seconds] of [['day-normal', 0, 22], ['day-normal', 8, 22], ['day-hard', 1.5, 13], ['day-hard', 11.5, 12], ['night-hard', 2, 22]]) {
    const trial = createRunwayTrial(hull, weather, seed, { preSpin: true });
    let confirmed = false;
    for (let tick = 1; tick <= seconds * 30; tick++) {
      const { phase, sample } = trial.advance(tick / 30, 0, 0, 300);
      assert.ok(['roll', 'flight'].includes(phase), weather + ' ' + seed + ' ' + phase);
      assert.ok(sample.watts > 295);
      assert.ok(sample.bottomHeight >= -1e-8);
      assert.equal(sample.liftOffAt !== null, phase === 'flight');
      if (phase === 'flight') confirmed = true;
      if (confirmed) assert.equal(phase, 'flight');
    }
    assert.ok(confirmed);
    assert.ok(trial.advance(seconds).sample.bottomHeight > .1);
  }
});

test('減速合図で漕ぎ止めた試技では後部の係が走行中に追いつき、握ってから制動する', () => {
  const trial = createRunwayTrial(hull, 'calm', 0, { preSpin: true });
  let called = false, touch, brake, stop;
  for (let tick = 1; tick <= 140 * 30; tick++) {
    const { phase, sample } = trial.advance(tick / 30, 0, 0, called ? 0 : 203);
    if (phase === 'flight' && shouldCallForLanding(sample, 850)) called = true;
    if (phase === 'rollout') {
      touch ??= sample;
      if (sample.catcherBrakeN > 0) {
        assert.ok(sample.catchers.frame.holding || sample.catchers.tail.holding);
        brake ??= sample;
      }
      if (!sample.groundSpeed) stop ??= sample;
    }
    if (phase === 'landed') { stop ??= sample; break; }
  }
  assert.ok(touch && brake && stop);
  assert.ok(brake.t - touch.t < 10 && brake.groundSpeed > 4);
  assert.ok(stop.t > brake.t && stop.forward > brake.forward);
});
