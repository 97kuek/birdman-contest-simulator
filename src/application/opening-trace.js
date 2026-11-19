import { poseAt } from '../domain/flight.js';

export const OPENING_SECONDS = 10;
export function openingTrace(run) {
  const end = Math.min(run.duration, OPENING_SECONDS);
  const samples = run.samples.filter((p) => p.t < end);
  samples.push(poseAt(run, end));
  return samples.map((s) => ({
    t: s.t,
    height: s.bottomHeight,
    speed: s.speed,
    pitchDeg: (s.pitch * 180) / Math.PI,
  }));
}
