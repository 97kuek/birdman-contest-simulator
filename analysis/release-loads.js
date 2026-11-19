// node analysis/release-loads.js path/to/2025_Tatsumi.csv [--json]
import { readTatsumiLog, pitchSlope } from './tatsumi-log.js';
import { BASE_DESIGN, createFlight, poseAt } from '../src/domain/flight.js';
import { aircraftProfile } from '../src/domain/aircraft-profiles.js';
import { readFlightInstruments } from '../src/domain/flight-instruments.js';
import { RADIANS_PER_DEGREE } from '../src/domain/units.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { modelHull } from '../src/rendering/collision-hull.js';

const records = readTatsumiLog(process.argv[2]);
const hull = modelHull(createAircraft());
const arm = aircraftProfile().tailArm;
const target = .75, centre = 3.90, slopeHalfWindow = .20;
const fixedBody = { holdUntil: 11, easeAt: 11, resumeTrimAt: 11 };
const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const rms = xs => Math.sqrt(mean(xs.map(x => x*x)));
const round = x => Number(x.toFixed(4));
const median = xs => {
  const sorted = xs.toSorted((a,b) => a-b);
  return (sorted[Math.floor((xs.length-1)/2)] + sorted[Math.floor(xs.length/2)]) / 2;
};

// Loads are sensitivity probes. Positive force lifts each wing; positive
// gust is upward air at the tail relative to the CG flow. No inferred impulse.
function probe({ hand = 0, end = 0, handArm = -.25, gust = 0, width = arm } = {}) {
  const fade = .15;
  return { supportStation: 3.12, handArm,
    handForceAt(t) {
      if (t >= end) return 0;
      if (t <= end - fade) return hand;
      return hand * (1 - Math.cos(Math.PI * (end-t) / fade)) / 2;
    },
    tailUpdraftAt(tailDistanceFromEdge) {
      if (Math.abs(tailDistanceFromEdge) >= width) return 0;
      return gust * (1 + Math.cos(Math.PI * tailDistanceFromEdge / width)) / 2;
    },
  };
}

function run(opening, releaseAttitude, releaseExperiment) {
  const flight = createFlight(BASE_DESIGN, hull, { referenceControl:true, opening, releaseAttitude, releaseExperiment });
  const until = opening === fixedBody ? 1.5 : 10.25;
  flight.advanceTo(until);
  if (flight.time < until) throw new Error('Flight ended before the comparison window');
  return { samples:flight.samples, duration:flight.time };
}

function observations(origin) {
  const clock = records.map(r => ({ t:r.time-origin, pitch:r.pitchDeg, speed:r.speed, height:r.height }));
  const window = (t, half) => clock.filter(p => Math.abs(p.t-t) <= half + 1e-12);
  const release = window(0, slopeHalfWindow);
  const pitchRateDeg = pitchSlope(release, p => p.pitch);
  const pitchDeg = mean(release.map(p => p.pitch - p.t * pitchRateDeg));
  const quarters = Array.from({ length:41 }, (_,i) => {
    const t = i/4, points = window(t,.25);
    return { t, ...Object.fromEntries(['pitch','speed','height'].map(k => [k,median(points.map(p => p[k]))])) };
  });
  return { releaseAttitude:{pitchDeg,pitchRateDeg}, window, quarters };
}
const pitchAt = (flight,t) => poseAt(flight,t).pitch / RADIANS_PER_DEGREE;
function rateAt(flight, obs, t, half = slopeHalfWindow) {
  const points = obs.window(t, half);
  const imu = pitchSlope(points, p => p.pitch);
  const model = pitchSlope(points, p => pitchAt(flight,p.t));
  return { imu, model, gap:model-imu };
}
function errors(flight,obs,start,end) {
  const rows = obs.quarters.filter(p => p.t >= start && p.t <= end).map(p => {
    const pose = poseAt(flight,p.t), meter = readFlightInstruments(pose);
    return { pitch:pose.pitch/RADIANS_PER_DEGREE-p.pitch, speed:meter.airspeed-p.speed, height:meter.altitude-p.height };
  });
  return Object.fromEntries(['pitch','speed','height'].map(k => [k,round(rms(rows.map(row => row[k])))]));
}

const offsets = [], cases = [], crosses = [], windows = [];
const fixed = run(fixedBody), standard = run();
for (let centiseconds = 370; centiseconds <= 410; centiseconds++) {
  const origin = centiseconds / 100, obs = observations(origin);
  const { imu, model, gap } = rateAt(fixed,obs,target);
  for (const half of [.15,.20,.25]) {
    windows.push({ origin, half, gap:round(rateAt(fixed,obs,target,half).gap) });
  }
  const paired = run(fixedBody, obs.releaseAttitude);
  const pairedStandard = run(undefined, obs.releaseAttitude);
  const mid = errors(standard,obs,2,5), late = errors(standard,obs,5,10);
  offsets.push({ origin, imu:round(imu), model:round(model), gap:round(gap),
    pairedGap:round(rateAt(paired,obs,target).gap), initialPitch:round(obs.releaseAttitude.pitchDeg),
    initialRate:round(obs.releaseAttitude.pitchRateDeg), early:errors(standard,obs,.5,1.25).pitch,
    mid:mid.pitch, late:late.pitch, midHeight:mid.height, lateHeight:late.height,
    midSpeed:mid.speed, lateSpeed:late.speed,
    pairedMid:errors(pairedStandard,obs,2,5).pitch, pairedLate:errors(pairedStandard,obs,5,10).pitch });
}

const variants = {
  baseline: {}, 'hand up':{hand:25}, 'hand down':{hand:-25},
  'hand up, twice force':{hand:50}, 'hand released late, forward':{hand:25,end:.15,handArm:.25},
  'hand released early':{hand:25,end:-.15}, 'hand released late':{hand:25,end:.15},
  'tail up':{gust:.25}, 'tail down':{gust:-.25}, 'tail up, narrow':{gust:.25,width:arm/2},
  'tail up, wide':{gust:.25,width:arm*1.5}, 'hand and tail':{hand:25,gust:.25},
};
const nominal = observations(centre);
for (const [name,settings] of Object.entries(variants)) {
  const experiment = probe(settings);
  const held = run(fixedBody,undefined,experiment), normal = run(undefined,undefined,experiment);
  const { model, gap } = rateAt(held,nominal,target);
  cases.push({ name, rate:round(model), gap:round(gap), tip:round(held.samples[0].wing.leftTip),
    normalRate:round(rateAt(normal,nominal,target).model), early:errors(normal,nominal,.5,1.25),
    mid:errors(normal,nominal,2,5), late:errors(normal,nominal,5,10) });
  for (const origin of [3.7,3.9,3.98,4.1]) {
    crosses.push({name,origin,gap:round(rateAt(held,observations(origin),target).gap)});
  }
}
if (process.argv.includes('--offsets-csv')) {
  const columns = Object.keys(offsets[0]);
  console.log(columns.join(','));
  for (const row of offsets) console.log(columns.map(k => row[k]).join(','));
} else if (process.argv.includes('--json')) console.log(JSON.stringify({ offsets,cases,crosses,windows }));
else {
  console.table(offsets);
  console.table(cases.map(({early,mid,late,...rest}) => ({...rest,early:early.pitch,mid:mid.pitch,
    late:late.pitch, midH:mid.height,lateH:late.height,midV:mid.speed,lateV:late.speed})));
  console.table(crosses);
  console.table(windows.filter(row => [3.9,3.98].includes(row.origin)));
}
