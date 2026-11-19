import { GLIDER_RECORDS } from '../application/flight-records.js';
import { WEATHER } from '../domain/weather.js';
import { byId as $ } from './dom.js';

export function showRecordBoard(run, score) {
  const official = score.official;
  const updated = score.personal === 'improved';
  const title = official === 'allTime' ? '歴代最高記録超え！' :
    official === 'winner2026' ? '優勝記録超え！' : updated ? '自己ベスト更新！' : 'ただ今の記録';
  const best = (score.best / 100).toFixed(2);
  const personal = {
    first: '初記録',
    improved: official ? '自己ベスト更新' : '',
    tied: '自己ベストタイ',
    below: '自己ベスト ' + best + ' m',
  };
  $('result-heading').textContent = title;
  $('result-distance').textContent = score.metres;
  $('record-personal').textContent = [WEATHER[run.weather].label, personal[score.personal]].filter(Boolean).join(' ／ ');
  const comparison = $('record-official');
  comparison.hidden = !official;
  comparison.textContent = official
    ? (official === 'allTime' ? '滑空機部門 歴代最高' : '2026年 滑空機部門優勝') + ' ' +
      (GLIDER_RECORDS[official] / 100).toFixed(2) + ' m を突破'
    : '';
  $('record-board').dataset.highlight = official || (updated ? 'personal' : '');
}
