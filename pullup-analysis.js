import {poseAt} from './flight.js';
import {pullupLog} from './pullup-data.js';

export function pullupSeries(run) {
  return pullupLog.map(({t}) => {
    const s = poseAt(run, t);
    return {t, height:s.bottomHeight, speed:s.speed, pitchDeg:s.pitch*180/Math.PI};
  });
}

export function pullupErrors(series, relative=false) {
  const rmse = key => {
    const offset = key === 'height' && relative ? series[0].height-pullupLog[0].height : 0;
    const sum = series.reduce((total, p, i) => total+(p[key]-pullupLog[i][key]-offset)**2, 0);
    return Math.sqrt(sum/series.length);
  };
  return {height:rmse('height'), speed:rmse('speed'), pitchDeg:rmse('pitchDeg')};
}

export const returnTimes = [0.15,0.25,0.35,0.45,0.6,0.8,1,1.2];
export const onsetDistances = [-10,-5,0,5,10,15,20];

// Use the same sampling clock and first equal extremum for the logger and every simulation.
export function recoveryEvents(series) {
  const window = series.filter(p => p.t >= 2 && p.t <= 8);
  const lowest = window.filter(p => p.t <= 4).reduce((a,b) => b.height<a.height ? b : a);
  const crest = window.filter(p => p.t >= lowest.t).reduce((a,b) => b.height>a.height ? b : a);
  const fastest = window.reduce((a,b) => b.speed>a.speed ? b : a);
  const crossing = window.findIndex((p,i) => i>0 && window[i-1].pitchDeg<0 && p.pitchDeg>=0);
  let noseUp = null;
  if (crossing>0) {
    const a=window[crossing-1], b=window[crossing];
    noseUp=a.t-a.pitchDeg*(b.t-a.t)/(b.pitchDeg-a.pitchDeg);
  }
  return {bottom:lowest.t, floor:lowest.height, crest:crest.t, duration:crest.t-lowest.t,
    gain:crest.height-lowest.height, speedLoss:lowest.speed-crest.speed, fastest:fastest.t, noseUp};
}

export function recoveryErrors(series) {
  const selected=series.filter(p=>p.t>=2 && p.t<=8);
  const observed=pullupLog.filter(p=>p.t>=2 && p.t<=8);
  const rmse=key=>Math.sqrt(selected.reduce((sum,p,i)=>sum+(p[key]-observed[i][key])**2,0)/selected.length);
  return {speed:rmse('speed'), pitch:rmse('pitchDeg')};
}
