// node analysis/elastic-pullup.js [--csv]
import { BASE_DESIGN, createFlight, SAMPLES_PER_SECOND, simulateFlight, poseAt } from '../src/domain/flight.js';
import { readFlightInstruments } from '../src/domain/flight-instruments.js';
import { pullupLog } from '../src/domain/pullup-data.js';
import { TATSUMI_PULLUP } from '../src/domain/pilot-shift.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { modelHull } from '../src/rendering/collision-hull.js';
import { recoveryEvents } from './pullup-analysis.js';

const hull = modelHull(createAircraft());
const csv = process.argv.includes('--csv');
const keys = ['height', 'speed', 'pitchDeg'];
const round = value => Number(value.toFixed(3));

function measure(s) {
  const reading = readFlightInstruments(s);
  return { t: s.t, height: reading.altitude, speed: reading.airspeed, pitchDeg: s.pitch * 180 / Math.PI,
    body: s.bodyShift, tip: s.wing?.leftTip };
}

function rmsDifference(a, b, from = 0, until = 10) {
  const selected = a.filter(row => row.t >= from && row.t <= until);
  const other = b.filter(row => row.t >= from && row.t <= until);
  const errors = {};
  for (const key of keys) {
    const sum = selected.reduce((total, row, i) => total + (row[key] - other[i][key]) ** 2, 0);
    errors[key] = round(Math.sqrt(sum / selected.length));
  }
  return errors;
}

const series = new Map([['log', pullupLog]]);
const comparisons = [];
for (const rigidWing of [true, false]) {
  const wing = rigidWing ? 'rigid' : 'elastic';
  for (const contestOpening of [false, true]) {
    const name = wing + (contestOpening ? '-revised' : '-previous');
    const run = simulateFlight(BASE_DESIGN, hull, { rigidWing, contestOpening });
    const rows = pullupLog.map(({ t }) => measure(poseAt(run, t)));
    series.set(name, rows);
    const events = recoveryEvents(rows);
    const lowestPitch = Math.min(...rows.filter(row => row.t <= 2).map(row => row.pitchDeg));
    comparisons.push({ name, ...rmsDifference(rows, pullupLog), lowestPitch: round(lowestPitch),
      level: round(events.noseUp), trough: events.bottom, crest: events.crest, rise: round(events.gain),
      distance: round(run.distance), duration: round(run.duration) });
  }
  // Open loop in both axes. The two structures see exactly the same body
  // position history for each command, including after reference trim resumes.
  for (const input of [0, 1]) {
    const flight = createFlight(BASE_DESIGN, hull, { rigidWing, weather: 'reference' });
    flight.advanceTo(TATSUMI_PULLUP.holdUntil);
    flight.advanceTo(TATSUMI_PULLUP.easeAt, input);
    flight.advanceTo(10);
    const rows = pullupLog.map(({ t }) => measure(flight.samples[Math.round(t * SAMPLES_PER_SECOND)]));
    series.set(wing + (input ? '-pull' : '-neutral'), rows);
  }
}
if (csv) {
  console.log('series,t,height,speed,pitchDeg,body,tip');
  for (const [name, rows] of series) for (const row of rows) {
    console.log([name, row.t, ...keys.map(k => row[k]), row.body, row.tip].join(','));
  }
} else {
  console.table(comparisons);
  const effects = [];
  for (const [from, until] of [[0, 2], [2, 5], [5, 10], [0, 10]]) {
    for (const [a, b] of [
      ['elastic-previous', 'log'], ['elastic-revised', 'log'],
      ['elastic-pull', 'rigid-pull'], ['elastic-neutral', 'rigid-neutral'],
      ['elastic-pull', 'elastic-neutral'], ['rigid-pull', 'rigid-neutral'],
    ]) effects.push({ from, until, a, b, ...rmsDifference(series.get(a), series.get(b), from, until) });
  }
  console.table(effects);
}
