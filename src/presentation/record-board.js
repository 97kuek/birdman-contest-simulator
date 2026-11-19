import { GLIDER_RECORDS } from '../application/flight-records.js';
import { WEATHER } from '../domain/weather.js';
import { byId as $ } from './dom.js';

function scoredBoard(run, score) {
  const official = score.official;
  const updated = score.personal === 'improved';
  const personal = {
    first: '初記録',
    improved: official ? '自己ベスト更新' : '',
    tied: '自己ベストタイ',
    below: '自己ベスト ' + (score.best / 100).toFixed(2) + ' m',
  };
  return {
    title: official === 'allTime' ? '歴代最高記録超え！' :
      official === 'winner2026' ? '優勝記録超え！' : updated ? '自己ベスト更新！' : 'ただ今の記録',
    value: score.metres,
    detail: [WEATHER[run.weather].label, personal[score.personal]].filter(Boolean).join(' ／ '),
    award: official ? (official === 'allTime' ? '滑空機部門 歴代最高' : '2026年 滑空機部門優勝') +
      ' ' + (GLIDER_RECORDS[official] / 100).toFixed(2) + ' m を突破' : '',
    highlight: official || (updated ? 'personal' : ''),
  };
}

export function showRecordBoard(outcome) {
  const scored = outcome.kind === 'scored';
  const board = scored ? scoredBoard(outcome.run, outcome.score) : {
    title: 'ただ今の記録', value: '失格', detail: '飛行禁止区域侵入', award: '', highlight: '',
  };
  $('record-board').dataset.outcome = outcome.kind;
  $('record-board').dataset.highlight = board.highlight;
  $('result-heading').textContent = board.title;
  $('result-value').textContent = board.value;
  $('result-unit').hidden = !scored;
  $('record-detail').textContent = board.detail;
  $('record-official').textContent = board.award;
  $('record-official').hidden = !board.award;
  $('result-replay').hidden = !scored;
  $('return-to-setup').hidden = scored;
  const share = $('share-result');
  share.hidden = !scored;
  if (scored) {
    const link = new URL('https://twitter.com/intent/tweet');
    link.searchParams.set('text', '竜海で ' + board.value + ' m 飛びました！ #鳥人間コンテストシミュレーター');
    link.searchParams.set('url', 'https://97kuek.github.io/birdman-contest-simulator/');
    share.href = link.href;
  } else {
    share.removeAttribute('href');
  }
}
