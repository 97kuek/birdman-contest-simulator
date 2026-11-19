import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE_DESIGN, createFlight, SAMPLES_PER_SECOND } from '../src/domain/flight.js';
import { readFlightInstruments } from '../src/domain/flight-instruments.js';
import { TATSUMI_PULLUP } from '../src/domain/pilot-shift.js';
import { pullupLog } from '../src/domain/pullup-data.js';

const hull = [[-1, -.45], [1, -.45]];

test('離台姿勢を保ち、手動入力を即座に受け付ける。基準操縦の引き起こしは手動でも再現できる', () => {
  const manual = createFlight(BASE_DESIGN, hull);
  const immediate = createFlight(BASE_DESIGN, hull);
  immediate.advanceTo(.1, 1);
  assert.ok(immediate.current().bodyShift > immediate.samples[0].bodyShift);
  manual.advanceTo(TATSUMI_PULLUP.holdUntil);
  assert.equal(manual.current().bodyShift, manual.samples[0].bodyShift);
  manual.advanceTo(TATSUMI_PULLUP.easeAt, 1);
  manual.advanceTo(TATSUMI_PULLUP.resumeTrimAt);

  const reference = createFlight(BASE_DESIGN, hull, { referenceControl: true });
  reference.advanceTo(TATSUMI_PULLUP.resumeTrimAt);
  const rigid = createFlight(BASE_DESIGN, hull, { referenceControl: true, rigidWing: true });
  rigid.advanceTo(TATSUMI_PULLUP.resumeTrimAt);
  for (const [i, sample] of manual.samples.entries()) {
    assert.equal(reference.samples[i].bodyShift, sample.bodyShift);
    assert.equal(rigid.samples[i].bodyShift, sample.bodyShift);
  }
  const handsOff = createFlight(BASE_DESIGN, hull);
  handsOff.advanceTo(TATSUMI_PULLUP.easeAt);
  assert.ok(handsOff.current().bodyShift <= 0);
});

test('弾性翼と離台条件を固定した竜海の基準操縦で、10秒の計器高度・ピトー速度・ピッチ誤差が減る', () => {
  function errors(contestOpening) {
    const flight = createFlight(BASE_DESIGN, hull, { referenceControl: true, contestOpening });
    flight.advanceTo(10);
    const sums = [0, 0, 0];
    for (const { t, height, speed, pitchDeg } of pullupLog) {
      const sample = flight.samples[Math.round(t * SAMPLES_PER_SECOND)];
      const reading = readFlightInstruments(sample);
      sums[0] += (reading.altitude - height) ** 2;
      sums[1] += (reading.airspeed - speed) ** 2;
      sums[2] += (sample.pitch * 180 / Math.PI - pitchDeg) ** 2;
    }
    return sums.map(sum => Math.sqrt(sum / pullupLog.length));
  }
  const previous = errors(false);
  errors(true).forEach((value, i) => assert.ok(value < previous[i], value + ' vs ' + previous[i]));
});
