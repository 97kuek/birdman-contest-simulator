// Fixed pilot commands and identical wind offsets across tiers; measures the model, not player skill.
import { readFileSync } from 'node:fs';
import { FlightSession } from '../src/application/flight-session.js';
import { createShoreline } from '../src/domain/shoreline.js';
import { WEATHER, windAt } from '../src/domain/weather.js';
import { WIND_GRID_SIZE } from '../src/domain/lake-breeze.js';
import { modelHull } from '../src/rendering/collision-hull.js';
import { createAircraft } from '../src/rendering/aircraft.js';

const hull = modelHull(createAircraft());
const rings = JSON.parse(readFileSync(new URL('../assets/terrain/flight-shore.json', import.meta.url)));
const shore = createShoreline(rings, 65 * Math.PI / 180);
const trials = 32;
const maneuver = process.argv.includes('--maneuver');
function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const index = (sorted.length - 1) * fraction, lo = Math.floor(index);
  return +(sorted[lo] + (sorted[Math.ceil(index)] - sorted[lo]) * (index - lo)).toFixed(2);
}
const rows = [];
for (const [mode, weather] of Object.entries(WEATHER)) {
  if (!weather.field) continue;
  const release = [], lateral = [], distances = [], crossChanges = [];
  let disqualified = 0;
  for (let i = 0; i < trials; i++) {
    const offset = (i + .5) * WIND_GRID_SIZE / trials;
    const session = new FlightSession(hull, mode, () => offset, shore);
    const attempt = session.startAttempt();
    release.push(attempt.samples[0].speed);
    if (maneuver) {
      const releaseTime = session.launch.duration;
      attempt.advance(releaseTime + 1.5, 0, 0);
      attempt.advance(releaseTime + 2.5, 1, 0);
      attempt.advance(releaseTime + 4, 0, 0.5);
    }
    const frame = attempt.advance(130, 0, 0);
    if (frame.phase === 'disqualified') disqualified++;
    else distances.push(frame.run.distance);
    const opening = attempt.samples.filter(s => s.t <= 10);
    lateral.push(Math.max(...opening.map(s => Math.abs(s.right))));
    const cross = opening.map(s => windAt(mode, s, s.t).crosswind);
    crossChanges.push(Math.max(...cross) - Math.min(...cross));
  }
  rows.push({ mode, trials, disqualified, airspeedP10: quantile(release, .1),
    crossRange10sMedian: quantile(crossChanges, .5), lateral10sMedian: quantile(lateral, .5),
    distanceP10: quantile(distances, .1), distanceMedian: quantile(distances, .5), distanceP90: quantile(distances, .9) });
}
console.table(rows);
