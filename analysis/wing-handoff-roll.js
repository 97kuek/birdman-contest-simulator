// node analysis/wing-handoff-roll.js 2025FlightLog.csv 2025_Tatsumi.csv [--csv]
import assert from 'node:assert/strict';
import { angleSlope, readRollLog, readTatsumiLog } from './tatsumi-log.js';
import { BASE_DESIGN, createFlight, poseAt, STEPS_PER_SECOND } from '../src/domain/flight.js';
import { readFlightInstruments } from '../src/domain/flight-instruments.js';
import { RADIANS_PER_DEGREE as rad } from '../src/domain/units.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { modelHull } from '../src/rendering/collision-hull.js';

const origin = 3.90, frame = 1001 / 30000;
const hull = modelHull(createAircraft());
const raw = readRollLog(process.argv[2]).map(row => ({ ...row, t: row.time - origin }));
const processed = readTatsumiLog(process.argv[3]);
assert.deepEqual(raw.map(row => row.time), processed.map(row => row.time));
const before = raw.findLast(row => row.t <= 0), after = raw.find(row => row.t > 0);
const atRelease = key => before[key] + (after[key] - before[key]) * (-before.t) / (after.t - before.t);
const rollRate = angleSlope(raw.filter(row => Math.abs(row.t) <= .20), row => row.main);
const measured = raw.filter(row => row.t >= 0 && row.t <= 10);
const mean = xs => xs.reduce((a,b) => a+b, 0) / xs.length;
const rms = xs => Math.sqrt(mean(xs.map(x => x*x)));
const median = xs => {
  const sorted = xs.toSorted((a,b) => a-b);
  return (sorted[Math.floor((xs.length-1)/2)] + sorted[Math.floor(xs.length/2)]) / 2;
};
const conditions = { simultaneous: [frame/2,frame/2], leftFirst: [0,frame], rightFirst: [frame,0] };

function simulate(ends, fade) {
  const releaseExperiment = ends && {
    freeLateral: true, bank: atRelease('main')*rad, rollRate: rollRate*rad,
    supportStation: 3.12, handArm: -.25,
    handForceAt(t, side) {
      const remaining = ends[side === 'left' ? 0 : 1] - t;
      if (remaining <= 0) return 0;
      if (remaining >= fade) return 25;
      return 12.5 * (1 - Math.cos(Math.PI * remaining / fade));
    },
  };
  const flight = createFlight(BASE_DESIGN,hull,{ referenceControl:true, releaseExperiment });
  const banks = [flight.current().bank];
  for (let i=1; i<=10*STEPS_PER_SECOND; i++) {
    flight.advanceTo(i/STEPS_PER_SECOND);
    banks.push(flight.current().bank);
  }
  assert.equal(flight.time,10);
  return { samples:flight.samples, duration:10, banks };
}
const variants = fade => Object.fromEntries(Object.entries(conditions)
  .map(([name,ends]) => [name,simulate(ends,fade)]));
const runs = variants(.15);
const roll = (run,t) => poseAt(run,t).bank/rad - atRelease('main');
const windows = [[0,2],[2,5],[5,10]];
const inWindow = (rows,start,end) => rows.filter(p => p.t >= start && p.t <= end);
const quarters = Array.from({length:41}, (_,i) => {
  const t = i/4;
  const obs = processed.filter(row => Math.abs(row.time-origin-t) <= .25+1e-12);
  return { t, pitch:median(obs.map(p => p.pitchDeg)), height:median(obs.map(p => p.height)), speed:median(obs.map(p => p.speed)) };
});

function longitudinal(run,t) {
  const p = poseAt(run,t), meter = readFlightInstruments(p);
  return { pitch:p.pitch/rad, height:meter.altitude, speed:meter.airspeed };
}
function summarize(series) {
  const result = [];
  for (const [name,run] of Object.entries(series)) {
    for (const [start,end] of windows) {
      const obs = inWindow(measured,start,end);
      const diffs = run.banks.map((bank,i) => ({
        t:i/STEPS_PER_SECOND, d:(bank-series.simultaneous.banks[i])/rad,
      })).filter(p => p.t >= start && p.t <= end);
      const peak = diffs.reduce((a,b) => Math.abs(b.d)>Math.abs(a.d) ? b : a);
      const rmse = key => rms(obs.map(p => roll(run,p.t) - (p[key]-atRelease(key))));
      const sensors = inWindow(quarters,start,end);
      const longitudinalError = key => rms(sensors.map(p => longitudinal(run,p.t)[key] - p[key]));
      result.push({ name,start,end,n:obs.length,peak, main:rmse('main'), air:rmse('air'),
        betweenImus:rms(obs.map(p => (p.main-atRelease('main'))-(p.air-atRelease('air')))),
        pitch:longitudinalError('pitch'), height:longitudinalError('height'), speed:longitudinalError('speed') });
    }
  }
  return result;
}
if (process.argv.includes('--csv')) {
  console.log('time,main,air,simultaneous,leftFirst,rightFirst');
  for (const row of measured) console.log([row.t,row.main-atRelease('main'),row.air-atRelease('air'),'','',''].join(','));
  for (let i=0; i<runs.simultaneous.banks.length; i++) {
    console.log([i/STEPS_PER_SECOND,'','',...Object.values(runs).map(run => run.banks[i]/rad-atRelease('main'))].join(','));
  }
} else {
  const normal = simulate();
  const reference = quarters.filter(p => p.t >= 2);
  const defaultErrors = windows.slice(1).map(([start,end]) => Object.fromEntries(['pitch','height','speed'].map(key =>
    [key,rms(inWindow(reference,start,end).map(p => longitudinal(normal,p.t)[key] - p[key]))])));
  console.log(JSON.stringify({ initial:{main:atRelease('main'),air:atRelease('air'),rollRate},
    frame, defaultErrors, smooth:summarize(runs), abrupt:summarize(variants(0)) },null,2));
}
