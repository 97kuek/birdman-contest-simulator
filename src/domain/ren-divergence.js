import { AIR_DENSITY, CRUISE_AIRCRAFT, wingPolar } from './powered-cruise.js';
import { renWingChord } from './ren-wing.js';

const plane = CRUISE_AIRCRAFT.ren;
const polar = wingPolar(plane);
const slope = (polar(plane.speed, .001).lift - polar(plane.speed, -.001).lift)
  / (.002 * .5 * AIR_DENSITY * plane.speed ** 2 * plane.area);

// Inverse stiffness iteration. Integrate strip torque from the free tip,
// then twist from the fixed root. The largest positive gain reaches 1 at qD.
export function criticalPressure({ rigidity, offset, span = plane.span / 2,
  chord = renWingChord, liftSlope = slope, strips = 128 }) {
  if (!(rigidity > 0 && Number.isFinite(rigidity) && Number.isFinite(offset) && span > 0 &&
      liftSlope > 0 && Number.isInteger(strips) && strips > 1)) throw new RangeError('Invalid torsion inputs');
  if (offset <= 0) return Infinity;
  const dx = span / strips;
  const torquePerPa = Array.from({ length: strips }, (_, i) =>
    liftSlope * chord((i + .5) * dx) ** 2 * offset * dx);
  const twist = Array.from({ length: strips + 1 }, (_, i) => i / strips);
  const elementTorque = new Float64Array(strips);
  let gain = 0;
  for (let iteration = 0; iteration < 50; iteration++) {
    let outboard = 0;
    for (let i = strips - 1; i >= 0; i--) {
      const torque = torquePerPa[i] * (twist[i] + twist[i + 1]) / 2;
      elementTorque[i] = outboard + torque / 2;
      outboard += torque;
    }
    for (let i = 0; i < strips; i++) twist[i + 1] = twist[i] + elementTorque[i] * dx / rigidity;
    gain = twist[strips];
    for (let i = 1; i <= strips; i++) twist[i] /= gain;
  }
  return 1 / gain;
}
