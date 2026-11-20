import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, Vector3 } from 'three';
import { createRunwayTrial } from '../src/application/runway-trial.js';
import { CG_HEIGHT } from '../src/domain/aircraft-dynamics.js';
import { createRenAircraft } from '../src/rendering/aircraft/ren.js';
import { modelHull } from '../src/rendering/collision-hull.js';
import { createRunwayCrew } from '../src/rendering/runway-crew.js';

test('地上班は機体を押し、手放した後は翼端を追い、着地後は近くのキャッチャーが左右の翼を支える', () => {
  const crew = createRunwayCrew(), base = new Group();
  const hull = modelHull(createRenAircraft());
  const trial = createRunwayTrial(hull);
  const pusher = crew.group.getObjectByName('左フレームスターター');
  const follower = crew.group.getObjectByName('右翼スターター');
  const car = crew.group.getObjectByName('追走車');
  function show(sample, phase, time) {
    base.position.set(sample.right, sample.height - CG_HEIGHT, -sample.forward);
    crew.update(sample, phase, time, base);
  }
  show(trial.onGround, 'ready', 0);
  function checkGrips(frameCrew, tailCrew) {
    const palm = new Vector3();
    for (const [hand, sign] of [['左手', -1], ['右手', 1]]) {
      const frame = base.localToWorld(new Vector3(sign * .027, 1.17 + sign * .055, .67));
      assert.ok(frameCrew.getObjectByName(hand).getWorldPosition(palm).distanceTo(frame) < .01);
      const tail = base.localToWorld(new Vector3(.045, 1.345, 5.75 + sign * .13));
      assert.ok(tailCrew.getObjectByName(hand).getWorldPosition(palm).distanceTo(tail) < .01);
    }
  }
  for (const [side, person] of [[-1,pusher],[1,crew.group.getObjectByName('右フレームスターター')]]) {
    for (const [hand, sign] of [['左手',-1],['右手',1]]) {
      const grip = base.localToWorld(new Vector3(side*.045, 1.345, 1.92 + sign*.13));
      assert.ok(person.getObjectByName(hand).getWorldPosition(new Vector3()).distanceTo(grip) < .01);
    }
  }
  assert.ok(-car.position.z - 2.35 > 0 && -car.position.z - 2.35 < .5);
  assert.ok(trial.onGround.forward + car.position.z > 35);
  const start = pusher.position.clone();
  let frame, heldAfterLift = false;
  for (let t = .5; t <= 110; t += .5) {
    frame = trial.advance(t, 0, 0, t <= 50 ? 300 : 0);
    show(frame.sample, frame.phase, t);
    const held = follower.getObjectByName('翼の保持索').visible;
    assert.equal(held, !crew.wingFollowersReleased);
    if (frame.phase === 'roll' && !frame.sample.starterAttached) assert.equal(held, true);
    if (frame.phase === 'flight' && t < frame.sample.liftOffAt + 1) {
      assert.equal(held, true);
      heldAfterLift = true;
    }
    if (t === 2) {
      assert.ok(pusher.position.z < start.z - 1);
      assert.equal(follower.getObjectByName('翼の保持索').visible, true);
    }
    if (t === 20) {
      assert.ok(follower.position.z < pusher.position.z - 15);
      assert.ok(Math.abs(pusher.position.x) > 15);
      assert.equal(follower.getObjectByName('翼の保持索').visible, false);
    }
    assert.ok(Math.abs(car.position.x) < .001 && frame.sample.forward + car.position.z >= (frame.phase === 'landed' ? 19.99 : 35.29));
  }
  assert.ok(heldAfterLift);
  assert.equal(frame.phase, 'landed');
  show(frame.sample, 'landed', 135);
  assert.ok(frame.sample.forward + car.position.z < 21);
  const holding = crew.group.children.filter(person => person.name.includes('キャッチャー') && person.visible && person.getObjectByName('翼の保持索')?.visible);
  assert.equal(holding.length, 2);
  const receivers = crew.group.children.filter(person => person.isGroup && person.visible && person.name.includes('キャッチャー'));
  assert.equal(receivers.length, 4);
  assert.ok(receivers.some(person => person.name.startsWith('テール')));
  checkGrips(receivers.find(person => person.name.startsWith('フレーム')), receivers.find(person => person.name.startsWith('テール')));
  assert.ok(holding.some(person => person.position.x > 0));
  assert.ok(holding.some(person => person.position.x < 0));
  show(trial.onGround, 'ready', 0);
  assert.ok(pusher.position.distanceTo(start) < 1e-9);
  assert.equal(crew.wingFollowersReleased, false);
  const noPedals = createRunwayTrial(hull);
  const groundStop = noPedals.advance(60, 0, 0, 0);
  show(groundStop.sample, groundStop.phase, 60);
  assert.equal(groundStop.sample.starterAttached, false);
  assert.equal(crew.wingFollowersReleased, true);
  assert.equal(follower.getObjectByName('翼の保持索').visible, false);
});

test('追走車は左右ラダーの切り返しでも緩やかに向きを変え、カメラは前席にとどまる', () => {
  const base = createRenAircraft();
  const trial = createRunwayTrial(modelHull(base), 'calm', 0, { preSpin: true });
  const crew = createRunwayCrew();
  const car = crew.supportCar;
  const mount = car.getObjectByName('chase-car-camera');
  const seat = mount.position.clone();
  crew.update(trial.onGround, 'ready', 0, base);
  let maxYaw = 0;
  for (let step = 1; step < 45 * 30; step++) {
    const time = step / 30;
    const rudder = time > 24 && time < 31 ? 1 : time >= 31 && time < 37 ? -1 : 0;
    const { sample, phase } = trial.advance(time, 0, rudder, 300);
    const previousYaw = car.rotation.y;
    crew.update(sample, phase, time, base);
    maxYaw = Math.max(maxYaw, Math.abs(car.rotation.y));
    assert.ok(Math.abs(car.rotation.y - previousYaw) * 30 < .15);
    const localEye = car.worldToLocal(mount.getWorldPosition(new Vector3()));
    assert.ok(localEye.distanceTo(seat) < 1e-6);
    if (phase === 'aborted') break;
  }
  assert.ok(maxYaw > .04);
});
