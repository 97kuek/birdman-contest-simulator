import { byId } from './dom.js';

export const aircraftCards = {
  ryukai: {
    name: '竜海', university: '東京理科大学', team: '鳥人間サークル鳥科', shortTeam: '東京理科大学・鳥科',
    year: 2025, category: '滑空機', pitchLabel: '体重移動',
  },
  qx25: {
    name: 'QX-25', university: '九州大学', team: '鳥人間チーム', shortTeam: '九州大学',
    year: 2025, category: '滑空機', pitchLabel: '前後操縦',
  },
  ren: {
    name: '聯', university: '東北大学', team: 'Windnauts', shortTeam: '東北大学 Windnauts',
    year: 2023, category: '人力プロペラ機', pitchLabel: '水平尾翼',
  },
};

function showAircraft(id) {
  const { name, university, team, shortTeam, year, category, pitchLabel } = aircraftCards[id];
  document.title = name + ' | 鳥人間コンテストシミュレーター';
  byId('aircraft-name').textContent = name;
  byId('aircraft-university').textContent = university;
  byId('aircraft-team').textContent = team;
  byId('aircraft-class').textContent = year + '年 ' + category;
  byId('broadcast-division').textContent = category + '部門';
  byId('broadcast-team').textContent = shortTeam;
  byId('pitch-label').textContent = pitchLabel;
}

export function bindAircraftPicker(initialId, isPreparing, select) {
  const ids = Object.keys(aircraftCards);
  let index = ids.indexOf(initialId);
  const previous = byId('aircraft-prev'), following = byId('aircraft-next');
  let loading = false;
  async function step(direction) {
    if (!isPreparing() || loading) return;
    const next = (index + direction + ids.length) % ids.length;
    loading = previous.disabled = following.disabled = true;
    try {
      if (await select(ids[next])) {
        index = next;
        showAircraft(ids[index]);
      }
    } finally {
      loading = previous.disabled = following.disabled = false;
    }
  }
  for (const [button, direction] of [[previous, -1], [following, 1]]) {
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
