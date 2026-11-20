import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRUISE_AIRCRAFT, runCruiseTrial } from '../src/domain/powered-cruise.js';
import { GRAVITY } from '../src/domain/units.js';

for (const [id, plane] of Object.entries(CRUISE_AIRCRAFT)) {
  test(plane.name + 'の設計点で60秒間の力の釣合いを保つ', () => {
    const samples = runCruiseTrial(id, plane.power);
    assert.equal(samples.length, 61);
    for (const sample of samples) {
      assert.ok(Math.abs(sample.lift - plane.mass * GRAVITY) < 0.01);
      assert.ok(Math.abs(sample.drag - sample.thrust) < 0.001);
      assert.ok(Math.abs(sample.rpm - plane.rpm) < 0.01);
      assert.ok(Math.abs(sample.speed - plane.speed) < 0.001);
      assert.ok(Math.abs(sample.distance - plane.speed * sample.time) < 0.001);
      assert.ok(Math.abs(sample.height) < 0.001);
    }
  });

  test(plane.name + 'は漕ぎ止めた瞬間の回転を引き継ぎ、徐々に力学的エネルギーを失う', () => {
    const samples = runCruiseTrial(id, 0);
    assert.equal(samples[30].watts, 0);
    assert.equal(samples[30].rpm, samples[29].rpm);
    const energy = ({ speed, height }) => plane.mass * (0.5 * speed ** 2 + GRAVITY * height);
    for (let i = 31; i <= 60; i++) {
      assert.ok(samples[i].rpm < samples[i - 1].rpm);
      if (!plane.windmillDragArea) assert.ok(samples[i].thrust >= 0);
      assert.ok(energy(samples[i]) < energy(samples[i - 1]));
    }
    assert.ok(samples[60].height < 0);
    if (plane.windmillDragArea) assert.ok(samples[60].thrust < 0);
    const powered = runCruiseTrial(id, plane.power * 1.25).at(-1);
    assert.ok(powered.height > 0 && powered.rpm > plane.rpm);
  });
}
