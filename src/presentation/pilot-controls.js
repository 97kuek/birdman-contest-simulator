import { byId as $ } from './dom.js';

const HOLD_DELAY_MS = 350;
const HEADING_REPEAT_MS = 100;
const DRAG_DEAD_ZONE_PX = 18;

export function bindPilotControls({
  isFlying,
  isAiming,
  view,
  changeDirection,
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
  let headingTimer;
  function stopHeading() {
    clearTimeout(headingTimer);
  }
  for (const [id, step] of [
    ['direction-left', -1],
    ['direction-right', 1],
  ]) {
    const button = $(id);
    let touchPress = false;
    button.onpointerdown = (e) => {
      touchPress = e.pointerType === 'touch' || e.pointerType === 'pen';
      if (!touchPress || !e.isPrimary) return;
      stopHeading();
      button.setPointerCapture(e.pointerId);
      function repeat() {
        if (!isAiming() || document.hidden || $('source-dialog').open || button.disabled) return;
        changeDirection(step);
        headingTimer = setTimeout(repeat, HEADING_REPEAT_MS);
      }
      changeDirection(step);
      headingTimer = setTimeout(repeat, HOLD_DELAY_MS);
    };
    button.onclick = (e) => {
      if (!touchPress || e.detail === 0) changeDirection(step);
    };
    button.onpointermove = (e) => {
      if (button.hasPointerCapture(e.pointerId) && document.elementFromPoint(e.clientX, e.clientY) !== button)
        stopHeading();
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
      button.addEventListener(event, stopHeading);
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
  let lastDirectionStep = 0;
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
      const now = performance.now();
      if (!e.repeat || now - lastDirectionStep >= 90) {
        changeDirection(Math.sign(command));
        lastDirectionStep = now;
      }
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
    stopHeading();
    if (isFlying()) advanceToInputTime();
    clearInput();
  }
  window.addEventListener('blur', releaseInput);
  return { pilotInput, clearInput, releaseInput, stopHeading };
}
