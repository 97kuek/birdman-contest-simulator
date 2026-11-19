// node analysis/export-opening-comparison.js path/to/2025_Tatsumi.csv
import { opening4c0464e as previous } from './reference-openings.js';
import { writeFileSync } from 'node:fs';
import { pitchSlope, readTatsumiLog } from './tatsumi-log.js';
import { BASE_DESIGN, createFlight, poseAt } from '../src/domain/flight.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { modelHull } from '../src/rendering/collision-hull.js';

const logOrigin = 3.9;
const duration = 3;
const halfWindow = 0.20;
const rows = readTatsumiLog(process.argv[2]).map(row => ({ t: row.time - logOrigin, pitch: row.pitchDeg }));
const hull = modelHull(createAircraft());
const round = n => Math.round(n * 1000) / 1000;

// Keep one point beyond each endpoint for interpolation without extrapolation.
const first = rows.findIndex(p => p.t >= 0) - 1;
const last = rows.findIndex(p => p.t > duration);
const clock = rows.slice(first, last + 1);
const windowAt = t => rows.filter(p => Math.abs(p.t - t) <= halfWindow);
const imu = clock.map(p => [round(p.t), p.pitch]);
const rateStep = 0.05;
const rateWindows = Array.from({ length: Math.round(duration / rateStep) + 1 }, (_, i) => {
  const t = round(i * rateStep);
  return { t, samples: windowAt(t) };
});
const imuRates = rateWindows.map(({ t, samples }) => [t, round(pitchSlope(samples, p => p.pitch))]);

function model(opening) {
  const flight = createFlight(BASE_DESIGN, hull, { referenceControl: true, opening });
  flight.advanceTo(duration + halfWindow + 0.1);
  const run = { samples: flight.samples, duration: flight.samples.at(-1).t };
  const pitchAt = p => poseAt(run, p.t).pitch * 180 / Math.PI;
  const states = run.samples.filter(s => s.t <= duration)
    .map(s => [round(s.t), round(s.pitch * 180 / Math.PI), round(s.bodyShift * 100)]);
  // The solver starts at release. Never pad the filter with a fictitious ramp attitude.
  const rates = rateWindows.filter(({ samples }) => samples[0].t >= 0)
    .map(({ t, samples }) => [t, round(pitchSlope(samples, pitchAt))]);
  return { states, rates };
}

const fixedUntil = duration + halfWindow + 1;
const data = { logOrigin, duration, halfWindow, imu, imuRates, current: model(), previous: model(previous),
  fixed: model({ holdUntil: fixedUntil, easeAt: fixedUntil, resumeTrimAt: fixedUntil }) };
writeFileSync(new URL('../src/presentation/opening-comparison.json', import.meta.url), JSON.stringify(data) + '\n');
