import { LAUNCH } from '../src/domain/launch.js';
import { aircraftProfile } from '../src/domain/aircraft-profiles.js';
import { RADIANS_PER_DEGREE as rad } from '../src/domain/units.js';
import { angleSlope } from './tatsumi-log.js';

export const releaseTime = 3.90;
export const fittedWingWind = { left: .25, right: -.25, seconds: 2.5 };

export function median(values) {
  const sorted = values.toSorted((a,b) => a-b);
  return (sorted[Math.floor((sorted.length-1)/2)] + sorted[Math.floor(sorted.length/2)]) / 2;
}

// Keep the bank and roll-rate estimator identical to the handoff experiment.
// Only use rows strictly before release for the vane and heading fit.
export function lateralInitialState(team, lookback = .25) {
  const rows = team.map(p => ({ ...p, t: p.time-releaseTime }));
  const before = rows.filter(p => p.t >= -lookback && p.t < 0);
  const a = before.at(-1), b = rows.find(p => p.t >= 0);
  const bank = (a.roll - a.t * (b.roll-a.roll)/(b.t-a.t))*rad;
  const rollRate = angleSlope(rows.filter(p => Math.abs(p.t)<=.20), p => p.roll)*rad;
  const aos = median(before.map(p => p.aos));
  // This short heading window does not cross the wrap of the main IMU.
  const headingRate = -angleSlope(before, p => p.yaw);
  const q = aircraftProfile().releasePitchRateDeg*rad;
  const yawRate = (headingRate*rad-q*Math.sin(bank))/Math.cos(bank);
  const path = LAUNCH.pathDeg*rad;
  // The vane measures atan2(body V, body U). At level pitch and zero
  // ambient release wind, V = v*cos(bank) - w*sin(bank), U = u.
  const lateralVelocity = LAUNCH.speed*(Math.cos(path)*Math.tan(aos*rad)
    + Math.sin(path)*Math.sin(bank))/Math.cos(bank);
  return { bank, rollRate, yawRate, lateralVelocity, aos, headingRate, count:before.length };
}

export function synchronousHandForce(t) {
  const secondsToRelease = (1001/30000)/2-t;
  const fraction = Math.max(0,Math.min(1,secondsToRelease/.15));
  return 12.5*(1-Math.cos(Math.PI*fraction));
}

export function lateralOpening(initial, { slip=true, yaw=true, wingWind=fittedWingWind } = {}) {
  const experiment = { freeLateral:true, bank:initial.bank, rollRate:initial.rollRate,
    lateralVelocity:slip ? initial.lateralVelocity : 0, yawRate:yaw ? initial.yawRate : 0,
    supportStation:3.12, handArm:-.25, handForceAt:synchronousHandForce };
  if (wingWind) {
    experiment.wingWindAt = (time,side) => {
      if (time<=0 || time>=wingWind.seconds) return undefined;
      const speed = wingWind[side]*Math.sin(Math.PI*time/wingWind.seconds)**2;
      return { [wingWind.axis ?? 'updraft']: speed };
    };
  }
  return experiment;
}
