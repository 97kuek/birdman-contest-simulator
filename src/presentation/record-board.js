import { GLIDER_RECORDS } from '../application/flight-records.js';
import { aircraftCards } from './aircraft-picker.js';
import { WEATHER } from '../domain/weather.js';
import { byId as $ } from './dom.js';

function scoredBoard(run, score) {
  const aircraft = aircraftCards[run.aircraftId ?? 'ryukai'];
  const practice = run.aircraftId === 'ren';
  const courseTime = run.courseTime ?? run.samples?.at(-1)?.courseTime;
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
      official === 'winner2026' ? '優勝記録超え！' : updated ? '自己ベスト更新！' : practice ? '練習飛行の距離' : 'ただ今の記録',
    value: score.metres,
    detail: [practice && (courseTime != null ? '練習コース完走 ' + courseTime.toFixed(1) + ' 秒' : aircraft.name + '・累積水平距離'), WEATHER[run.weather].label, personal[score.personal]].filter(Boolean).join(' ／ '),
    award: official ? (official === 'allTime' ? '滑空機部門 歴代最高' : '2026年 滑空機部門優勝') +
      ' ' + (GLIDER_RECORDS[official] / 100).toFixed(2) + ' m を突破' : '',
    highlight: official || (updated ? 'personal' : ''),
  };
}

export function showRecordBoard(outcome) {
  const scored = outcome.kind === 'scored';
  const board = scored ? scoredBoard(outcome.run, outcome.score) : {
    title: 'ただ今の記録', value: outcome.kind === 'disqualified' ? '失格' : '記録なし',
    detail: outcome.kind === 'structural-failure' ? ({ left: '左主翼', right: '右主翼', both: '両翼' }[outcome.side] + 'の桁が破断（推定）') : outcome.kind === 'platform-contact' ? 'プラットフォームに接触' : '飛行禁止区域侵入', award: '', highlight: '',
  };
  $('record-board').dataset.outcome = outcome.kind;
  $('record-board').dataset.highlight = board.highlight;
  $('result-heading').textContent = board.title;
  $('result-value').textContent = board.value;
  $('result-unit').hidden = !scored;
  $('record-detail').textContent = outcome.replayAvailable === false ? board.detail + ' ／ リプレイの保存対象外' : board.detail;
  $('record-official').textContent = board.award;
  $('record-official').hidden = !board.award;
  const canReplay = scored && outcome.replayAvailable !== false;
  $('result-replay').hidden = !canReplay;
  $('return-to-setup').hidden = canReplay;
  const share = $('share-result');
  share.hidden = !scored;
  if (scored) {
    const link = new URL('https://twitter.com/intent/tweet');
    link.searchParams.set('text', aircraftCards[outcome.run.aircraftId ?? 'ryukai'].name + 'で ' + board.value + ' m 飛びました！ #鳥人間コンテストシミュレーター');
    link.searchParams.set('url', 'https://97kuek.github.io/birdman-contest-simulator/');
    share.href = link.href;
  } else {
    share.removeAttribute('href');
  }
}
