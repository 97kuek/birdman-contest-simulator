import { byId } from './dom.js';

const paths = {
  play:'M7 4.5 19 12 7 19.5z', pause:'M7 5h3v14H7z M14 5h3v14h-3z',
  more:'M5 11.75a.25.25 0 1 0 0 .5.25.25 0 0 0 0-.5z M12 11.75a.25.25 0 1 0 0 .5.25.25 0 0 0 0-.5z M19 11.75a.25.25 0 1 0 0 .5.25.25 0 0 0 0-.5z',
  book:'M3 5q5-2 9 1 4-3 9-1v14q-5-2-9 1-4-3-9-1z M12 6v14',
  pin:'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  plus:'M5 12h14m-7-7v14', minus:'M5 12h14', frame:'M3 9V4h5m8 0h5v5m0 6v5h-5m-8 0H3v-5',
  undo:'M3 6v5h5m-5 0a8 8 0 1 1 2 7', close:'m6 6 12 12m0-12L6 18'
};

export function setupViewerShell() {
  for (const el of document.querySelectorAll('[data-icon]')) {
    el.outerHTML = '<svg aria-hidden="true" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="' + paths[el.dataset.icon] + '"/></svg>';
  }

  const dialog = byId('source-dialog');
  byId('sources').onclick = () => dialog.showModal();
  byId('close-sources').onclick = () => dialog.close();
  dialog.onclick = event => {
    if (event.target !== dialog) return;
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) dialog.close();
  };

  const cameraMenu = byId('camera-menu');
  function toggleCameraTools(open) {
    cameraMenu.setAttribute('aria-expanded', String(open));
    cameraMenu.setAttribute('aria-label', open ? 'カメラ操作を閉じる' : 'カメラ操作を開く');
  }
  cameraMenu.onclick = () => toggleCameraTools(cameraMenu.getAttribute('aria-expanded') !== 'true');
  document.addEventListener('pointerdown', event => {
    if (cameraMenu.getAttribute('aria-expanded') === 'true' && !event.target.closest('.camera-tools')) toggleCameraTools(false);
  });
  cameraMenu.parentElement.addEventListener('keydown', event => {
    if (event.key === 'Escape') { toggleCameraTools(false); cameraMenu.focus(); }
  });

  const fullscreen = byId('fullscreen');
  if (!document.fullscreenEnabled) fullscreen.hidden = true;
  fullscreen.onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      fullscreen.hidden = true;
    }
  };
  document.addEventListener('fullscreenchange', () => {
    const label = document.fullscreenElement ? '全画面表示を終了' : '全画面表示';
    fullscreen.title = label;
    fullscreen.setAttribute('aria-label', label);
  });
}

// On portrait screens the comparison panel is below the scene. On wider screens it covers its right edge.
export function trackViewportFraction(host) {
  const portrait = matchMedia('(max-width:740px) and (orientation:portrait)').matches;
  return portrait ? 1 : 1 - (byId('comparison').offsetWidth + 32) / host.clientWidth;
}

export function showCameraMode(mode, attached) {
  document.body.dataset.camera = mode;
  for (const button of document.querySelectorAll('[data-view]')) {
    const pressed = button.dataset.view === mode || (button.dataset.view === 'aircraft' && !attached);
    button.setAttribute('aria-pressed', String(pressed));
  }
}

export function bindViewerControls(host, renderer, cameraRig, atWater) {
  const { camera, setView, zoom } = cameraRig;
  for (const button of document.querySelectorAll('[data-view]')) {
    button.onclick = () => setView(button.dataset.view === 'aircraft' && atWater() ? 'tracks' : button.dataset.view);
  }
  byId('camera-reset').onclick = () => setView(cameraRig.view());
  byId('zoom-in').onclick = () => zoom(0.78);
  byId('zoom-out').onclick = () => zoom(1 / 0.78);

  const settings = byId('flight-settings');
  function framePanel() {
    const width = host.clientWidth, height = host.clientHeight;
    if (document.body.dataset.stage !== 'setup' || !width || !height) {
      camera.clearViewOffset();
      return;
    }
    const rect = settings.getBoundingClientRect();
    const bottomSheet = rect.width > width * 0.78;
    camera.setViewOffset(width, height, bottomSheet ? 0 : (width - rect.left) * 0.5,
      bottomSheet ? (height - rect.top) * 0.43 : 0, width, height);
  }
  const panelObserver = new ResizeObserver(framePanel);
  panelObserver.observe(settings);
  panelObserver.observe(byId('comparison'));

  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    cameraRig.setAspect(width / height);
    renderer.setSize(width, height, false);
    framePanel();
    if (cameraRig.view() === 'tracks') setView('tracks');
  }
  const initialView = location.hash.slice(1);
  resize();
  setView(initialView === 'pilot' || initialView === 'boat' ? initialView : 'aircraft');
  new ResizeObserver(resize).observe(host);
}
