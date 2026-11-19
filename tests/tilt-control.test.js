import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenTilt, tiltCommand } from '../src/presentation/tilt-control.js';

test('持ち方を中立とし、手ぶれ・連続入力・最大舵角を扱う', () => {
  const [pitch, roll] = screenTilt(40, 0, 0);
  assert.equal(tiltCommand(pitch, pitch), 0);
  assert.equal(tiltCommand(pitch - 2, pitch), 0);
  assert.equal(tiltCommand(screenTilt(28, 0, 0)[0], pitch).toFixed(2), '-0.47');
  assert.equal(tiltCommand(screenTilt(72, 0, 0)[0], pitch), 1);
  assert.ok(tiltCommand(screenTilt(40, 12, 0)[1], roll) > 0);
  assert.equal(tiltCommand(-179, 179), 0);
});

test('縦・左右の横持ち・上下逆でも、画面右端を下げれば右ラダーになる', () => {
  for (const [angle, beta, gamma] of [[0,0,12],[90,12,0],[270,-12,0],[180,0,-12]]) {
    const [pitch, roll] = screenTilt(beta, gamma, angle);
    assert.ok(Math.abs(pitch) < 1e-9);
    assert.ok(Math.abs(roll - 12) < 1e-9);
  }
});
