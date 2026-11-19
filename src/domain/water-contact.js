import { windAt } from './weather.js';
import { RADIANS_PER_DEGREE } from './units.js';

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

export function hullAtControls(hull, rudderDeg, elevatorDeg = 0) {
  const turn = rudderDeg && hull.fin, pitch = elevatorDeg && hull.elevator;
  if (!turn && !pitch) return hull;
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
  return hull.fixed.concat(fin, elevator);
}

export function hullAtRudder(hull, degrees) {
  return hullAtControls(hull, degrees);
}

// Project model vertices about the CG. Banking requires the three-dimensional hull.
export function geometryAt(pitch, hull, bank = 0) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cb = Math.cos(bank), sb = Math.sin(bank);
  let bottom = Infinity, aft = -Infinity, contactAft = 0, contactSide = 0, tailSide = 0;
  for (const [z, y, x = 0] of ((bank && hull.spatial) || hull)) {
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
  return { bottom, aft, contactAft, contactSide, tailSide };
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

// Visual runout after scored contact. Drag and flotation approximate the settling motion.
export const WATER_RUNOUT_SECONDS = 4;
const RUNOUT = Object.freeze({
  pitchAmplitude: 0.045, pitchFrequency: 3, immersion: 0.12,
  maxHeave: 0.18, heaveResponse: 0.17, heaveFrequency: 4,
});

export function waterRunoutPose(contact, seconds, hull, wind) {
  if (seconds <= 0) return contact;
  const t = Math.min(seconds, WATER_RUNOUT_SECONDS);
  const remaining = 1 - t / WATER_RUNOUT_SECONDS;
  // Cubic speed decay and its integral in the horizontal track frame.
  const travel = contact.groundSpeed * WATER_RUNOUT_SECONDS / 4 * (1 - remaining ** 4);
  const groundSpeed = contact.groundSpeed * remaining ** 3;
  const along = Math.cos(contact.track), across = Math.sin(contact.track);
  const pitch = contact.pitch * remaining ** 2 - RUNOUT.pitchAmplitude * Math.sin(t * RUNOUT.pitchFrequency) * remaining ** 3;
  const pitchDerivative = -2 * contact.pitch * remaining / WATER_RUNOUT_SECONDS
    - RUNOUT.pitchAmplitude * RUNOUT.pitchFrequency * Math.cos(t * RUNOUT.pitchFrequency) * remaining ** 3
    + 3 * RUNOUT.pitchAmplitude * Math.sin(t * RUNOUT.pitchFrequency) * remaining ** 2 / WATER_RUNOUT_SECONDS;
  const bank = contact.bank * remaining ** 2;
  const forward = contact.forward + along * travel, right = contact.right + across * travel;
  const windTime = contact.t + t;
  const rudderDeg = (contact.rudderDeg ?? 0) * remaining;
  const elevatorDeg = (contact.elevatorDeg ?? 0) * remaining;
  const bottom = geometryAt(pitch, hull.elevator ? hullAtControls(hull, rudderDeg, elevatorDeg) : hull, bank).bottom;
  const immersion = RUNOUT.immersion * (1 - remaining ** 2);
  const heave = Math.max(-RUNOUT.maxHeave, Math.min(0, contact.verticalSpeed * RUNOUT.heaveResponse))
    * Math.sin(RUNOUT.heaveFrequency * t) * remaining ** 3;
  const height = -bottom - immersion + heave;
  if (typeof wind === 'string') wind = windAt(wind, { right, forward, height, pathLength: contact.pathLength, gustOffset: contact.gustOffset }, windTime);
  const crosswind = wind.crosswind ?? 0, updraft = wind.updraft ?? 0;
  const headwind = wind.headwind * Math.cos(contact.heading) + crosswind * Math.sin(contact.heading);
  return {
    ...contact, forward, right, windTime,
    groundSpeed, speed: Math.hypot(along * groundSpeed + wind.headwind, across * groundSpeed + crosswind, updraft),
    headwind, updraft, pitchRate: pitchDerivative * Math.cos(bank),
    rollRate: -2 * contact.bank * remaining / WATER_RUNOUT_SECONDS, yawRate: -pitchDerivative * Math.sin(bank),
    height, bottomHeight: 0, verticalSpeed: 0, pitch, bank,
    rudderDeg, elevatorDeg, bodyShift: contact.bodyShift === undefined ? undefined : contact.bodyShift * remaining, shift: contact.shift * remaining,
  };
}
