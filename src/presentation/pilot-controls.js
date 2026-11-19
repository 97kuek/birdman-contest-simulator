import { byId as $ } from './dom.js';

const TAP_HEADING_DEGREES = 0.1;
const FINE_TURN_DEG_PER_SECOND = 3;
const FAST_TURN_DEG_PER_SECOND = 15;
const ACCELERATE_SECONDS = 0.75;
const DRAG_DEAD_ZONE_PX = 18;

// Integrate the angular speed from the start of a press so frame timing and
// the operating system's key-repeat rate cannot change the selected angle.
export function createHeadingInput(readHeading, setHeading) {
  let press;
  function advance(now, minimumTravel = 0) {
    if (!press) return;
    const seconds = Math.max(0, (now - press.started) / 1000);
    const ramp = Math.min(seconds, ACCELERATE_SECONDS);
    const acceleration = (FAST_TURN_DEG_PER_SECOND - FINE_TURN_DEG_PER_SECOND) / ACCELERATE_SECONDS;
    const travel = FINE_TURN_DEG_PER_SECOND * ramp + 0.5 * acceleration * ramp ** 2
      + FAST_TURN_DEG_PER_SECOND * (seconds - ramp);
    setHeading(press.startAngle + press.direction * Math.max(minimumTravel, travel));
  }
  return {
    advance,
    begin(source, direction, now) {
      if (press?.source === source) return;
      advance(now);
      press = { source, direction, started: now, startAngle: readHeading() };
    },
    end(source, now, tapped) {
      if (press?.source !== source) return;
      advance(now, tapped ? TAP_HEADING_DEGREES : 0);
      press = null;
    },
    cancel() { press = null; },
  };
}

export function bindPilotControls({
  isFlying,
  isAiming,
  view,
  readHeading,
  setHeading,
  confirmHeading,
  advanceToInputTime,
}) {
  const held = new Map();
  const padPointers = new Map();
  const padButtons = [...$('touch-controls').querySelectorAll('[data-command]')];
  let touch = null;
  function pilotInput(axis = 1) {
    const directions = new Set(held.values());
    return Number(directions.has(axis)) - Number(directions.has(-axis));
  }
  function showInput() {
    for (const button of padButtons) {
      const command = Number(button.dataset.command),
        axis = Math.abs(command);
      button.toggleAttribute('data-engaged', pilotInput(axis) === Math.sign(command));
    }
  }
  function clearInput() {
    held.clear();
    padPointers.clear();
    touch = null;
    showInput();
  }
  function setInput(source, value) {
    if (!isFlying() || (held.get(source) ?? 0) === value) return;
    // Integrate to the event time using the previous command, even between rendered frames.
    advanceToInputTime();
    if (!isFlying()) return;
    if (value) held.set(source, value);
    else held.delete(source);
    showInput();
  }
  const heading = createHeadingInput(readHeading, setHeading);
  for (const [id, direction] of [['direction-left', -1], ['direction-right', 1]]) {
    const button = $(id);
    button.onpointerdown = (e) => {
      if (!isAiming() || !e.isPrimary || e.button !== 0) return;
      button.setPointerCapture(e.pointerId);
      heading.begin(e.pointerId, direction, performance.now());
    };
    button.onpointermove = (e) => {
      if (button.hasPointerCapture(e.pointerId) && !button.contains(document.elementFromPoint(e.clientX, e.clientY)))
        heading.end(e.pointerId, performance.now(), false);
    };
    button.onpointerup = (e) => heading.end(e.pointerId, performance.now(), true);
    for (const event of ['pointercancel', 'lostpointercapture'])
      button.addEventListener(event, (e) => heading.end(e.pointerId, performance.now(), false));
    // Enter and assistive-technology activation have no press duration.
    button.onclick = (e) => {
      if (isAiming() && e.detail === 0) setHeading(readHeading() + direction * TAP_HEADING_DEGREES);
    };
  }
  // Each finger owns one axis. Sliding off its buttons returns that axis to neutral.
  const pads = $('touch-controls');
  pads.onpointerdown = (e) => {
    const button = e.target.closest('[data-command]');
    if (!isFlying() || !button || e.button !== 0) return;
    const axis = button.closest('.touch-axis');
    if ([...padPointers.values()].includes(axis)) return;
    e.preventDefault();
    padPointers.set(e.pointerId, axis);
    pads.setPointerCapture(e.pointerId);
    setInput(e.pointerId, Number(button.dataset.command));
  };
  pads.onpointermove = (e) => {
    const axis = padPointers.get(e.pointerId);
    if (!axis) return;
    const button = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-command]');
    setInput(e.pointerId, axis.contains(button) ? Number(button.dataset.command) : 0);
  };
  function liftFinger(e) {
    if (padPointers.delete(e.pointerId)) setInput(e.pointerId, 0);
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
    pads.addEventListener(event, liftFinger);
  // Non-pointer activation (keyboard or assistive technology) applies a short input.
  pads.onclick = (e) => {
    const button = e.target.closest('[data-command]');
    if (!button || e.detail !== 0 || !isFlying()) return;
    const source = Symbol();
    setInput(source, Number(button.dataset.command));
    setTimeout(() => setInput(source, 0), 200);
  };
  const arrows = { ArrowDown: 1, ArrowUp: -1, ArrowLeft: -2, ArrowRight: 2 };
  window.addEventListener('keydown', (e) => {
    if (
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      e.target.closest?.('input, select, textarea, dialog, [contenteditable=true]')
    )
      return;
    const command = arrows[e.key],
      aiming = isAiming();
    if (aiming && Math.abs(command) === 2) {
      e.preventDefault();
      if (!e.repeat) heading.begin(e.key, Math.sign(command), performance.now());
    } else if (
      aiming &&
      e.code === 'Space' &&
      (!e.target.closest?.('button') || e.target.closest('#align-panel'))
    ) {
      e.preventDefault();
      if (!e.repeat) confirmHeading();
    } else if (isFlying() && command) {
      e.preventDefault();
      if (!e.repeat) setInput(e.key, command);
    }
  });
  window.addEventListener('keyup', (e) => {
    heading.end(e.key, performance.now(), true);
    if (held.has(e.key)) {
      e.preventDefault();
      setInput(e.key, 0);
    }
  });
  // A held drag on the pilot's viewport gives touch screens the same two input axes.
  const canvas = $('canvas-host');
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !isFlying() || view() !== 'pilot' || touch) return;
    touch = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== touch?.id) return;
    const dx = e.clientX - touch.x,
      dy = e.clientY - touch.y;
    setInput('touch-turn', Math.abs(dx) > DRAG_DEAD_ZONE_PX ? 2 * Math.sign(dx) : 0);
    setInput('touch-pitch', Math.abs(dy) > DRAG_DEAD_ZONE_PX ? Math.sign(dy) : 0);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
    canvas.addEventListener(event, (e) => {
      if (e.pointerId !== touch?.id) return;
      touch = null;
      setInput('touch-turn', 0);
      setInput('touch-pitch', 0);
    });
  function releaseInput() {
    heading.cancel();
    if (isFlying()) advanceToInputTime();
    clearInput();
  }
  window.addEventListener('blur', releaseInput);
  // During rotation the buttons move away from the fingers. Some browsers
  // keep pointer capture across this change without sending pointercancel.
  matchMedia('(orientation: portrait)').addEventListener('change', releaseInput);
  return { pilotInput, clearInput, releaseInput, advanceHeading: heading.advance, stopHeading: heading.cancel };
}
