// Reduced-order response of an outer panel still attached by film and wires.
// Fold is signed and normalized to the angle shared by the mesh and contact hull.
import { wingFoldDirection } from './wing-contact.js';
import { GRAVITY } from './units.js';

const MAX_ANGLE = Math.PI / 3;
const RESPONSE_SECONDS = .045;
// Effective buoyant area and mass of a flooded outer panel are unmeasured.
// At 0.10 m immersion the restoring acceleration balances its own weight.
const FLOAT_DRAFT = .10;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function waterWing(wing, side, halfSpan, hinge) {
  const key = side < 0 ? 'left' : 'right';
  const arm = halfSpan - hinge;
  let failed = wing?.failedSide === key || wing?.failedSide === 'both';
  let fold = wingFoldDirection(wing, key), rate = 0, waterMoment = 0;
  return {
    get failed() { return failed; },
    get fold() { return fold; },
    position(x, up) {
      const span = Math.max(0, Math.abs(x) - hinge);
      return {
        x: x + side * span * (Math.cos(MAX_ANGLE) - 1) * Math.abs(fold),
        up: up + span * Math.sin(MAX_ANGLE) * fold,
      };
    },
    advance(moment, airFraction, tipHeight, bank, pitch, dt) {
      // Filter the applied water load through a short structural response.
      // A wet vertex alone transmits no finite load.
      waterMoment += (moment - waterMoment) * -Math.expm1(-dt / RESPONSE_SECONDS);
      const combined = (wing?.[key + 'Moment'] ?? 0) * airFraction + waterMoment;
      if (Math.abs(combined) > (wing?.limitMoment ?? Infinity)) failed = true;
      if (!failed) return;

      // Gravity lowers a free panel. At the waterline displacement and drag
      // oppose further immersion. Tip height uses this panel's current fold.
      const angle = fold * MAX_ANGLE;
      const gravity = -1.5 * GRAVITY / arm * Math.cos(angle - side * bank) * Math.cos(pitch);
      const immersion = Math.max(0, -tipHeight);
      const support = (1.5 * GRAVITY / arm) * immersion / FLOAT_DRAFT;
      const damping = 1.2 + 5 * clamp(immersion / .10, 0, 1);
      rate += (gravity + support - damping * rate) * dt;
      const next = clamp(angle + rate * dt, -MAX_ANGLE, MAX_ANGLE);
      if (Math.abs(next) === MAX_ANGLE) rate = 0;
      fold = next / MAX_ANGLE;
    },
  };
}
