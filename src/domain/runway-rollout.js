import { CG_HEIGHT } from './aircraft-dynamics.js';
import { aircraftProfile } from './aircraft-profiles.js';
import { poweredFlightDynamics } from './powered-flight.js';
import { catcherRunSpeed, catcherVerge, predictedCatcherStation, waitingCatcher, rearCatchPoints } from './runway-support.js';
import { RAD_PER_RPM } from './units.js';
import { geometryAt, hullAtControls } from './water-contact.js';

const profile = aircraftProfile('ren');
const wheelDepth = CG_HEIGHT + profile.deckClearance;
const gear = [[-1.04, -wheelDepth], [profile.releaseWheelAft, -wheelDepth]];
const pivotInertia = profile.rollInertia + profile.mass * wheelDepth ** 2;
const catchSpan = 12.5;
const brakeForcePerRunnerN = 55;

function moveCatcher(member, side, sample, approach, dt) {
  const arm = side * catchSpan * Math.cos(sample.bank);
  const right = approach ? sample.right + arm * Math.cos(sample.heading) - .28 * Math.sin(sample.heading) : side * catcherVerge;
  const forward = approach ? sample.forward - arm * Math.sin(sample.heading) - .28 * Math.cos(sample.heading) : sample.forward + 6;
  return pursue(member, right, forward, approach, dt);
}

function pursue(member, right, forward, approach, dt) {
  const dx = right - member.right, df = forward - member.forward;
  const distance = Math.hypot(dx, df);
  const fraction = Math.min(1, catcherRunSpeed * dt / (distance || 1));
  return { right: member.right + dx * fraction, forward: member.forward + df * fraction,
    holding: approach && distance * (1 - fraction) <= .35 };
}

// Both wheels are on the fuselage centreline. They carry the residual weight
// but do not constrain bank like a pair of laterally separated landing wheels.
export function createLandingRoll(hull, contact, weather, gustOffset) {
  const dynamics = poweredFlightDynamics(profile, { edgeRight: 0, edgeForward: 0 }, weather, gustOffset);
  const station = predictedCatcherStation(contact);
  let left = waitingCatcher(station, -1, 0, contact.forward);
  let right = waitingCatcher(station, 1, 0, contact.forward);
  const rear = Object.entries(rearCatchPoints).map(([name, point]) => ({
    name, point, runner: waitingCatcher(station, point.side, point.offset, contact.forward), gripTime: 0,
  }));
  let catchReadyAt = null, wingCaughtAt = null, bothHeldAt = null;
  let bank = contact.bank, rollRate = contact.rollRate;
  let heading = contact.heading, track = contact.track, yawRate = contact.yawRate;
  const yawInertia = profile.rollInertia + profile.pitchInertia;
  const initialWheelGap = Math.max(0, contact.height + geometryAt(contact.pitch, gear, bank).bottom);
  const verticalSpeed = Math.min(0, contact.verticalSpeed);
  const wingFirst = Math.abs(contact.contactSide) > 1;
  let leftTip = contact.wing.leftTip, rightTip = contact.wing.rightTip;
  let leftTipRate = 0, rightTipRate = 0;

  return function advance(sample, dt) {
    const settle = Math.max(0, 1 - (sample.t - contact.t) / .6);
    sample.pitch = contact.pitch * settle;
    sample.heading = heading;
    sample.track = track;
    sample.bank = bank;
    // Wing catchers can run alongside and steady the wing during rollout.
    // The hand force still requires an actual rendezvous with that wing.
    const approach = sample.groundSpeed <= catcherRunSpeed;
    left = moveCatcher(left, -1, sample, approach, dt);
    right = moveCatcher(right, 1, sample, approach, dt);
    if (approach) catchReadyAt ??= sample.t;
    if (left.holding || right.holding) wingCaughtAt ??= sample.t;
    if (left.holding && right.holding) bothHeldAt ??= sample.t;

    const drift = sample.track - sample.heading;
    const state = { ...sample, height: -geometryAt(sample.pitch, gear, bank).bottom,
      u: sample.groundSpeed * Math.cos(drift), v: sample.groundSpeed * Math.sin(drift), w: 0,
      p: rollRate, q: contact.pitchRate * settle, r: yawRate, omega: sample.rpm * RAD_PER_RPM,
      leftTip, rightTip, leftTipRate, rightTipRate };
    const loads = dynamics.loadsAt(state, sample.t);
    const rates = dynamics.rates(state, sample.t, 0, 0, loads, 0);
    const support = Math.max(0, -profile.mass * rates.w);
    const wheelMoment = support * wheelDepth * Math.sin(bank);
    // Each hand can lift its own side. The stiffness, damping and 110 N
    // limit are estimates for the simulation, applied only after arrival.
    const desiredMoment = -pivotInertia * (5 * bank + 3.5 * rollRate);
    const catchMoment = Math.min(left.holding ? 110 * catchSpan : 0,
      Math.max(right.holding ? -110 * catchSpan : 0, desiredMoment));
    rollRate += (rates.p * profile.rollInertia + wheelMoment + catchMoment) * dt / pivotInertia;
    bank += rollRate * dt;
    leftTipRate += rates.leftTipRate * dt;
    rightTipRate += rates.rightTipRate * dt;
    leftTip += leftTipRate * dt;
    rightTip += rightTipRate * dt;
    sample.wing = { ...contact.wing, leftTip, rightTip,
      leftMoment: loads.structure.leftMoment, rightMoment: loads.structure.rightMoment,
      utilization: loads.structure.utilization };

    // A low outer panel can touch the pavement before a catcher gets there.
    // Project back to wheel-and-wing contact instead of lifting the wheels.
    const shape = hullAtControls(hull, 0, 0, sample.wing);
    const lowest = geometryAt(sample.pitch, shape, bank);
    const elapsed = sample.t - contact.t;
    const wheelGap = Math.max(0, initialWheelGap + verticalSpeed * elapsed - 4.905 * elapsed ** 2);
    const penetration = geometryAt(sample.pitch, gear, bank).bottom - lowest.bottom - wheelGap;
    let tipDrag = 0, yawMoment = 0;
    if (penetration > 0 && Math.abs(lowest.contactSide) > 1) {
      const arm = lowest.contactSide;
      // Normal impulse required to arrest a descending tip, plus its elastic
      // contact load. Sliding friction opposes the tip velocity, including yaw.
      const normal = Math.min(profile.mass * 9.81, 7000 * penetration +
        350 * Math.max(0, arm * rollRate) + (wingFirst && wheelGap > 0 ? support : 0));
      const tipSpeed = sample.groundSpeed * Math.cos(track - heading) - arm * yawRate;
      const friction = .42 * normal * Math.tanh(tipSpeed / .3);
      tipDrag = friction * Math.cos(track - heading);
      yawMoment = arm * friction;
      bank -= penetration / lowest.contactSide;
      if (rollRate * lowest.contactSide > 0) rollRate = 0;
    }
    // Lateral tyre force turns the velocity vector towards the wheel plane.
    // Near rest the ground damps residual rotation instead of turning in place.
    const slip = sample.groundSpeed * Math.sin(heading - track);
    const lateral = wheelGap > 0 ? 0 : Math.min(.5 * support, Math.max(-.5 * support, 95 * slip));
    if (sample.groundSpeed > .15) track += lateral * dt / (profile.mass * sample.groundSpeed);
    yawRate += (yawMoment / yawInertia + rates.r - .7 * yawRate) * dt;
    if (sample.groundSpeed < .15) yawRate *= Math.exp(-6 * dt);
    heading += yawRate * dt;
    sample.heading = heading;
    sample.track = track;
    sample.yawRate = yawRate;
    sample.tipDragN = tipDrag;
    sample.bank = bank;
    sample.rollRate = rollRate;
    sample.height = Math.max(wheelGap - geometryAt(sample.pitch, gear, bank).bottom, -geometryAt(sample.pitch, shape, bank).bottom);
    sample.touchdownAt = contact.t;
    sample.catchReadyAt = catchReadyAt;
    sample.wingCaughtAt = wingCaughtAt;
    sample.caughtWing = left.holding && right.holding ? 'both' : left.holding ? 'left' : right.holding ? 'right' : null;
    sample.catchers = { station, left, right };
    sample.catcherBrakeN = 0;
    for (const member of rear) {
      const { point, runner } = member;
      const canEnter = approach && (runner.holding || runner.forward < sample.forward - point.aft || sample.groundSpeed < 1);
      const x = canEnter ? sample.right + point.right * Math.cos(sample.heading) - point.aft * Math.sin(sample.heading) : point.side * catcherVerge;
      const along = canEnter ? sample.forward - point.right * Math.sin(sample.heading) - point.aft * Math.cos(sample.heading) : sample.forward - point.aft - 2;
      member.runner = pursue(runner, x, along, canEnter, dt);
      member.gripTime = member.runner.holding ? member.gripTime + dt : 0;
      sample.catchers[member.name] = member.runner;
      sample.catcherBrakeN += brakeForcePerRunnerN * Math.min(1, member.gripTime / .7);
    }
    return sample.groundSpeed === 0 && rear.every(member => member.runner.holding) && bothHeldAt != null && sample.t - bothHeldAt >= 3;
  };
}
