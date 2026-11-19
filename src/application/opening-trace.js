import { poseAt } from '../domain/flight.js';
import { readFlightInstruments } from '../domain/flight-instruments.js';

export const OPENING_SECONDS = 10;
export function openingTrace(run) {
  const end = Math.min(run.duration, OPENING_SECONDS);
  const samples = run.samples.filter((p) => p.t < end);
  samples.push(poseAt(run, end));
  return samples.map((sample) => {
    const { altitude, airspeed } = readFlightInstruments(sample);
    return { t: sample.t, height: altitude, speed: airspeed, pitchDeg: (sample.pitch * 180) / Math.PI };
  });
}
