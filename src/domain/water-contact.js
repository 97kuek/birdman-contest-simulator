import { projectHalfWing, wingFoldDirection } from './wing-contact.js';
import { windAt } from './weather.js';
import { RADIANS_PER_DEGREE, RAD_PER_RPM } from './units.js';

// A convex hull of (aft, up) vertices is sufficient for straight, wings-level flight.
export function hull2D(points) {
  const sorted = points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  function chain(list) {
    const hull = [];
    for (const p of list) {
      while (hull.length > 1) {
        const a = hull.at(-2), b = hull.at(-1);
        if ((b[0] - a[0]) * (p[1] - a[1]) > (b[1] - a[1]) * (p[0] - a[0])) break;
        hull.pop();
      }
      hull.push(p);
    }
    return hull.slice(0, -1);
  }
  return [...chain(sorted), ...chain(sorted.reverse())];
}

export function hullAtControls(hull, rudderDeg, elevatorDeg = 0, wing) {
  const turn = rudderDeg && hull.fin, pitch = elevatorDeg && hull.elevator;
  const flexible = !!wing && !!hull.wings;
  if (!turn && !pitch) {
    return flexible ? { planar: hull.bodyPlanar, spatial: hull.bodySpatial, wings: hull.wings, wing } : hull;
  }
  let fin = hull.fin ?? [], elevator = hull.elevator ?? [];
  if (turn) {
    const angle = rudderDeg * RADIANS_PER_DEGREE, cos = Math.cos(angle), sin = Math.sin(angle);
    fin = fin.map(([aft, up, side]) => {
      const arm = aft - hull.hingeZ;
      return [hull.hingeZ + cos * arm - sin * side, up, cos * side + sin * arm];
    });
  }
  if (pitch) {
    const angle = elevatorDeg * RADIANS_PER_DEGREE, cos = Math.cos(angle), sin = Math.sin(angle);
    elevator = elevator.map(([aft, up, side]) => {
      const along = aft - hull.elevatorHingeZ, above = up - hull.elevatorHingeUp;
      return [hull.elevatorHingeZ + cos * along - sin * above,
        hull.elevatorHingeUp + sin * along + cos * above, side];
    });
  }
  if (flexible) {
    const spatial = hull.bodyFixed.concat(fin, elevator);
    return { planar: spatial, spatial, wings: hull.wings, wing };
  }
  return hull.fixed.concat(fin, elevator);
}

export function hullAtRudder(hull, degrees) {
  return hullAtControls(hull, degrees);
}

// Project model vertices about the CG. Banking requires the three-dimensional hull.
export function geometryAt(pitch, hull, bank = 0) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cb = Math.cos(bank), sb = Math.sin(bank);
  let bottom = Infinity, aft = -Infinity, contactAft = 0, contactSide = 0, tailSide = 0;
  for (const [z, y, x = 0] of ((bank && hull.spatial) || hull.planar || hull)) {
    const bankedUp = y * cb - x * sb;
    const vertical = bankedUp * cp - z * sp;
    const back = z * cp + bankedUp * sp;
    if (vertical < bottom) {
      bottom = vertical;
      contactAft = back;
      contactSide = x * cb + y * sb;
    }
    if (back > aft) {
      aft = back;
      tailSide = x * cb + y * sb;
    }
  }
  const shape = { bottom, aft, contactAft, contactSide, tailSide };
  if (hull.wing) {
    const { leftTip, leftTwist, rightTip, rightTwist } = hull.wing;
    projectHalfWing(hull.wings.left, leftTip, leftTwist, wingFoldDirection(hull.wing, 'left'), pitch, bank, shape);
    projectHalfWing(hull.wings.right, rightTip, rightTwist, wingFoldDirection(hull.wing, 'right'), pitch, bank, shape);
  }
  return shape;
}

// Score the tail position from the launch edge. First water contact can be at another vertex.
export function landingMeasurement(last, shape, launch) {
  const sin = Math.sin(last.heading), cos = Math.cos(last.heading);
  const tailRight = last.right - shape.aft * sin + shape.tailSide * cos;
  const tailForward = last.forward - shape.aft * cos - shape.tailSide * sin;
  const contactRight = last.right - shape.contactAft * sin + shape.contactSide * cos;
  const contactForward = last.forward - shape.contactAft * cos - shape.contactSide * sin;
  return {
    tailRight, tailForward, contactRight, contactForward, contactSide: shape.contactSide,
    distance: Math.hypot(tailRight - launch.edgeRight, tailForward - launch.edgeForward),
  };
}

export { WATER_RUNOUT_SECONDS } from './water-entry.js';
import { waterEntry, WATER_RUNOUT_SECONDS } from './water-entry.js';

export function waterRunoutPose(contact, seconds, hull, wind) {
  if (seconds <= 0) return contact;
  const t = Math.min(seconds, WATER_RUNOUT_SECONDS), remaining = 1 - t / WATER_RUNOUT_SECONDS;
  const { failedSide, leftFold, rightFold, leftTip, rightTip, pitchVelocity, bankRate, yaw, ...motion } = waterEntry(contact, hull, t);
  const { pitch, bank, right, forward, height, track, heading, groundSpeed, verticalSpeed } = motion;
  const windTime = (contact.windTime ?? contact.t ?? 0) + t;
  const wing = contact.wing && { ...contact.wing, leftTip, rightTip, leftFold, rightFold, failedSide,
    leftTwist: contact.wing.leftTwist * remaining, rightTwist: contact.wing.rightTwist * remaining };
  const rudderDeg = (contact.rudderDeg ?? 0) * remaining, elevatorDeg = (contact.elevatorDeg ?? 0) * remaining;
  const bottom = geometryAt(pitch, hullAtControls(hull, rudderDeg, elevatorDeg, wing), bank).bottom;
  if (typeof wind === 'string') wind = windAt(wind, { right, forward, height, pathLength: contact.pathLength, gustOffset: contact.gustOffset }, windTime);
  const crosswind = wind.crosswind ?? 0, updraft = wind.updraft ?? 0;
  return { ...contact, ...motion, wing, windTime, rudderDeg, elevatorDeg, bottomHeight: height + bottom,
    speed: Math.hypot(Math.cos(track)*groundSpeed + wind.headwind, Math.sin(track)*groundSpeed + crosswind, verticalSpeed-updraft),
    headwind: wind.headwind * Math.cos(heading) + crosswind * Math.sin(heading), updraft,
    rollRate: bankRate - yaw * Math.sin(pitch), pitchRate: pitchVelocity*Math.cos(bank) + yaw*Math.sin(bank)*Math.cos(pitch),
    yawRate: yaw*Math.cos(bank)*Math.cos(pitch) - pitchVelocity*Math.sin(bank),
    bodyShift: contact.bodyShift === undefined ? undefined : contact.bodyShift * remaining, shift: contact.shift * remaining,
    ...(contact.rpm === undefined ? {} : { watts: 0, rpm: contact.rpm * remaining ** 3,
      propellerAngle: contact.propellerAngle + contact.rpm * RAD_PER_RPM * WATER_RUNOUT_SECONDS / 4 * (1 - remaining ** 4) }) };
}
