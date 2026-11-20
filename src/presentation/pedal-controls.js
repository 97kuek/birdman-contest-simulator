import { byId } from './dom.js';

export function bindPedalControls(advanceToInputTime) {
  const panel = byId('pedal-controls');
  const buttons = [...panel.querySelectorAll('[data-watts]')];
  const cruise = panel.querySelector('[aria-pressed="true"]');
  let selected = cruise;

  function display(button) {
    selected = button;
    for (const option of buttons) option.setAttribute('aria-pressed', String(option === selected));
    byId('pedal-watts').textContent = button.dataset.watts + ' W';
  }

  function select(button) {
    if (panel.hidden || selected === button) return;
    advanceToInputTime();
    if (!panel.hidden) display(button);
  }

  for (const button of buttons) button.onclick = () => select(button);
  window.addEventListener('keydown', event => {
    if (panel.hidden || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
        event.target.closest?.('input, select, textarea, dialog, [popover], [contenteditable=true]')) return;
    const button = buttons.find(option => option.getAttribute('aria-keyshortcuts') === event.key);
    if (!button) return;
    event.preventDefault();
    if (!event.repeat) select(button);
  });

  return {
    setActive(active) {
      panel.hidden = !active;
      if (active) display(cruise);
    },
    get watts() { return panel.hidden ? undefined : Number(selected.dataset.watts); },
  };
}
