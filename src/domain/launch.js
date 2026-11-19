import { GRAVITY, RADIANS_PER_DEGREE } from './units.js';
import { WEATHER } from './weather.js';

// SI units unless the property name specifies degrees. Positive pitch is nose-up.
export const LAUNCH = Object.freeze({
  speed: 8, deckDeg: -3.5, pitchDeg: 0, pathDeg: -7, pitchRateDeg: -14,
  edgeHeight: 10, mass: 100, deckClearance: 0.35, headwind: WEATHER.reference.lakeWindSpeed,
});
export const RAMP_LENGTH = 10;
// Player-selectable comparison range. The fan geometry is valid up to an open right angle.
export const MAX_LAUNCH_HEADING_DEGREES = 30;

// Constant effective push along the deck. After hand-off only the slope accelerates the glider.
export function launchProfile(push = 1, coast = 0, direction = 0, deckClearance = LAUNCH.deckClearance) {
  if (!Number.isFinite(push) || push <= 0 || !Number.isFinite(coast) || coast < 0 || coast > RAMP_LENGTH ||
      !Number.isFinite(direction) || Math.abs(direction) >= 90) {
    throw new RangeError('Invalid ramp push or hand-off distance.');
  }
  const deck = LAUNCH.deckDeg * RADIANS_PER_DEGREE;
  const heading = direction * RADIANS_PER_DEGREE;
  const fanAngle = Math.atan2(Math.cos(deck) * Math.sin(heading), Math.cos(heading));
  const rightStep = Math.sin(fanAngle);
  const forwardStep = Math.cos(deck) * Math.cos(fanAngle);
  const dropStep = -Math.sin(deck) * Math.cos(fanAngle);
  const edgeRight = RAMP_LENGTH * rightStep;
  const edgeForward = RAMP_LENGTH * (forwardStep - Math.cos(deck));
  const edgeHeight = LAUNCH.edgeHeight - edgeForward * Math.tan(-deck);
  const downhill = GRAVITY * dropStep;
  const pushAcceleration = LAUNCH.speed ** 2 / (2 * RAMP_LENGTH) + GRAVITY * Math.sin(deck);
  const acceleration = downhill + push * pushAcceleration;
  const pushed = RAMP_LENGTH - coast;
  const handoffSpeed = Math.sqrt(2 * acceleration * pushed);
  const handoffTime = handoffSpeed / acceleration;
  const speed = Math.sqrt(handoffSpeed ** 2 + 2 * downhill * coast);
  const duration = handoffTime + 2 * coast / (speed + handoffSpeed);
  return {
    push, coast, direction, heading, rightStep, forwardStep, dropStep, edgeRight, edgeForward,
    edgeHeight, deckClearance, downhill, acceleration, pushed, handoffSpeed, handoffTime, speed, duration,
  };
}

export function rampAt(profile, time) {
  const t = Math.min(profile.duration, Math.max(0, time));
  if (t <= profile.handoffTime) {
    return { travel: 0.5 * profile.acceleration * t * t, speed: profile.acceleration * t };
  }
  const dt = t - profile.handoffTime;
  return {
    travel: profile.pushed + dt * (profile.handoffSpeed + 0.5 * profile.downhill * dt),
    speed: profile.handoffSpeed + dt * profile.downhill,
  };
}
