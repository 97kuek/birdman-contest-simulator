import { CRUISE_AIRCRAFT } from './powered-cruise.js';

// Short lake course in platform right/forward metres. Designed for play.
export const practiceBuoys = Object.freeze([
  { right: -34, forward: 140 }, { right: 20, forward: 272 }, { right: 85, forward: 395 },
]);
const captureRadius = 23;
export const reserveCapacityJ = 15000;
export const cruisePowerW = CRUISE_AIRCRAFT.ren.power;
export const propTurnsPerCrank = 2;

// Scenario values, not measurements of the pilot. Aerodynamic wind is already
// included in airspeed; only a fraction reaches a rider inside the fairing.
export function riderClimate(weather, seed = 0) {
  const variation = Math.sin(seed * 1.73);
  if (weather.startsWith('day-')) return { celsius: 30 + 2 * variation, humidity: .67 + .06 * variation };
  if (weather.startsWith('night-')) return { celsius: 23 + 2 * variation, humidity: .78 + .06 * variation };
  return { celsius: 20, humidity: .5 };
}

export function riderCriticalPower(climate, airspeed) {
  const heat = Math.max(0, Math.min(1, (climate.celsius - 20) / 12));
  const humid = Math.max(0, Math.min(1, (climate.humidity - .4) / .4));
  const ventilation = Math.min(1, .4 * Math.max(0, airspeed) / 4.44);
  return 210 * (1 - heat * (.025 + .025 * humid + .06 * (1 - ventilation)));
}

export function pedalEffort(requested, reserve, dt, criticalPower = 210) {
  // A rider can spend at most the remaining work over a final 22 s effort.
  // Integrate the exponential exactly to avoid a cliff at the end of a sprint.
  const excessLimit = reserve * -Math.expm1(-dt / 22) / dt;
  const watts = Math.min(requested, criticalPower + excessLimit);
  const margin = criticalPower - watts;
  if (margin <= 0) return { watts, reserve: Math.max(0, reserve + margin * dt) };
  const tau = 546 * Math.exp(-.01 * margin) + 316;
  const recovery = (reserveCapacityJ - reserve) * -Math.expm1(-dt / tau) * Math.min(1, margin / 40);
  return { watts, reserve: reserve + recovery };
}

export function nextBuoy(index, position) {
  const mark = practiceBuoys[index];
  return mark && Math.hypot(mark.right - position.right, mark.forward - position.forward) <= captureRadius
    ? index + 1 : index;
}

export function navigation(sample) {
  const index = sample.courseLeg ?? 0, mark = practiceBuoys[index];
  if (!mark) return null;
  const dx = mark.right - sample.right, dy = mark.forward - sample.forward;
  const angle = Math.atan2(dx, dy) - sample.track;
  return { number: index + 1, metres: Math.hypot(dx, dy), correction: Math.atan2(Math.sin(angle), Math.cos(angle)) };
}
