// Run with node analysis/physics-audit.js [path/to/2025_Tatsumi.csv].
import assert from 'node:assert/strict';
import { readTatsumiLog } from './tatsumi-log.js';
import { BASE_DESIGN, createFlight, FLIGHT_LIMIT_SECONDS, poseAt } from '../src/domain/flight.js';
import { pullupLog } from '../src/domain/pullup-data.js';
import { officialDistance, observations } from '../src/domain/race2025.js';
import { windAt } from '../src/domain/weather.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { modelHull } from '../src/rendering/collision-hull.js';
import { pullupSeries, pullupErrors, recoveryEvents } from './pullup-analysis.js';

const hull = modelHull(createAircraft(BASE_DESIGN.span, BASE_DESIGN.incidence));
const rounded = value => Number(value.toFixed(3));

if (process.argv[2]) {
  const rows = readTatsumiLog(process.argv[2]);
  const median = values => {
    const ordered = values.sort((a, b) => a - b);
    return (ordered[Math.floor((ordered.length - 1) / 2)] + ordered[Math.floor(ordered.length / 2)]) / 2;
  };
  for (const point of pullupLog) {
    const window = rows.filter(row => Math.abs(row.time - 3.9 - point.t) <= 0.25);
    for (const key of ['height', 'speed', 'pitchDeg']) {
      const measured = median(window.map(row => row[key]));
      assert.ok(Math.abs(measured - point[key]) < 1e-10, `t=${point.t}, ${key}`);
    }
  }
  console.log(`大会CSVと収録値が一致　${pullupLog.length} 時点 × 3 系列`);
}

function fly(weather, referenceControl) {
  const live = createFlight(BASE_DESIGN, hull, { weather, referenceControl });
  live.advanceTo(FLIGHT_LIMIT_SECONDS);
  return live.result;
}

const summary = [];
for (const referenceControl of [true, false]) {
  const run = fly('reference', referenceControl);
  const series = pullupSeries(run), errors = pullupErrors(series), recovery = recoveryEvents(series);
  summary.push({
    mode: referenceControl ? '基準操縦' : '手動・無入力',
    distance: rounded(run.distance), distanceError: rounded(run.distance - officialDistance),
    seconds: rounded(run.duration), durationError: rounded(run.duration - observations.at(-1).t),
    heightRMSE: rounded(errors.height), relativeHeightRMSE: rounded(pullupErrors(series, true).height),
    speedRMSE: rounded(errors.speed), pitchRMSE: rounded(errors.pitchDeg),
    troughTime: recovery.bottom, crestTime: recovery.crest, recoveredHeight: rounded(recovery.gain),
    heightAt7_1: rounded(poseAt(run, 7.1).bottomHeight),
  });
}
console.table(summary);

const cards = [];
for (const weather of ['head', 'tail', 'cross']) {
  const run = fly(weather, true);
  const maxError = Math.max(...run.samples.map(p => {
    const wind = windAt(weather, p.pathLength, p.t);
    const forward = p.groundSpeed * Math.cos(p.track) + wind.headwind;
    const right = p.groundSpeed * Math.sin(p.track) + wind.crosswind;
    return Math.abs(p.speed - Math.hypot(forward, right, p.verticalSpeed - wind.updraft));
  }));
  cards.push({ weather, distance: rounded(run.distance), seconds: rounded(run.duration), maxAirspeedResidual: maxError });
}
console.table(cards);
