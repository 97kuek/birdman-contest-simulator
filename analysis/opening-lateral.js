// node analysis/opening-lateral.js path/to/2025FlightLog.csv path/to/2025_Tatsumi.csv [--csv]
import assert from 'node:assert/strict';
import { readRollLog, readTatsumiLog } from './tatsumi-log.js';
import { fittedWingWind, lateralInitialState, lateralOpening, median, releaseTime } from './tatsumi-lateral-conditions.js';
import { BASE_DESIGN, createFlight, poseAt } from '../src/domain/flight.js';
import { readFlightInstruments } from '../src/domain/flight-instruments.js';
import { RADIANS_PER_DEGREE as rad } from '../src/domain/units.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { modelHull } from '../src/rendering/collision-hull.js';

const raw = readRollLog(process.argv[2]), team = readTatsumiLog(process.argv[3]);
assert.deepEqual(team.map(p => [p.time,p.roll]),raw.map(p => [p.time,p.main]));
const records = team.map((p,i) => ({...p,...raw[i],t:p.time-releaseTime}));
const initial = lateralInitialState(team);
const hull = modelHull(createAircraft());
const rms = xs => Math.sqrt(xs.reduce((sum,x) => sum+x*x,0)/xs.length);
const window = (start,end) => records.filter(p => start<=p.t && p.t<=end);
const last = records.findLast(p => p.t<0), next = records.find(p => p.t>=0);
const offset = key => last[key]-last.t*(next[key]-last[key])/(next.t-last.t);
const intervals = [[0,2],[2,5],[5,10]];
const readings = Array.from({length:41},(_,i) => {
  const t = i/4, rows = window(t-.25-1e-12,t+.25+1e-12);
  return { t, pitch:median(rows.map(p=>p.pitchDeg)), height:median(rows.map(p=>p.height)), speed:median(rows.map(p=>p.speed)) };
});

function simulate(settings, state = initial) {
  const flight = createFlight(BASE_DESIGN,hull,{referenceControl:true,releaseExperiment:lateralOpening(state,settings)});
  flight.advanceTo(10);
  assert.equal(flight.time,10);
  return { samples:flight.samples, duration:10 };
}
const change = (run,t) => (poseAt(run,t).bank-initial.bank)/rad;
function score(run) {
  const windows = intervals.map(([start,end]) => {
    const obs = window(start,end);
    const rollRmse = key => rms(obs.map(p => change(run,p.t)-(p[key]-offset(key))));
    const errors = readings.filter(p=>p.t>=start && p.t<=end).map(p=>{
      const s = poseAt(run,p.t), meter = readFlightInstruments(s);
      return { pitch:s.pitch/rad-p.pitch, height:meter.altitude-p.height, speed:meter.airspeed-p.speed };
    });
    return { start,end,main:rollRmse('main'), air:rollRmse('air'),
      ...Object.fromEntries(['pitch','height','speed'].map(k=>[k,rms(errors.map(p=>p[k]))])) };
  });
  const at2 = poseAt(run,2);
  return { bankChangeAt2:change(run,2), headingChangeAt2:at2.heading/rad, betaAt2:at2.sideslipDeg, windows };
}

const left = { ...fittedWingWind,right:0 }, right = { ...fittedWingWind,left:0 };
const noInitial = { slip:false,yaw:false };
const cases = {
  base:{ ...noInitial,wingWind:null }, slip:{ yaw:false,wingWind:null }, yaw:{ slip:false,wingWind:null },
  initial:{ wingWind:null }, leftOnly:{ ...noInitial,wingWind:left }, rightOnly:{ ...noInitial,wingWind:right },
  gradientOnly:noInitial, initialLeft:{wingWind:left}, initialRight:{wingWind:right}, reconstructed:{},
  reversed:{wingWind:{...fittedWingWind,left:-.25,right:.25}},
  leftHeadwind:{wingWind:{...left,left:.25,axis:'headwind'}},
  shortLeft:{wingWind:{left:.4,right:0,seconds:1}},
};
const runs = Object.fromEntries(Object.entries(cases).map(([name,settings])=>[name,simulate(settings)]));
if (process.argv.includes('--csv')) {
  const series = ['base','initial','reconstructed'];
  console.log(['time','main','air',...series].join(','));
  for (const p of window(0,10)) console.log([p.t,p.main-offset('main'),p.air-offset('air'),'','',''].join(','));
  for (const p of runs.base.samples) console.log([p.t,'','',...series.map(k=>change(runs[k],p.t))].join(','));
} else {
  const sensitivity = [];
  for (const half of [.20,.25,.30,.40]) {
    const state = lateralInitialState(team,half);
    sensitivity.push({lookback:half,count:state.count,aos:state.aos,headingRate:state.headingRate,
      initialOnly:score(simulate(cases.initial,state)).bankChangeAt2, combined:score(simulate({},state)).bankChangeAt2});
  }
  for (const seconds of [2,2.5,3]) {
    for (const speed of [.2,.25,.3]) {
      const run = simulate({wingWind:{left:speed,right:-speed,seconds}});
      sensitivity.push({seconds,speed,...score(run)});
    }
  }
  console.log(JSON.stringify({ initial, sensitivity,
    cases:Object.fromEntries(Object.entries(runs).map(([k,run])=>[k,score(run)])) },null,2));
}
