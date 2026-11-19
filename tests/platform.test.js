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
