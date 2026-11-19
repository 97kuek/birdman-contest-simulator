// node analysis/opening-window.js [path/to/2025_Tatsumi.csv]
import { opening4c0464e as old } from './reference-openings.js';
import { BASE_DESIGN, poseAt, simulateFlight } from '../src/domain/flight.js';
import { readFlightInstruments } from '../src/domain/flight-instruments.js';
import { TATSUMI_PULLUP } from '../src/domain/pilot-shift.js';
import { pullupLog } from '../src/domain/pullup-data.js';
import { RADIANS_PER_DEGREE } from '../src/domain/units.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { modelHull } from '../src/rendering/collision-hull.js';
import { recoveryEvents } from './pullup-analysis.js';
import { readTatsumiLog, angleSlope } from './tatsumi-log.js';

const hull = modelHull(createAircraft());
const { holdUntil, activeResponseSeconds, activeBodyRate, easeAt } = TATSUMI_PULLUP;
const trials = {
  previous: old,
  'start only': { ...old, holdUntil },
  'speed cap only': { ...old, activeBodyRate },
  'response only': { ...old, activeResponseSeconds },
  'start and speed': { ...old, holdUntil, activeResponseSeconds, activeBodyRate },
  'neutral only': { ...old, easeAt },
  adopted: TATSUMI_PULLUP,
  'faster alternative': { ...TATSUMI_PULLUP, holdUntil: .65, activeBodyRate: .55, activeResponseSeconds: .1 },
  'hold to 1.50s': { ...old, holdUntil: 1.50 },
};
const round = n => Number(n.toFixed(3));
const rmse = differences => Math.sqrt(differences.reduce((sum, e) => sum + e ** 2, 0) / differences.length);
const records = process.argv[2] ? readTatsumiLog(process.argv[2]) : [];
const phases = [], events = [], rates = [], synchronized = [];
for (const [name, opening] of Object.entries(trials)) {
  const run = simulateFlight(BASE_DESIGN, hull, { opening });
  const pitchAt = t => poseAt(run, t).pitch / RADIANS_PER_DEGREE;
  const series = pullupLog.map(log => {
    const sample = poseAt(run, log.t);
    const reading = readFlightInstruments(sample);
    return { t: log.t, height: reading.altitude, speed: reading.airspeed,
      pitchDeg: sample.pitch / RADIANS_PER_DEGREE, log };
  });
  for (const [from, to] of [[.5, 1.25], [2, 5], [5, 10]]) {
    const rows = series.filter(row => row.t >= from && row.t <= to);
    const error = key => round(rmse(rows.map(row => row[key] - row.log[key])));
    phases.push({ name, from, to, height: error('height'), speed: error('speed'), pitch: error('pitchDeg') });
  }
  const event = recoveryEvents(series);
  events.push({ name, dipQuarterGrid: round(Math.min(...series.filter(row => row.t <= 2).map(row => row.pitchDeg))),
    level: round(event.noseUp), gain: round(event.gain), seconds: round(run.duration), distance: round(run.distance) });
  if (!records.length) continue;
  // The origin candidates shift the observations only. Aircraft and control timings are fixed.
  for (const origin of [3.7, 3.9, 4.1]) {
    const clock = records.map(r => ({ t: r.time - origin, pitch: r.pitchDeg }));
    const targets = [.50, .75, 1.00, 1.25];
    const differences = targets.map(t => {
      const window = clock.filter(row => Math.abs(row.t - t) <= .2);
      const measured = angleSlope(window, row => row.pitch);
      const model = angleSlope(window, row => pitchAt(row.t));
      if (origin === 3.9) rates.push({ name, t, n: window.length, imu: round(measured), model: round(model),
        bodyCm: round(poseAt(run, t).bodyShift * 100) });
      return model - measured;
    });
    const within = clock.filter(r => r.t >= .5 && r.t <= 1.25);
    synchronized.push({ name, origin, n: within.length, rawPitch: round(rmse(within.map(r => pitchAt(r.t) - r.pitch))),
      rate: round(rmse(differences)) });
  }
}
console.table(phases);
console.table(events);
if (records.length) {
  console.table(rates);
  console.table(synchronized);
}
