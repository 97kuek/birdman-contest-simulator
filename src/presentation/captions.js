export function setupCaptions() {
  const panel = document.getElementById('commentary');
  const text = document.getElementById('commentary-text');
  const dialog = document.getElementById('source-dialog');
  let timer;
  function clear() {
    clearTimeout(timer);
    panel.hidden = true;
  }
  function show(line) {
    clear();
    if (document.hidden || dialog.open) return;
    text.textContent = line;
    panel.hidden = false;
    timer = setTimeout(clear, 3000);
  }
  return { show, clear };
}
