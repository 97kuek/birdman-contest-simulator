// node analysis/elastic-flight.js [--csv] — repeatable structural flight audit.
import { BASE_DESIGN, QX25_DESIGN, createFlight, poseAt, simulateFlight } from '../src/domain/flight.js';
import { readFlightInstruments } from '../src/domain/flight-instruments.js';
import { pullupLog } from '../src/domain/pullup-data.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { createQx25Aircraft } from '../src/rendering/aircraft/qx25.js';
import { modelHull } from '../src/rendering/collision-hull.js';

const csv = process.argv.includes('--csv');
if (csv) console.log('aircraft,scenario,seconds,leftTip,rightTip,leftMoment,rightMoment,utilization');
const rounded = x => Number(x.toFixed(3));
for (const design of [BASE_DESIGN, QX25_DESIGN]) {
  const id = design.aircraftId ?? 'ryukai';
  const hull = modelHull(id === 'qx25' ? createQx25Aircraft() : createAircraft());
  for (const scenario of ['neutral', 'pullup', 'gust']) {
    const weather = scenario === 'gust' ? 'day-hard' : 'calm';
    const flight = createFlight(design, hull, { weather, gustOffset: 7 });
    flight.advanceTo(2);
    flight.advanceTo(2.55, scenario === 'pullup' ? 1 : 0);
    flight.advanceTo(10);
    const peak = flight.samples.reduce((best, s) =>
      Math.abs(s.wing.rightTip - s.wing.leftTip) > Math.abs(best.wing.rightTip - best.wing.leftTip) ? s : best);
    if (csv) {
      for (const { t, wing } of flight.samples) {
        console.log([id, scenario, t, wing.leftTip, wing.rightTip, wing.leftMoment, wing.rightMoment, wing.utilization].join(','));
      }
    } else {
      const atRelease = flight.samples[0].wing, atKeyUp = flight.samples[51].wing;
      console.log(id, scenario, { releaseTip: rounded(atRelease.leftTip), leftTipAt2_55: rounded(atKeyUp.leftTip),
        maxAsymmetry: rounded(Math.abs(peak.wing.rightTip - peak.wing.leftTip)), time: rounded(peak.t),
        peakUse: rounded(Math.max(...flight.samples.map(s => s.wing.utilization))) });
    }
  }
  if (csv) continue;
  if (id === 'ryukai') {
    for (const rigidWing of [true, false]) {
      const run = simulateFlight(design, hull, { rigidWing });
      const errors = pullupLog.map(obs => {
        const s = poseAt(run, obs.t), reading = readFlightInstruments(s);
        return [reading.altitude - obs.height, reading.airspeed - obs.speed, s.pitch * 180 / Math.PI - obs.pitchDeg];
      });
      const rmse = errors[0].map((_, i) => rounded(Math.sqrt(errors.reduce((sum, e) => sum + e[i] ** 2, 0) / errors.length)));
      console.log(id, rigidWing ? 'rigid' : 'elastic', { distance: rounded(run.distance), altitudeSpeedPitchRMSE: rmse });
    }
  }
  let completed = 0, broken = 0, peakUse = 0;
  for (const period of ['day','night']) for (const level of ['easy','normal','hard']) for (const gustOffset of [0,7,43,200]) {
    const f = createFlight(design, hull, { weather: period + '-' + level, gustOffset });
    f.advanceTo(120);
    if (f.result) completed++;
    if (f.failure) broken++;
    peakUse = Math.max(peakUse, ...f.samples.map(s => s.wing.utilization));
  }
  console.log(id, 'neutral landings by weather', { completed, broken, peakUse: rounded(peakUse) });
}
