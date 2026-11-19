import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE_DESIGN, createFlight, SAMPLES_PER_SECOND } from '../src/domain/flight.js';
import { readFlightInstruments } from '../src/domain/flight-instruments.js';
import { PILOT_SHIFT, TATSUMI_PULLUP, weightShiftRate } from '../src/domain/pilot-shift.js';
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

test('初回の後方入力だけ速く動ける。前方・中立・引き起こし後は従来の応答を使う', () => {
  const options = { pilot: true, contestOpening: true, referenceControl: false, returnSeconds: .45 };
  const rate = (time, input, bodyShift, contestOpening = true) =>
    weightShiftRate({ bodyShift, pathLength: 0 }, time, 8, input, 10, { ...options, contestOpening });
  assert.equal(rate(.7, 1, -.08), TATSUMI_PULLUP.activeBodyRate);
  assert.equal(rate(.7, -1, .08), -PILOT_SHIFT.maxBodyRate);
  assert.equal(rate(.7, 0, -.08), .08 / options.returnSeconds);
  assert.equal(rate(TATSUMI_PULLUP.easeAt, 1, -.08), PILOT_SHIFT.maxBodyRate);
  assert.equal(rate(.7, 1, -.08, false), PILOT_SHIFT.maxBodyRate);
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

test('竜海の引き起こしで2〜5秒の3計器を保ち、5〜10秒のピッチの過大応答を抑える', () => {
  const run = createFlight(BASE_DESIGN, hull, { referenceControl: true });
  run.advanceTo(10);
  const series = pullupLog.map(log => {
    const pose = run.samples[Math.round(log.t * SAMPLES_PER_SECOND)];
    const meter = readFlightInstruments(pose);
    return { t: log.t, pitch: pose.pitch * 180 / Math.PI, pitchError: pose.pitch * 180 / Math.PI - log.pitchDeg,
      heightError: meter.altitude - log.height, speedError: meter.airspeed - log.speed };
  });
  function rmse(from, to, key) {
    const rows = series.filter(row => row.t >= from && row.t <= to);
    return Math.sqrt(rows.reduce((sum, row) => sum + row[key] ** 2, 0) / rows.length);
  }
  // See docs/tatsumi-opening-window.md for the frozen 4c0464e comparison.
  assert.ok(rmse(.5, 1.25, 'pitchError') < 1.65);
  assert.ok(rmse(2, 5, 'pitchError') < 1.60);
  assert.ok(rmse(2, 5, 'heightError') < .51);
  assert.ok(rmse(2, 5, 'speedError') < .183);
  assert.ok(rmse(5, 10, 'pitchError') < .52);
  assert.ok(rmse(5, 10, 'heightError') < 1.11);
  assert.ok(rmse(5, 10, 'speedError') < .12);
  const minimum = Math.min(...series.filter(row => row.t <= 2).map(row => row.pitch));
  assert.ok(Math.abs(minimum - (-12.75)) < 2.1);
  const level = run.samples.find(sample => sample.t >= 1 && sample.pitch >= 0);
  assert.ok(Math.abs(level.t - 3.01) < .1);
});
