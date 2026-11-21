// A crew-supported, level fuselage follows the inclined deck until the wheel
// unloads or runs out of deck. Time is relative to GO throughout this module.
import { releaseState } from './aircraft-dynamics.js';
import { RAMP_LENGTH } from './launch.js';
import { poweredFlightDynamics } from './powered-flight.js';
import { propTurnsPerCrank, reserveCapacityJ, pedalEffort, riderClimate, riderCriticalPower } from './ren-practice.js';
import { RAD_PER_RPM } from './units.js';

export const SPINUP_SECONDS = 4.1;
const STEP = 1 / 60;
const MAX_PUSH_N = 75;
const ROLLING_COEFFICIENT = .025;
const HANDOFF_TRAVEL = 7.6;

function interpolate(a, b, fraction) {
  return Object.fromEntries(Object.keys(a).map(key => [key, a[key] + (b[key] - a[key]) * fraction]));
}

function sampleAt(samples, key, value) {
  if (value <= samples[0][key]) return samples[0];
  let low = 0, high = samples.length - 1;
  if (value >= samples[high][key]) return samples[high];
  while (high - low > 1) {
    const mid = (low + high) >>> 1;
    if (samples[mid][key] <= value) low = mid;
    else high = mid;
  }
  const a = samples[low], b = samples[high];
  return interpolate(a, b, (value - a[key]) / (b[key] - a[key]));
}

export function poweredGroundRoll(profile, base, weather, gustOffset, windField) {
  const plane = profile.propulsion, dynamics = poweredFlightDynamics(profile, base, weather, gustOffset, windField);
  const climate = riderClimate(weather, gustOffset);
  const reference = releaseState(base, true, true, profile);
  const horizontal = Math.hypot(base.rightStep, base.forwardStep);
  const pushed = Math.min(HANDOFF_TRAVEL, base.pushed);
  function forces(s, watts) {
    const remaining = (base.length ?? RAMP_LENGTH) - s.travel;
    const state = { ...reference, omega: s.omega, height: reference.height + remaining * base.dropStep,
      forward: reference.forward - remaining * base.forwardStep, right: reference.right - remaining * base.rightStep,
      u: s.speed * horizontal, w: -s.speed * base.dropStep };
    const loads = dynamics.loadsAt(state, s.t);
    const rate = dynamics.rates(state, s.t, 0, 0, loads, watts);
    const support = -plane.mass * (rate.u * base.dropStep + rate.w * horizontal);
    const buildup = .15 + .85 * Math.min(1, s.travel / 3);
    const push = MAX_PUSH_N * buildup * base.push * Math.max(0, Math.min(1, (pushed - s.travel) / 1.5));
    return { airspeed: loads.air.speed, support, pitchAcceleration: rate.q, acceleration: rate.u * horizontal - rate.w * base.dropStep +
      (push - ROLLING_COEFFICIENT * Math.max(0, support)) / plane.mass, rotor: rate.omega };
  }
  function advance(s, dt, demand, held = false, brakingN = 0) {
    const start = forces(s, s.watts);
    const effort = pedalEffort(demand, s.reserve, dt, riderCriticalPower(climate, start.airspeed));
    const mid = { ...s, t: s.t + dt/2, omega: s.omega + start.rotor * dt/2,
      speed: held ? 0 : Math.max(0, s.speed + (start.acceleration - brakingN / plane.mass) * dt/2), travel: s.travel + s.speed * dt/2 };
    const rate = forces(mid, effort.watts);
    return { t: s.t + dt, wheelSupport: Math.max(0, rate.support), speed: held ? 0 : Math.max(0, s.speed + (rate.acceleration - brakingN / plane.mass) * dt),
      travel: s.travel + mid.speed * dt, omega: s.omega + rate.rotor * dt,
      angle: s.angle + mid.omega * dt, reserve: effort.reserve, watts: effort.watts };
  }
  return { forces, advance };
}

export function poweredLaunch(profile, base, weather, gustOffset) {
  const groundRoll = poweredGroundRoll(profile, base, weather, gustOffset);
  const pushed = Math.min(HANDOFF_TRAVEL, base.pushed);
  const forces = s => groundRoll.forces(s, 300);
  let s = { t: -SPINUP_SECONDS, speed: 0, travel: 0, omega: 0, angle: 0, reserve: reserveCapacityJ, watts: 300 };
  const samples = [s];
  const advance = (dt, held) => groundRoll.advance(s, dt, 300, held);
  while (s.t < 0) {
    s = advance(Math.min(STEP, -s.t), true);
    samples.push(s);
  }
  const go = samples.length - 1;
  let normal = forces(s).support;
  for (;;) {
    const next = advance(STEP, false), nextNormal = forces(next).support;
    if (next.travel >= RAMP_LENGTH || nextNormal <= 0) {
      const edge = (RAMP_LENGTH - s.travel) / (next.travel - s.travel);
      const unload = nextNormal <= 0 ? normal / (normal - nextNormal) : Infinity;
      s = interpolate(s, next, Math.max(0, Math.min(1, edge, unload)));
      samples.push(s);
      break;
    }
    if (next.t > 20 || next.speed <= 0) throw new RangeError('Powered launch failed to clear the deck.');
    samples.push(next);
    s = next;
    normal = nextNormal;
  }
  const ground = samples.slice(go);
  const remaining = RAMP_LENGTH - s.travel;
  const timeAtTravel = travel => sampleAt(ground, 'travel', travel).t;
  const handoff = sampleAt(ground, 'travel', pushed);
  return { ...base, speed: s.speed, duration: s.t, pushed: handoff.travel,
    handoffSpeed: handoff.speed, acceleration: forces(ground[0]).acceleration,
    releaseTravel: s.travel, releaseHeightOffset: remaining * base.dropStep,
    releaseRightOffset: -remaining * base.rightStep, releaseForwardOffset: -remaining * base.forwardStep,
    windTimeOffset: s.t, handoffTime: handoff.t, timeAtTravel,
    rampSampleAt: time => sampleAt(ground,'t',time),
    driveAt(secondsSinceSpinup) {
      const v = sampleAt(samples,'t',secondsSinceSpinup - SPINUP_SECONDS);
      return { rpm: v.omega / RAD_PER_RPM, reserve: v.reserve, watts: secondsSinceSpinup > 0 ? 300 : 0,
        propellerAngle: v.angle, crankAngle: v.angle / propTurnsPerCrank };
    } };
}
