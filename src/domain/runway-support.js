export const runwayLength = 850;
export const runwayHalfWidth = 15;
export function isOnPavement(right, forward) {
  return Math.abs(right) <= runwayHalfWidth && forward >= 0 && forward <= runwayLength;
}

// Illustrative waiting stations along the 850 m runway, measured from its
// south threshold. Catchers initially wait just outside the paved strip.
export const catcherStations = Object.freeze([64, 190, 320, 450, 580, 710, 825]);
export const catcherRunSpeed = 4.5;
export const catcherVerge = 18.2;

// The crew wait off the pavement and start jogging as the glider approaches.
export function waitingCatcher(station, side, offset, aircraftForward) {
  const jog = Math.max(0, Math.min(18, (aircraftForward - station + 80) * .25));
  return { right: side * catcherVerge, forward: station + offset + jog, holding: false };
}
export const rearCatchPoints = Object.freeze({
  frame: { side: -1, right: -.36, aft: .90, offset: -5 },
  tail: { side: 1, right: .29, aft: 5.83, offset: -7 },
});

export function predictedCatcherStation(sample) {
  const stoppingPoint = sample.forward + sample.groundSpeed ** 2 / .58;
  return catcherStations.reduce((a, b) => Math.abs(a - stoppingPoint) < Math.abs(b - stoppingPoint) ? a : b);
}

// Estimate the room needed for the pilot to react, descend with the propeller
// stopped and roll to a halt. These are simulator margins, not field procedures.
export function shouldCallForLanding(sample, runwayLength) {
  const along = sample.groundSpeed * Math.cos(sample.track);
  if (Math.abs(along) < .5) return false;
  const remaining = along > 0 ? runwayLength - sample.forward : sample.forward;
  const reactionSeconds = 5, descentMetresPerSecond = .22, deceleration = .22;
  const airSeconds = reactionSeconds + Math.max(0, sample.bottomHeight) / descentMetresPerSecond;
  const rollout = Math.abs(along) * sample.groundSpeed / (2 * deceleration);
  return remaining <= Math.abs(along) * airSeconds + rollout + 32;
}
