// node analysis/tatsumi-release.js [--csv]
import { BASE_DESIGN, poseAt, simulateFlight } from '../src/domain/flight.js';
import { readFlightInstruments } from '../src/domain/flight-instruments.js';
import { TATSUMI_PULLUP } from '../src/domain/pilot-shift.js';
import { pullupLog } from '../src/domain/pullup-data.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { modelHull } from '../src/rendering/collision-hull.js';
import { readTatsumiLog } from './tatsumi-log.js';
import { recoveryEvents } from './pullup-analysis.js';

const hull = modelHull(createAircraft());
const previous = { holdUntil: 0.4, easeAt: 2.6, resumeTrimAt: 4.9, activeResponseSeconds: 0.45 };
const measured = { pitchDeg: -0.19, pitchRateDeg: -14.41 };
const takeup = { holdUntil: TATSUMI_PULLUP.holdUntil, activeResponseSeconds: TATSUMI_PULLUP.activeResponseSeconds };
const neutral = { easeAt: TATSUMI_PULLUP.easeAt, resumeTrimAt: TATSUMI_PULLUP.resumeTrimAt };
const trials = [
  ['former-input', previous],
  ['angle-only', previous, { pitchDeg: measured.pitchDeg }],
  ['rate-only', previous, { pitchRateDeg: measured.pitchRateDeg }],
  ['both-imu', previous, measured],
  ['post-release-rate', previous, { pitchRateDeg: -18.06 }],
  ['takeup-only', { ...previous, ...takeup }],
  ['neutral-onset-only', { ...previous, easeAt: neutral.easeAt }],
  ['trim-onset-only', { ...previous, resumeTrimAt: neutral.resumeTrimAt }],
  ['neutral-and-trim', { ...previous, ...neutral }],
  ['adopted', TATSUMI_PULLUP],
  ['adopted-with-imu', TATSUMI_PULLUP, measured],
];
const csv = process.argv.includes('--csv');
const round = x => Number(x.toFixed(3));
const logPath = process.argv.slice(2).find(arg => arg !== '--csv');
const records = logPath ? readTatsumiLog(logPath) : [];
const stats = [], events = [], synchronization = [];
if (csv) {
  console.log('series,t,height,speed,pitchDeg,body,tip');
  for (const row of pullupLog) console.log(['log', row.t, row.height, row.speed, row.pitchDeg, '', ''].join(','));
}
for (const [name, opening, releaseAttitude] of trials) {
  const run = simulateFlight(BASE_DESIGN, hull, { opening, releaseAttitude });
  const rows = pullupLog.map(({ t }) => {
    const s = poseAt(run, t), meter = readFlightInstruments(s);
    return { t, height: meter.altitude, speed: meter.airspeed, pitchDeg: s.pitch * 180 / Math.PI,
      body: s.bodyShift, tip: s.wing.leftTip };
  });
  if (csv) {
    for (const row of rows) console.log([name, row.t, row.height, row.speed, row.pitchDeg, row.body, row.tip].join(','));
    continue;
  }
  for (const [start, end] of [[0, 2], [2, 5], [5, 10], [0, 10]]) {
    const pairs = rows.map((row, i) => [row, pullupLog[i]]).filter(([{ t }]) => t >= start && t <= end);
    const rmse = key => round(Math.sqrt(pairs.reduce((sum, [row, obs]) => sum + (row[key] - obs[key]) ** 2, 0) / pairs.length));
    stats.push({ name, start, end, height: rmse('height'), speed: rmse('speed'), pitch: rmse('pitchDeg') });
  }
  if (records.length && ['adopted', 'former-input'].includes(name)) {
    for (const origin of [3.7, 3.9, 4.1]) {
      const rows = records.filter(row => row.time >= origin && row.time <= origin + 10);
      const errors = rows.map(row => poseAt(run, row.time - origin).pitch * 180 / Math.PI - row.pitchDeg);
      const pitchRMSE = Math.sqrt(errors.reduce((sum, e) => sum + e ** 2, 0) / errors.length);
      synchronization.push({ name, origin, samples: rows.length, pitchRMSE: round(pitchRMSE) });
    }
  }
  const { noseUp, crest, gain } = recoveryEvents(rows);
  events.push({ name, dip: round(Math.min(...rows.filter(row => row.t <= 2).map(row => row.pitchDeg))),
    level: round(noseUp), crest, gain: round(gain), distance: round(run.distance), duration: round(run.duration) });
}
if (!csv) {
  console.table(stats);
  console.table(events);
  if (synchronization.length) console.table(synchronization);
}
