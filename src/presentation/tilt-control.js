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

export function setupTiltControl() {
  const toggle = byId('tilt-enable'), status = byId('tilt-status');
  const api = window.DeviceOrientationEvent;
  const supported = api && window.isSecureContext && navigator.maxTouchPoints > 0;
  byId('tilt-option').hidden = !supported;
  const screenAngle = () => screen.orientation?.angle ?? window.orientation ?? 0;
  let last, neutral, angle, timer, generation = 0, listening = false;
  function hint(text) {
    status.textContent = text;
    status.hidden = !text;
  }
  function stop(message = '') {
    generation++;
    clearTimeout(timer);
    window.removeEventListener('deviceorientation', receive);
    listening = false;
    last = neutral = null;
    toggle.checked = false;
    delete document.body.dataset.tilt;
    hint(message);
  }
  function receive(event) {
    if (document.hidden) return;
    if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) {
      if (neutral) stop('傾きを取得できないためタッチで操縦します');
      return;
    }
    const nextAngle = screenAngle();
    const rotated = angle !== nextAngle;
    angle = nextAngle;
    last = screenTilt(event.beta, event.gamma, angle);
    if (timer) { clearTimeout(timer); timer = null; }
    if (!status.hidden) hint('');
    if (document.body.dataset.tilt && (!neutral || rotated)) neutral = last;
  }
  toggle.onchange = async () => {
    if (!toggle.checked) return stop();
    const request = ++generation;
    hint('センサーを確認中…');
    try {
      const permitted = !api.requestPermission || await api.requestPermission() === 'granted';
      if (request !== generation) return;
      if (!permitted) return stop('許可されなかったためタッチで操縦します');
      listening = true;
      window.addEventListener('deviceorientation', receive);
      timer = setTimeout(() => stop('傾きを取得できないためタッチで操縦します'), 2500);
    } catch {
      if (request === generation) stop('センサーを使えないためタッチで操縦します');
    }
  };
  function resetSample() {
    last = neutral = null;
    if (document.body.dataset.tilt) {
      clearTimeout(timer);
      if (!document.hidden) timer = setTimeout(() => stop('傾きを取得できないためタッチで操縦します'), 2500);
    }
  }
  document.addEventListener('visibilitychange', resetSample);
  window.addEventListener('orientationchange', resetSample);
  screen.orientation?.addEventListener('change', resetSample);
  return {
    calibrate() {
      if (listening && last && angle === screenAngle()) {
        neutral = last;
        document.body.dataset.tilt = 'active';
        return true;
      }
      if (toggle.checked) stop('傾きを取得できないためタッチで操縦します');
      return false;
    },
    end() {
      neutral = null;
      delete document.body.dataset.tilt;
    },
    value(axis) {
      return last && neutral && angle === screenAngle() ? tiltCommand(last[axis - 1], neutral[axis - 1]) : 0;
    },
  };
}
