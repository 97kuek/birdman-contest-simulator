import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BASE_DESIGN, createFlight } from '../src/domain/flight.js';
import { opening4c0464e } from '../analysis/reference-openings.js';

const figure = JSON.parse(readFileSync(new URL('../src/presentation/opening-comparison.json', import.meta.url)));

test('比較画面の現在と調整前の全61姿勢は公開ソルバーの同時刻の姿勢・身体位置に一致する', () => {
  for (const [series, opening] of [[figure.current, undefined], [figure.previous, opening4c0464e]]) {
    const flight = createFlight(BASE_DESIGN, [[-1, -.45], [1, -.45]], { referenceControl:true, opening });
    flight.advanceTo(figure.duration);
    assert.equal(series.states.length, flight.samples.length);
    series.states.forEach(([t, pitch, body], i) => {
      const sample = flight.samples[i];
      assert.ok(Math.abs(t - sample.t) < 1e-9);
      assert.ok(Math.abs(pitch - sample.pitch * 180 / Math.PI) <= .00051);
      assert.ok(Math.abs(body - sample.bodyShift * 100) <= .00051);
    });
  }
  assert.ok(figure.fixed.states.every(([, , body]) => body === figure.fixed.states[0][2]));
  assert.ok(figure.imu[0][0] < 0 && figure.imu.at(-1)[0] > figure.duration);
});

test('0.75秒の表示には検証表と同じ時刻窓の傾きを使う', () => {
  const rate = rows => rows.find(([t]) => t === .75)[1];
  assert.equal(rate(figure.imuRates).toFixed(2), '-11.56');
  assert.equal(rate(figure.current.rates).toFixed(2), '-6.87');
});

test('大会再現のロールとピッチは同じ自由飛行を積分し、2秒で右へ傾く', async () => {
  const { lateralOpening } = await import('../analysis/tatsumi-lateral-conditions.js');
  const rad = Math.PI/180;
  const flight = createFlight(BASE_DESIGN,[[-1,-.45],[1,-.45]],{referenceControl:true,
    releaseExperiment:lateralOpening({bank:2.5*rad,rollRate:2.087277*rad,lateralVelocity:-.579526,yawRate:1.413253*rad})});
  flight.advanceTo(3);
  const at2 = flight.samples.find(p=>p.t===2);
  assert.ok(Math.abs((at2.bank-flight.samples[0].bank)/rad-1.815)<.005);
  for (const [i,[,pitch]] of figure.lateral.states.entries()) {
    assert.ok(Math.abs(flight.samples[i].pitch/rad-pitch)<.00052);
  }
});
