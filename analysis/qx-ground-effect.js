// Change only the aerodynamic height. Leave collision geometry, CG, inertia,
// input, atmosphere and launch fixed to isolate the ground-effect calculation.
import { aircraftProfile, QX25_DESIGN } from '../src/domain/aircraft-profiles.js';
import { CG_HEIGHT, groundEffectFactor } from '../src/domain/aircraft-dynamics.js';
import { simulateFlight } from '../src/domain/flight.js';
import { createQx25Aircraft } from '../src/rendering/aircraft/qx25.js';
import { modelHull } from '../src/rendering/collision-hull.js';

const low = aircraftProfile('qx25').wingHeight;
const raised = aircraftProfile('ryukai').wingHeight;
const hull = modelHull(createQx25Aircraft());
function factor(cgHeight, mount) {
  return groundEffectFactor(cgHeight - CG_HEIGHT + mount, QX25_DESIGN.span);
}
console.table([1, 2, 5, 10].map(cgHeight => ({
  cgHeight, low: factor(cgHeight, low), raised: factor(cgHeight, raised),
  inducedDragReductionAtEqualLiftPercent: 100 * (1 - factor(cgHeight, low) / factor(cgHeight, raised)),
})));
console.table(['calm', 'head', 'tail'].map(weather => {
  const fly = wingMountHeight => simulateFlight({ ...QX25_DESIGN, wingMountHeight }, hull, { weather });
  const a = fly(low), b = fly(raised);
  return { weather, lowMetres: a.distance, raisedMetres: b.distance, deltaMetres: a.distance - b.distance,
    lowSeconds: a.duration, raisedSeconds: b.duration };
}));
