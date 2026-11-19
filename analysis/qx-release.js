// Fixed inputs for comparing the opening pitch sequence. Times below are a
// reconstruction for the game's single control; the competition inputs are unknown.
import { createFlight, QX25_DESIGN } from '../src/domain/flight.js';
import { RADIANS_PER_DEGREE } from '../src/domain/units.js';
import { createQx25Aircraft } from '../src/rendering/aircraft/qx25.js';
import { modelHull } from '../src/rendering/collision-hull.js';

const hull = modelHull(createQx25Aircraft());
function fly(weather, intervals) {
  const flight = createFlight(QX25_DESIGN, hull, { weather });
  for (const [start, end, input] of intervals) {
    flight.advanceTo(start);
    flight.advanceTo(end, input);
  }
  flight.advanceTo(10);
  return flight.samples;
}

const toDegrees = value => Number((value / RADIANS_PER_DEGREE).toFixed(2));
const opening = fly('head', [[1, 1.4, -1], [2.05, 2.45, 1]]);
const checkpoints = [0, .3, 1.4, 2, 2.25, 2.5, 3, 3.5, 4, 5, 10];
console.table(checkpoints.map(t => {
  const s = opening.find(sample => Math.abs(sample.t - t) < 1e-8);
  return { seconds: t, pitchDeg: toDegrees(s.pitch), pitchRateDegPerSecond: toDegrees(s.pitchRate),
    elevatorDeg: Number(s.elevatorDeg.toFixed(2)) };
}));

// Peak pitch difference includes the continued response after releasing the key.
const neutral = fly('calm', []);
console.table([.1, .25].map(seconds => {
  const pulse = fly('calm', [[4, 4 + seconds, 1]]);
  const delta = pulse.map((s, i) => s.pitch - neutral[i].pitch);
  const end = pulse.findIndex(s => Math.abs(s.t - 4 - seconds) < 1e-8);
  return { seconds, pitchChangeAtKeyUpDeg: toDegrees(delta[end]),
    peakPitchChangeDeg: toDegrees(Math.max(...delta.filter((_, i) => pulse[i].t >= 4 && pulse[i].t <= 7))) };
}));
