import { byId } from './dom.js';

export const aircraftCards = {
  ryukai: {
    name: '竜海', university: '東京理科大学', team: '鳥人間サークル鳥科', shortTeam: '東京理科大学・鳥科',
    pitchLabel: '体重移動',
  },
  qx25: {
    name: 'QX-25', university: '九州大学', team: '鳥人間チーム', shortTeam: '九州大学',
    pitchLabel: '前後操縦',
  },
};

function showAircraft(id) {
  const { name, university, team, shortTeam, pitchLabel } = aircraftCards[id];
  document.title = name + ' | 鳥人間コンテストシミュレーター';
  byId('aircraft-name').textContent = name;
  byId('aircraft-university').textContent = university;
  byId('aircraft-team').textContent = team;
  byId('broadcast-team').textContent = shortTeam;
  byId('pitch-label').textContent = pitchLabel;
}

export function bindAircraftPicker(initialId, isPreparing, select) {
  const ids = Object.keys(aircraftCards);
  let index = ids.indexOf(initialId);
  function step(direction) {
    if (!isPreparing()) return;
    const next = (index + direction + ids.length) % ids.length;
    select(ids[next]);
    index = next;
    showAircraft(ids[index]);
  }
  for (const [id, direction] of [['aircraft-prev', -1], ['aircraft-next', 1]]) {
    const button = byId(id);
    button.disabled = false;
    button.onclick = () => step(direction);
  }
  window.addEventListener('keydown', event => {
    if (!isPreparing() || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
        event.target.closest?.('input, select, textarea, dialog, [popover], [contenteditable=true]')) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    if (!event.repeat) step(event.key === 'ArrowLeft' ? -1 : 1);
  });
  showAircraft(initialId);
}
