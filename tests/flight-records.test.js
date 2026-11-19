import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlightRecords } from '../src/application/flight-records.js';
import { showRecordBoard } from '../src/presentation/record-board.js';

const run = (distance, weather = 'day-easy', direction = 0) => ({ distance, weather, launch: { direction } });

function savedRecords() {
  const items = new Map();
  return {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
  };
}

test('公式記録を表示と同じ精度で上回った場合にだけ、最上位の達成を返す', () => {
  const records = new FlightRecords(savedRecords);
  for (const [distance, expected] of [
    [433.03, null], [442.98, null], [442.99, null], [442.994, null],
    [443.00, 'winner2026'], [645.15, 'winner2026'], [645.154, 'winner2026'], [645.16, 'allTime'],
  ]) {
    assert.equal(records.record(run(distance)).official, expected);
  }
});

test('再挑戦と再読込では時間帯・難易度の自己ベストを引き継ぎ、履歴の再表示は当時の判定を保つ', () => {
  const storage = savedRecords();
  const records = new FlightRecords(() => storage);
  const first = run(342.1);
  assert.equal(records.record(first).personal, 'first');
  const next = run(345.03, 'day-easy', 20);
  const record = records.record(next);
  assert.equal(record.personal, 'improved');
  assert.equal(record.best, 34503);
  assert.equal(records.record(run(345.034)).personal, 'tied');
  assert.equal(records.record(run(345.02)).personal, 'below');
  assert.equal(records.record(run(342.1, 'night-easy')).personal, 'first');
  assert.equal(records.record(run(342.1, 'day-hard')).personal, 'first');
  assert.equal(records.forRun(first).personal, 'first');
  assert.equal(records.forRun(next), record);
  assert.equal(records.record(next), record);

  const kyushu = { ...run(300), aircraftId: 'qx25' };
  assert.equal(records.record(kyushu).personal, 'first');

  const reopened = new FlightRecords(() => storage);
  assert.equal(reopened.record({ ...kyushu, distance: 298 }).best, 30000);
  assert.equal(reopened.record(run(342.1)).best, 34503);
  assert.equal(reopened.record(run(345.04)).personal, 'improved');
});

test('ストレージ取得・読込・書込の失敗や不正な保存値があっても、再挑戦できる', () => {
  function denied() { throw new Error('storage unavailable'); }
  for (const getStorage of [
    denied,
    () => ({ getItem: denied, setItem: denied }),
    () => ({ getItem: () => null, setItem: denied }),
    () => ({ getItem: () => 'NaN', setItem: denied }),
  ]) {
    const records = new FlightRecords(getStorage);
    assert.equal(records.record(run(300)).personal, 'first');
    assert.equal(records.record(run(299)).best, 30000);
    assert.equal(records.record(run(301)).personal, 'improved');
  }
});

test('再挑戦と履歴表示で、記録板の強調と公式記録の説明を切り替える', t => {
  const elements = Object.fromEntries(
    ['result-heading', 'result-value', 'result-unit', 'result-replay', 'share-result', 'return-to-setup', 'record-detail', 'record-official', 'record-board']
      .map(key => [key, { dataset: {}, removeAttribute(key) { delete this[key]; } }]),
  );
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: id => elements[id] } });
  t.after(() => {
    if (prev) Object.defineProperty(globalThis, 'document', prev);
    else delete globalThis.document;
  });
  const records = new FlightRecords(savedRecords);
  const high = run(651.2), below = run(300);
  showRecordBoard({ kind: 'scored', run: high, score: records.record(high) });
  assert.equal(elements['record-board'].dataset.highlight, 'allTime');
  assert.match(elements['record-official'].textContent, /645.15 m/);
  assert.match(elements['record-detail'].textContent, /初記録/);
  showRecordBoard({ kind: 'scored', run: below, score: records.record(below) });
  assert.equal(elements['record-board'].dataset.highlight, '');
  assert.equal(elements['record-official'].hidden, true);
  assert.equal(elements['record-official'].textContent, '');
  assert.match(elements['record-detail'].textContent, /651.20 m/);
  const kyushu = { ...run(300), aircraftId: 'qx25' };
  showRecordBoard({ kind: 'scored', run: kyushu, score: records.record(kyushu) });
  assert.match(new URL(elements['share-result'].href).searchParams.get('text'), /^QX-25で 300.00 m/);
  showRecordBoard({ kind: 'disqualified' });
  assert.equal(elements['result-value'].textContent, '失格');
  assert.equal(elements['result-heading'].textContent, 'ただ今の記録');
  assert.equal(elements['record-board'].dataset.highlight, '');
  assert.equal(elements['record-detail'].textContent, '飛行禁止区域侵入');
  assert.equal(elements['share-result'].href, undefined);
  assert.equal(elements['result-unit'].hidden, true);
  showRecordBoard({ kind: 'structural-failure', side: 'right' });
  assert.equal(elements['result-value'].textContent, '記録なし');
  assert.equal(elements['record-detail'].textContent, '右主翼の桁が破断（推定）');
  assert.equal(elements['result-replay'].hidden, true);
  showRecordBoard({ kind: 'scored', run: high, score: records.forRun(high) });
  assert.equal(elements['result-unit'].hidden, false);
  assert.equal(elements['result-replay'].hidden, false);
  assert.equal(elements['record-official'].hidden, false);
  assert.equal(elements['result-value'].textContent, '651.20');
});
