import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlightSession } from '../src/application/flight-session.js';
import { readFlightInstruments } from '../src/domain/flight-instruments.js';
import { poseAt } from '../src/domain/flight.js';

const datum = { t: 1, height: 3, bottomHeight: 2.55, pitch: 0, bank: 0, heading: 0,
  track: 0, groundSpeed: 10, verticalSpeed: 0, updraft: 0, headwind: 0, pitchRate: 0 };
const read = overrides => readFlightInstruments({ ...datum, ...overrides });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' vs ' + b);

test('上部のピトーはプローブ軸上の流速とピッチ角速度に応答する', () => {
  close(read({ headwind: 1.2 }).airspeed, 11.2);
  close(read({ track: Math.PI / 3 }).airspeed, 5);
  close(read({ pitch: Math.PI / 6, verticalSpeed: 3, updraft: 1 }).airspeed, 10 * Math.cos(Math.PI / 6) + 1);
  assert.ok(read({ pitchRate: 0.5 }).airspeed < read({}).airspeed);
  assert.equal(read({ headwind: -12 }).airspeed, 0);
});

test('胴体下の測距は機体の傾き、照射方向と8 mの上限に従う', () => {
  assert.equal(read({ height: 8.442 }).ultrasonicRange, 8);
  assert.equal(read({ height: 8.45 }).ultrasonicRange, null);
  assert.equal(read({ height: 2, bank: Math.PI }).ultrasonicRange, null);
  const level = read({});
  assert.ok(read({ bank: Math.PI / 6 }).ultrasonicRange > level.ultrasonicRange);
  assert.ok(read({ pitch: Math.PI / 12 }).ultrasonicRange > read({ pitch: -Math.PI / 12 }).ultrasonicRange);
  close(read({ bottomHeight: 0.01 }).altitude, level.altitude);
});

test('高度と音は台上・高空・切替帯・水面直上で各計器の状態を使う', () => {
  const session = new FlightSession([[-1, -0.45], [1, -0.45]], 'head');
  const deck = readFlightInstruments(session.onDeck);
  close(deck.barometricAltitude, 10.6);
  assert.ok(deck.ultrasonicRange < 1);
  assert.equal(deck.source, 'pressure');
  assert.equal(deck.toneHz, 0);
  for (const [groundSpeed, toneHz] of [[8.5, 440], [10, 880], [11, 1320]]) {
    const high = read({ height: 11, groundSpeed });
    assert.equal(high.source, 'pressure');
    assert.equal(high.altitude, high.barometricAltitude);
    assert.equal(high.toneHz, toneHz);
    assert.equal(high.intervalSeconds, 0.9);
  }
  const middle = read({ height: 1.4 });
  assert.equal(middle.source, 'blended');
  assert.ok(middle.altitude > Math.min(middle.ultrasonicRange, middle.barometricAltitude));
  assert.ok(middle.altitude < Math.max(middle.ultrasonicRange, middle.barometricAltitude));
  const low = read({ height: 0.64 });
  assert.equal(low.source, 'ultrasonic');
  close(low.altitude, low.ultrasonicRange);
  assert.ok(low.intervalSeconds < middle.intervalSeconds);
  assert.equal(read({ height: 0.64, bottomHeight: 0 }).toneHz, 0);
});

test('同じ試技のリプレイを巻き戻すと同じ計器値を返す', () => {
  const run = new FlightSession([[-1, -0.45], [1, -0.45]], 'cross').reference;
  const times = [0, 1.13, 7.1, run.duration];
  const expected = times.map(t => readFlightInstruments(poseAt(run, t)));
  for (let i = times.length - 1; i >= 0; i--) {
    assert.deepEqual(readFlightInstruments(poseAt(run, times[i])), expected[i]);
  }
});
