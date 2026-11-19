// node analysis/instrument-comparison.js [getWindVector/src/2025FlightLog.csv]
// Raw log: https://github.com/torica-org/25th_Analysis/blob/115723c24ce9e64c07c79215770acc7559518d42/getWindVector/src/2025FlightLog.csv
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BASE_DESIGN, poseAt, simulateFlight } from '../src/domain/flight.js';
import { readFlightInstruments } from '../src/domain/flight-instruments.js';
import { pullupLog } from '../src/domain/pullup-data.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { modelHull } from '../src/rendering/collision-hull.js';

const run = simulateFlight(BASE_DESIGN, modelHull(createAircraft()));
const at = t => readFlightInstruments(poseAt(run, t));
const points = pullupLog.map(p => ({ ...p, instruments: at(p.t) }));
function compare(rows, measured, predicted) {
  const errors = rows.map(row => predicted(row) - measured(row));
  const rmse = Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length);
  return { points: rows.length, rmse: Number(rmse.toFixed(3)) };
}
const comparisons = {
  'チーム補正高度 (m)': compare(points, p => p.height, p => p.instruments.altitude),
  'ピトー対気速度 (m/s)': compare(points, p => p.speed, p => p.instruments.airspeed),
};
if (process.argv[2]) {
  const raw = readFileSync(process.argv[2]);
  const blob = createHash('sha1').update('blob ' + raw.length + '\0').update(raw).digest('hex');
  assert.equal(blob, '9cce461e0fc803541f131cd6177a8c110967fc6e', 'Use the 115723c2 competition raw CSV');
  const [header, ...lines] = raw.toString('utf8').trim().split(/\r?\n/);
  const columns = header.split(',').map(column => column.trim());
  const rows = lines.map(line => line.split(',').map(Number));
  const median = values => {
    const sorted = values.sort((a, b) => a - b);
    return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
  };
  const measuredAt = t => {
    const subset = rows.filter(row => Math.abs(row[columns.indexOf('FlightTime')] - 3.9 - t) <= 0.25);
    const estimates = subset.map(row => row[columns.indexOf('estimated_altitude_lake_m')]);
    const ranges = subset.map(row => row[columns.indexOf('data_under_urm_altitude_m')]).filter(value => value <= 8);
    return { estimated_altitude_lake_m: median(estimates),
      ultrasonicRange: ranges.length > subset.length / 2 ? median(ranges) : null };
  };
  const rawPoints = points.map(point => ({ ...point, ...measuredAt(point.t) }));
  comparisons['機上推定高度 (m)'] = compare(rawPoints, p => p.estimated_altitude_lake_m, p => p.instruments.altitude);
  // The 10 m value is a no-return sentinel. Do not include it in a distance RMSE.
  const bothValid = rawPoints.filter(p => p.ultrasonicRange !== null && p.instruments.ultrasonicRange !== null);
  if (bothValid.length) comparisons['双方に距離がある超音波 (m)'] = compare(bothValid, p => p.ultrasonicRange, p => p.instruments.ultrasonicRange);
  console.log('離台後7.1秒', { ...measuredAt(7.1), simulated: at(7.1) });
  console.log('超音波の有効窓数', { observed: rawPoints.filter(p => p.ultrasonicRange !== null).length,
    simulated: rawPoints.filter(p => p.instruments.ultrasonicRange !== null).length, both: bothValid.length });
}
console.table(comparisons);
