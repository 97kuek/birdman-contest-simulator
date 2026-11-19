import { LAUNCH, RAMP_LENGTH } from '../domain/launch.js';
import { RADIANS_PER_DEGREE } from '../domain/units.js';

// +Z points back toward the shore. Behind the incline the working deck is level.
const angle = -LAUNCH.deckDeg * RADIANS_PER_DEGREE;
export const deckRun = RAMP_LENGTH * Math.cos(angle);
export const deckSlope = Math.tan(angle);

export function deckHeight(z) {
  return LAUNCH.edgeHeight + Math.min(z, deckRun) * deckSlope;
}
