// Measure two physics steps and the pose read that a 60 Hz display requests.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { BASE_DESIGN, QX25_DESIGN, createFlight } from '../src/domain/flight.js';
import { createAircraft } from '../src/rendering/aircraft.js';
import { createQx25Aircraft } from '../src/rendering/aircraft/qx25.js';
import { modelHull } from '../src/rendering/collision-hull.js';

const framesPerSecond = 60;
const seconds = 10;
const warmups = 3;
const repetitions = 10;

function measure(design, model) {
  const hull = modelHull(model);
  const times = [];
  for (let run = 0; run < warmups + repetitions; run++) {
    const flight = createFlight(design, hull, { weather: 'day-normal', gustOffset: 0 });
    for (let frame = 1; frame <= seconds * framesPerSecond; frame++) {
      const started = performance.now();
      flight.advanceTo(frame / framesPerSecond, 0, 0);
      flight.current();
      const elapsed = performance.now() - started;
      if (run >= warmups) times.push(elapsed);
    }
    assert.equal(flight.time, seconds);
  }
  times.sort((a, b) => a - b);
  const percentile = fraction => times[Math.ceil(times.length * fraction) - 1].toFixed(3);
  return { frames: times.length, medianMs: percentile(0.5), p95Ms: percentile(0.95) };
}

console.table({
  '竜海': measure(BASE_DESIGN, createAircraft()),
  'QX-25': measure(QX25_DESIGN, createQx25Aircraft()),
});
