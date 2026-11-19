import { RADIANS_PER_DEGREE as RAD } from '../domain/units.js';
import { byId } from './dom.js';

const DEAD_ZONE = 3;
const FULL_INPUT = 22;

// The vertical in device axes is independent of compass heading. Rotate it
// into display axes first so both landscape grips have the same controls.
export function screenTilt(beta, gamma, screenDegrees) {
  const pitch = beta * RAD, roll = gamma * RAD, angle = screenDegrees * RAD;
  const x = -Math.sin(roll) * Math.cos(pitch), y = Math.sin(pitch), z = Math.cos(roll) * Math.cos(pitch);
  const right = x * Math.cos(angle) - y * Math.sin(angle);
  const top = x * Math.sin(angle) + y * Math.cos(angle);
  return [Math.atan2(top, z) / RAD, Math.atan2(-right, Math.hypot(top, z)) / RAD];
}

export function tiltCommand(angle, neutral) {
  const delta = ((angle - neutral + 540) % 360) - 180;
  if (Math.abs(delta) <= DEAD_ZONE) return 0;
  return Math.sign(delta) * Math.min(1, (Math.abs(delta) - DEAD_ZONE) / (FULL_INPUT - DEAD_ZONE));
}

const preferenceKey = 'birdman.mobile-input.v1';
const sensorTimeout = 2500;

export function setupTiltControl() {
  const mobile = matchMedia('(any-pointer: coarse) and (max-width: 1000px)').matches;
  const api = window.DeviceOrientationEvent;
  const supported = Boolean(api && window.isSecureContext);
  const dialog = byId('mobile-intro'), select = byId('input-mode');
  let last, neutral, angle, timer, generation = 0, listening = false, pending = false;
  let mode = 'touch', calibrated = false;
  const screenAngle = () => screen.orientation?.angle ?? window.orientation ?? 0;

  function notice(text) {
    byId('sensor-status').textContent = text;
    byId('input-notice').textContent = text;
    byId('input-notice').hidden = !text;
  }
  function remember(value) {
    try { localStorage.setItem(preferenceKey, value); } catch { /* Per-visit settings still work. */ }
  }
  function stop(message = '') {
    generation++;
    clearTimeout(timer);
    window.removeEventListener('deviceorientation', receive);
    listening = pending = calibrated = false;
    last = neutral = null;
    mode = select.value = 'touch';
    delete document.body.dataset.tilt;
    notice(message);
  }
  function awaitSensor() {
    clearTimeout(timer);
    timer = setTimeout(() => stop('傾きを取得できないため、タッチで操縦します。'), sensorTimeout);
  }
  function receive(event) {
    if (document.hidden || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
    clearTimeout(timer);
    const nextAngle = screenAngle();
    if (nextAngle !== angle) neutral = null;
    angle = nextAngle;
    last = screenTilt(event.beta, event.gamma, angle);
    if (calibrated && !neutral) {
      neutral = last;
      document.body.dataset.tilt = 'active';
    }
  }
  async function enable() {
    if (!supported) return stop('この端末ではタッチで操縦します。');
    if (listening || pending) return;
    pending = true;
    mode = select.value = 'tilt';
    const request = ++generation;
    try {
      const allowed = !api.requestPermission || await api.requestPermission() === 'granted';
      if (request !== generation) return;
      if (!allowed) return stop('傾きの利用が許可されなかったため、タッチで操縦します。');
      listening = true;
      window.addEventListener('deviceorientation', receive);
      notice('');
      awaitSensor();
    } catch {
      if (request === generation) stop('傾きを利用できないため、タッチで操縦します。');
    } finally {
      if (request === generation) pending = false;
    }
  }
  if (mobile) {
    byId('mobile-input-settings').hidden = false;
    select.options[0].disabled = !supported;
    let saved;
    try { saved = localStorage.getItem(preferenceKey); } catch { /* Show the welcome for this visit. */ }
    if (!supported) {
      byId('mobile-intro-title').textContent = 'タッチで操縦';
      byId('mobile-intro-body').textContent = '横スワイプで発進方向を決めます。飛行中は画面の前・後と左右のラダーで操縦できます。';
    }
    if (saved === 'tilt' && supported) mode = select.value = 'tilt';
    else select.value = 'touch';
    if (!saved) dialog.showModal();
    function accept() {
      remember(supported ? 'tilt' : 'touch');
      if (supported) enable(); // iOS needs the OK button's user activation.
      dialog.close();
    }
    byId('accept-mobile-input').onclick = accept;
    dialog.oncancel = () => stop();
    select.onchange = () => {
      remember(select.value);
      if (select.value === 'tilt') {
        calibrated = ['countdown', 'flight'].includes(document.body.dataset.stage);
        enable();
      } else stop();
    };
    function resetSample() {
      if (!listening) return;
      last = neutral = null;
      clearTimeout(timer);
      if (!document.hidden) awaitSensor();
    }
    document.addEventListener('visibilitychange', resetSample);
    screen.orientation?.addEventListener('change', resetSample);
    window.addEventListener('orientationchange', resetSample);
  }
  return {
    prepare() { if (mode === 'tilt') enable(); },
    calibrate() {
      if (mode !== 'tilt') return;
      calibrated = true;
      if (last && angle === screenAngle()) {
        neutral = last;
        document.body.dataset.tilt = 'active';
      } else if (listening) awaitSensor();
    },
    end() {
      neutral = null;
      calibrated = false;
      delete document.body.dataset.tilt;
    },
    value(axis) {
      return last && neutral && angle === screenAngle() ? tiltCommand(last[axis - 1], neutral[axis - 1]) : 0;
    },
  };
}
