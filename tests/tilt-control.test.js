import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenTilt, setupTiltControl, tiltCommand } from '../src/presentation/tilt-control.js';

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

function mobileControls(t, saved, permission) {
  const elements = {
    'mobile-intro': { showModal() {}, close() {} },
    'input-mode': { options: [{}] },
    'mobile-input-settings': {}, 'accept-mobile-input': {}, 'input-notice': {}, 'sensor-status': {},
  };
  const window = Object.assign(new EventTarget(), {
    DeviceOrientationEvent: { requestPermission: permission }, isSecureContext: true,
  });
  const document = Object.assign(new EventTarget(), {
    body: { dataset: {} }, getElementById: id => elements[id],
  });
  const preference = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  for (const [key, value] of Object.entries({
    window, document, localStorage: preference, screen: {}, matchMedia: () => ({ matches: true }),
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
  }
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const control = setupTiltControl();
  return {
    control, mode: elements['input-mode'], accept: elements['accept-mobile-input'].onclick,
    saved: () => saved,
    sample(beta, gamma) { window.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta, gamma })); },
  };
}

test('初回の傾き設定は許可と有効な計測値がそろってから保存する', async t => {
  const mobile = mobileControls(t, null, async () => 'granted');
  mobile.accept();
  assert.equal(mobile.saved(), null);
  await Promise.resolve();
  mobile.sample(null, 0);
  assert.equal(mobile.saved(), null);
  mobile.sample(30, 0);
  assert.equal(mobile.saved(), 'tilt');
  mobile.mode.value = 'touch';
  mobile.mode.onchange();
  assert.equal(mobile.saved(), 'touch');
});

test('保存済みの傾き設定でも許可を拒否されたらタッチを保存する', async t => {
  const mobile = mobileControls(t, 'tilt', async () => 'denied');
  mobile.control.prepare();
  await Promise.resolve();
  assert.equal(mobile.mode.value, 'touch');
  assert.equal(mobile.saved(), 'touch');
});

test('設定画面から傾きを選んで計測がタイムアウトしたらタッチを保持する', async t => {
  const mobile = mobileControls(t, 'touch', async () => 'granted');
  mobile.mode.value = 'tilt';
  mobile.mode.onchange();
  assert.equal(mobile.saved(), 'touch');
  await Promise.resolve();
  t.mock.timers.tick(2500);
  mobile.sample(20, 0);
  assert.equal(mobile.mode.value, 'touch');
  assert.equal(mobile.saved(), 'touch');
});
