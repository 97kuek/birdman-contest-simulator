import { CG_HEIGHT } from './aircraft-dynamics.js';
import { aircraftProfile } from './aircraft-profiles.js';
import { poweredFlightDynamics } from './powered-flight.js';
import { predictedCatcherStation, waitingTeam, rearCatchPoints, moveRunner, catcherSideGap, wingGripSpan as catchSpan } from './runway-support.js';
import { RAD_PER_RPM } from './units.js';
import { geometryAt, hullAtControls } from './water-contact.js';

const profile = aircraftProfile('ren');
const wheelDepth = CG_HEIGHT + profile.deckClearance;
const gear = [[-1.04, -wheelDepth], [profile.releaseWheelAft, -wheelDepth]];
const pivotInertia = profile.rollInertia + profile.mass * wheelDepth ** 2;
const brakeForcePerRunnerN = 55;

// A receiver can move towards an intercept before the aircraft slows to
// running speed. Only a rendezvous with the actual grip point transfers load.
const receiverSprint = 6.2;
function intercept(member, side, sample, x, aft, dt, rear = false) {
  const cos = Math.cos(sample.heading), sin = Math.sin(sample.heading);
  const gripX = sample.right + x * cos - aft * sin;
  const gripF = sample.forward - x * sin - aft * cos;
  const trackX = Math.sin(sample.track), trackF = Math.cos(sample.track);
  const alongTrack = (member.right - gripX) * trackX + (member.forward - gripF) * trackF;
  const waitAhead = !member.holding && sample.groundSpeed > 1 ? Math.max(0, alongTrack) : 0;
  const clearance = rear && waitAhead > 0 ? side * catcherSideGap : 0;
  const next = moveRunner(member, gripX + waitAhead * trackX + clearance * cos,
    gripF + waitAhead * trackF - clearance * sin, receiverSprint * dt);
  // During a ground loop the outside wing can sweep past a runner even
  // when the aircraft centre is slow enough to follow.
  const gripSpeed = Math.hypot(sample.groundSpeed * trackX + (gripF - sample.forward) * sample.yawRate,
    sample.groundSpeed * trackF - (gripX - sample.right) * sample.yawRate);
  next.holding = !clearance && gripSpeed <= receiverSprint &&
    Math.hypot(next.right - gripX, next.forward - gripF) <= .35;
  return next;
}

// Both wheels are on the fuselage centreline. They carry the residual weight
// but do not constrain bank like a pair of laterally separated landing wheels.
export function createLandingRoll(hull, contact, weather, gustOffset) {
  const dynamics = poweredFlightDynamics(profile, { edgeRight: 0, edgeForward: 0 }, weather, gustOffset);
  const team = contact.catchers ?? waitingTeam(predictedCatcherStation(contact), contact.forward);
  const { station } = team;
  let { left, right } = team;
  const rear = Object.entries(rearCatchPoints).map(([name, point]) => ({
    name, point, runner: team[name], gripTime: 0,
  }));
  let catchReadyAt = null, wingCaughtAt = null, heldAtRestSeconds = 0;
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
    sample.yawRate = yawRate;
    sample.bank = bank;
    // Wing catchers can run alongside and steady the wing during rollout.
    // The hand force still requires an actual rendezvous with that wing.
    const arm = catchSpan * Math.cos(bank);
    left = intercept(left, -1, sample, -arm, .28, dt);
    right = intercept(right, 1, sample, arm, .28, dt);
    catchReadyAt ??= sample.t;
    if (left.holding || right.holding) wingCaughtAt ??= sample.t;

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
    sample.wheelsOnGround = wheelGap === 0;
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
      member.runner = intercept(runner, point.side, sample, point.right, point.aft, dt, true);
      member.gripTime = member.runner.holding ? member.gripTime + dt : 0;
      sample.catchers[member.name] = member.runner;
      sample.catcherBrakeN += brakeForcePerRunnerN * Math.min(1, member.gripTime / .7);
    }
    const secured = sample.groundSpeed === 0 && left.holding && right.holding && rear.every(member => member.runner.holding);
    heldAtRestSeconds = secured ? heldAtRestSeconds + dt : 0;
    // In crosswind a supported wing can settle at a small non-zero bank.
    return secured && ((Math.abs(bank) < .004 && Math.abs(rollRate) < .01) || heldAtRestSeconds >= 4);
  };
}
