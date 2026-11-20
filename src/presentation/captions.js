export function setupCaptions() {
  const panel = document.getElementById('commentary');
  const text = document.getElementById('commentary-text');
  const dialog = document.getElementById('source-dialog');
  let timer;
  function clear() {
    clearTimeout(timer);
    panel.hidden = true;
  }
  function show(line, duration = 3000, speaker = '実況') {
    clear();
    if (document.hidden || dialog.open) return;
    panel.querySelector('b').textContent = speaker;
    text.textContent = line;
    panel.hidden = false;
    timer = setTimeout(clear, duration);
  }
  return { show, clear };
}
