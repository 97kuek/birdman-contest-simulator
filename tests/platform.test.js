import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Raycaster, Vector3 } from 'three';
import { launchProfile, RAMP_LENGTH } from '../src/domain/launch.js';
import { deckRun } from '../src/rendering/launch-deck.js';
import { createPlatform } from '../src/rendering/platform.js';

test('全発進方向で塗装した助走面が物理モデルの勾配・台端に合う', () => {
  const platform = createPlatform({ shoreDistance: 168 });
  platform.updateMatrixWorld(true);
  const surface = platform.getObjectByName('助走面・作業床・木製搬入路');
  const ray = new Raycaster(), down = new Vector3(0, -1, 0);
  for (const direction of [-30, 0, 30]) {
    const launch = launchProfile(1, 0, direction);
    for (const travel of [.2, 2.5, 5.3, 8.7, 9.98]) {
      ray.set(new Vector3(travel * launch.rightStep, 15, deckRun - travel * launch.forwardStep), down);
      const hit = ray.intersectObject(surface)[0];
      assert.ok(hit);
      assert.ok(Math.abs(hit.point.y - launch.edgeHeight - (RAMP_LENGTH - travel) * launch.dropStep) < .005);
    }
  }
});

test('飛行する機体の翼が先に台面を横切り、低い位置から戻ると支柱にも当たる', () => {
  const platform = createPlatform();
  const hit = platform.userData.contact([[0, 0, 0], [0, 0, -4]]);
  const pose = (right, height, forward) => ({ right, height, forward, pitch: 0, bank: 0, heading: 0 });
  const onWing = hit(pose(9, 12, -9), pose(9, 9, -9));
  assert.ok(onWing > .4 && onWing < .6);
  assert.equal(hit(pose(9, 12, -9), pose(9, 12, 9)), null);
  const tube = hit(pose(0, 3, 1), pose(0, 3, -2));
  assert.ok(tube > .5 && tube < .7);
  assert.equal(hit(pose(30, 4, 2), pose(30, 4, -2)), null);
});

test('表示用の全機体が正面と左右の限界方向で正常に助走・離台する', async () => {
  const { FlightSession } = await import('../src/application/flight-session.js');
  const { modelHull } = await import('../src/rendering/collision-hull.js');
  const { createRenAircraft } = await import('../src/rendering/aircraft/ren.js');
  const { createAircraft } = await import('../src/rendering/aircraft.js');
  const { createQx25Aircraft } = await import('../src/rendering/aircraft/qx25.js');
  const platform = createPlatform();
  for (const [id, factory] of [['ren', createRenAircraft], ['ryukai', createAircraft], ['qx25', createQx25Aircraft]]) {
    const hull = modelHull(factory());
    const session = new FlightSession(hull, 'calm', undefined, undefined, id, platform.userData.contact(hull));
    for (const direction of [-30,0,30]) {
      session.select('calm',direction);
      const attempt = session.startAttempt();
      for (const fraction of [.1,.4,.8,.99,1]) {
        assert.notEqual(attempt.advance(fraction*session.launch.duration,0,0).phase, 'platform-contact', id+' '+direction);
      }
      assert.equal(attempt.advance(session.launch.duration+2,0,0).phase,'glide');
    }
  }
});

test('台に触れた試技は接触時に止まり、距離を採点しない', async () => {
  const { FlightSession } = await import('../src/application/flight-session.js');
  const hull = [[0,0,0],[1,0,0]];
  for (const duringRamp of [true, false]) {
    const collision = from => (from.rampTravel !== undefined) === duringRamp ? .5 : null;
    const session = new FlightSession(hull, 'calm', undefined, undefined, 'ren', collision);
    const attempt = session.startAttempt();
    const elapsed = session.launch.duration + 1;
    const frame = attempt.advance(elapsed, 0, 0);
    assert.equal(frame.phase, 'platform-contact');
    assert.equal(session.latest, undefined);
    assert.equal(attempt.advance(elapsed + 5, 0, 0).sample.t, frame.sample.t);
    if (duringRamp) assert.ok(frame.sample.rampTravel < 10);
    else assert.ok(frame.sample.t > 0 && frame.sample.t < 1/120);
  }
});
