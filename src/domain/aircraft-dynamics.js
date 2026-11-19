import { aircraftProfile } from './aircraft-profiles.js';
import { LAUNCH } from './launch.js';
import { bodyShiftFromCg, cgShiftFromBody, limitBodyShift, PILOT_SHIFT } from './pilot-shift.js';
import { courseAt } from './race2025.js';
import { GRAVITY, RADIANS_PER_DEGREE } from './units.js';
import { WEATHER, WIND_RISE_METRES, windAt } from './weather.js';

export { BASE_DESIGN, RUDDER_LIMIT_DEG } from './aircraft-profiles.js';
export const CG_HEIGHT = 0.45;

const GROUND_EFFECT = Object.freeze({ heightScale: 33, heightExponent: 1.5, minimumRatio: 0.23 });
export function groundEffectFactor(wingHeight, span) {
  const ratio = GROUND_EFFECT.heightScale * (Math.max(0, wingHeight) / span) ** GROUND_EFFECT.heightExponent;
  return (GROUND_EFFECT.minimumRatio + ratio) / (1 + ratio);
}

const DRAG = Object.freeze({ variableAreaFraction: 0.7, fixedAreaFraction: 0.3, postStallFactor: 1.25 });
const MIN_POST_STALL_LIFT_FRACTION = 0.45;

// Body axes are forward, right, down. Derivatives use degrees for beta and rudder,
// and nondimensional roll and yaw rates p*b/(2V) and r*b/(2V).
const SIDE = Object.freeze({ beta: -0.005465, roll: -0.541162, yaw: 0.170132, rudder: 0.002134 });
const ROLL = Object.freeze({ beta: -0.004723, roll: -0.794553, yaw: 0.203250, rudder: 0.000044 });
const YAW = Object.freeze({ beta: -0.000285, roll: -0.100557, yaw: -0.007178, rudder: -0.000305 });

export const referenceTiming = Object.freeze({ returnSeconds: 0.45, onsetMetres: 0 });
const PILOT = Object.freeze({
  engagementMetres: 40, previousEngagementMetres: 65, earlyReturnMetres: 40,
  landingSpeed: 7.9, cruiseSpeedIncrement: 1.95, approachHeight: 2, flareHeight: 1.6,
  speedGain: 0.03, climbGain: 0.06, pitchDamping: 0.2, flareOffset: 0.07, flareClimbGain: 0.12,
});

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function releaseState(launch, release, pilot, profile = aircraftProfile()) {
  const pitch = (release ? LAUNCH.pitchDeg : LAUNCH.deckDeg) * RADIANS_PER_DEGREE;
  // QX has no measured release velocity. Carry its ramp velocity through the edge.
  const flightPath = release
    ? (profile.releasePathDeg == null ? -Math.asin(launch.dropStep) : profile.releasePathDeg * RADIANS_PER_DEGREE)
    : LAUNCH.deckDeg * RADIANS_PER_DEGREE;
  return {
    pathLength: 0, height: launch.edgeHeight + CG_HEIGHT + profile.deckClearance,
    u: launch.speed * Math.cos(flightPath), w: launch.speed * Math.sin(flightPath),
    pitch, elevatorDeg: 0, q: release ? profile.releasePitchRateDeg * RADIANS_PER_DEGREE : 0, bodyShift: pilot ? bodyShiftFromCg(profile.releaseCgShift, profile) : 0,
    bank: 0, heading: launch.heading, right: 0, forward: 0, v: 0, p: 0, r: 0,
  };
}

// Empirical bounded lift after stall, not a tunnel measurement of either section.
function liftCoefficient(angle, slope, maximum) {
  const linear = slope * angle;
  if (Math.abs(linear) <= maximum) return linear;
  const beyondStall = Math.abs(angle) - maximum / slope;
  return Math.sign(linear) * maximum * Math.max(MIN_POST_STALL_LIFT_FRACTION, Math.cos(2 * beyondStall));
}

function lateralLoads(beta, rudderRightDeg, rollRate, yawRate, speed, span, pressureArea, rudderScales) {
  const rateScale = span / (2 * speed);
  const p = rollRate * rateScale, r = yawRate * rateScale;
  const dr = -rudderRightDeg; // TORICA maps right-hand input to negative dr.
  const coefficient = (axis, scale) => axis.beta * beta + axis.roll * p + axis.yaw * r + axis.rudder * dr * scale;
  return {
    side: pressureArea * coefficient(SIDE, rudderScales.force),
    roll: pressureArea * span * coefficient(ROLL, rudderScales.force),
    yaw: pressureArea * span * coefficient(YAW, rudderScales.yaw),
  };
}

function weightShiftRate(state, speed, pilotInput, { pilot, referenceControl, onsetMetres, returnSeconds }) {
  const { bodyShift, pathLength, height, w, q } = state;
  let desired = limitBodyShift(PILOT_SHIFT.maxBodyTravel * pilotInput);
  if (referenceControl) {
    // The calibrated controller damps the launch phugoid and flares near water.
    const clearance = Math.max(0, height - CG_HEIGHT);
    const targetSpeed = PILOT.landingSpeed + PILOT.cruiseSpeedIncrement * clamp(clearance / PILOT.approachHeight, 0, 1);
    const flare = clamp(1 - clearance / PILOT.flareHeight, 0, 1);
    const trimShift = PILOT.speedGain * (speed - targetSpeed) - PILOT.climbGain * w - PILOT.pitchDamping * q;
    const flareShift = flare * (PILOT.flareOffset - PILOT.flareClimbGain * w);
    const engagementLength = pilot ? PILOT.engagementMetres : PILOT.previousEngagementMetres;
    const engagement = clamp((pathLength - (pilot ? onsetMetres : 0)) / engagementLength, 0, 1);
    // The historical reference controller requests an effective CG offset.
    desired = limitBodyShift(bodyShiftFromCg(engagement * (trimShift + flareShift)));
  }
  const returning = pilot && pathLength < PILOT.earlyReturnMetres && bodyShift < 0 && desired > bodyShift;
  const responseTime = returning ? returnSeconds : referenceTiming.returnSeconds;
  return clamp((desired - bodyShift) / responseTime, -PILOT_SHIFT.maxBodyRate, PILOT_SHIFT.maxBodyRate);
}

export function aircraftDynamics(design, launch, options) {
  const { referenceControl, weather, wind, gustOffset = 0 } = options;
  const { span, incidence } = design;
  const profile = aircraftProfile(options.aircraftId ?? design.aircraftId);
  const { efficiency, chord, tailArm, tailArea, pitchInertia, rollInertia, yawInertia, airDensity } = profile;
  const area = profile.area * span / profile.design.span;
  const wingMountHeight = design.wingMountHeight ?? profile.wingHeight;
  if (!Number.isFinite(wingMountHeight)) throw new RangeError('Wing height must be finite.');
  const effectiveSpan = span * (profile.span / profile.design.span);
  const aspectRatio = effectiveSpan ** 2 / area;
  // Transfer the trainer's rudder derivatives by fin area and yaw moment arm;
  // QX uses a hinged rudder on a fixed fin. Its flap effectiveness is estimated.
  const trainer = aircraftProfile();
  const finRatio = (profile.finArea / profile.area) / (trainer.finArea / trainer.area);
  const rudderForceScale = profile.rudderEffectiveness * finRatio;
  const rudderScales = { force: rudderForceScale,
    yaw: rudderForceScale * ((profile.finArm / profile.span) / (trainer.finArm / trainer.span)) };
  const resolveWingGust = !referenceControl && Boolean(WEATHER[weather].field);
  // Centroid of a semi-elliptical span load, measured from the aircraft centreline.
  const halfWingArm = effectiveSpan * 2 / (3 * Math.PI);
  const wingSlope = (profile.wingLiftSlopePerDegree / RADIANS_PER_DEGREE)
    * (1 + 2 / (efficiency * profile.aspectRatio)) / (1 + 2 / (efficiency * aspectRatio));
  const tailSlope = profile.tailLiftSlopePerDegree / RADIANS_PER_DEGREE;
  // Reference wing and tail lift coefficients trim the baseline at its design cruise.
  const baseCL = profile.mass * GRAVITY / (0.5 * airDensity * profile.cruiseSpeed ** 2 * profile.area);
  const tailCL0 = (profile.wingMomentCoefficient + baseCL * profile.wingMomentArmChords)
    / (profile.referenceTailVolume + tailArea / profile.area * profile.wingMomentArmChords);
  const wingCL0 = baseCL - tailCL0 * tailArea / profile.area;
  const parasite = profile.dragCoefficient * (DRAG.variableAreaFraction * area + DRAG.fixedAreaFraction * profile.area);
  const windRiseLength = wind ? WIND_RISE_METRES.current : WIND_RISE_METRES.previous;
  const launchCos = Math.cos(launch.heading), launchSin = Math.sin(launch.heading);

  function location(state) {
    if (!referenceControl) return { right: state.right + launch.edgeRight, forward: state.forward + launch.edgeForward, heading: state.heading };
    const course = courseAt(state.pathLength);
    return { right: launch.edgeRight + course.right * launchCos + course.forward * launchSin,
      forward: launch.edgeForward + course.forward * launchCos - course.right * launchSin,
      heading: launch.heading + course.heading };
  }
  function airflow(state, time, position = location(state)) {
    const { pathLength, u, w, v, pitch, bank, heading } = state;
    const wind = windAt(weather, { ...position, pathLength, height: position.height ?? state.height, gustOffset }, time, windRiseLength);
    // Fixed wind cards are in platform axes, including on the prescribed reference track.
    // The historical scalar wind scenario is the calibrated longitudinal component.
    const windHeading = referenceControl && wind.crosswind !== undefined
      ? position.heading : heading;
    const headingCos = Math.cos(windHeading), headingSin = Math.sin(windHeading);
    const crosswind = wind.crosswind ?? 0;
    const headwind = wind.headwind * headingCos + crosswind * headingSin;
    const airU = u + headwind, airW = w - wind.updraft;
    const airV = referenceControl && wind.crosswind === undefined ? 0 : v - wind.headwind * headingSin + crosswind * headingCos;
    const speed = Math.hypot(airU, airW, airV);
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cb = Math.cos(bank), sb = Math.sin(bank);
    const down = sp * airU - cp * airW;
    const beta = Math.atan((cb * airV + sb * down) / speed) / RADIANS_PER_DEGREE;
    const alpha = referenceControl ? pitch - Math.atan2(airW, airU) : Math.atan2(cb * down - sb * airV, cp * airU + sp * airW);
    return { speed, alpha, beta, airU, airW, cp, sp, cb, sb, headwind, updraft: wind.updraft };
  }

  function rates(state, time, pilotInput, turnInput) {
    // u, v are horizontal ground velocities along/across heading, w is vertical up.
    // p, q, r are body roll, pitch and yaw rates in radians per second.
    const { height, u, w, q, bodyShift, heading, v, p, r } = state;
    const { speed, alpha, beta, airU, airW, cp, sp, cb, sb } = airflow(state, time);
    const pressure = 0.5 * airDensity * speed ** 2;
    const wingHeight = Math.max(0, height + wingMountHeight - CG_HEIGHT);
    const groundFactor = groundEffectFactor(wingHeight, effectiveSpan);
    const wingAngle = wingCL0 / wingSlope + alpha + (incidence - profile.design.incidence) * RADIANS_PER_DEGREE;
    const cl = liftCoefficient(wingAngle, wingSlope, profile.maxLiftCoefficient);
    const downwash = (wingCL0 - groundFactor * cl) / (Math.PI * efficiency * aspectRatio);
    // Positive input moves the pilot aft and raises the elevator trailing edge.
    // Less upward tail force about the CG produces a nose-up moment.
    const elevatorAngle = state.elevatorDeg * RADIANS_PER_DEGREE;
    const tailAngle = tailCL0 / tailSlope + alpha + downwash + q * tailArm / speed
      - elevatorAngle * profile.elevatorEffectiveness;
    const tailCL = liftCoefficient(tailAngle, tailSlope, profile.maxLiftCoefficient);
    let wingLift = pressure * area * cl, gustRoll = 0;
    if (resolveWingGust) {
      const center = location(state);
      // Project the lateral wing axis using the same heading/pitch/bank as the rendered model.
      const ch = Math.cos(heading), sh = Math.sin(heading);
      const wingRight = ch * cb + sh * sp * sb, wingForward = -sh * cb + ch * sp * sb;
      const halfLift = arm => {
        const air = airflow(state, time, {
          right: center.right + arm * wingRight, forward: center.forward + arm * wingForward,
          height: wingHeight - arm * cp * sb, heading,
        });
        const localCL = liftCoefficient(wingAngle + air.alpha - alpha, wingSlope, profile.maxLiftCoefficient);
        return .25 * airDensity * air.speed ** 2 * area * localCL;
      };
      const left = halfLift(-halfWingArm), right = halfLift(halfWingArm);
      wingLift = left + right;
      gustRoll = (left - right) * halfWingArm * Math.cos(alpha);
    }
    const tailLift = pressure * tailArea * tailCL;
    const lift = wingLift + tailLift;
    const wingStall = Math.max(0, Math.abs(wingAngle) - profile.maxLiftCoefficient / wingSlope);
    const inducedDrag = groundFactor * (lift / (pressure * area)) ** 2 / (Math.PI * aspectRatio * efficiency);
    const drag = pressure * (parasite + area * (inducedDrag + DRAG.postStallFactor * Math.sin(wingStall) ** 2));
    // Project the aerodynamic force onto the normal to the body-axis CG lever.
    const upwardNormal = lift * Math.cos(alpha) + drag * Math.sin(alpha);
    const moment = profile.wingMomentCoefficient * pressure * area * chord
      + wingLift * profile.wingMomentArmChords * chord - tailArm * tailLift + upwardNormal * cgShiftFromBody(bodyShift, profile);
    const shiftRate = weightShiftRate(state, speed, pilotInput, options);
    if (referenceControl) {
      // Pressure uses the complete airspeed. Lift and drag rotate in the pitch plane.
      const pitchPlaneSpeed = Math.hypot(airU, airW);
      return {
        pathLength: u, height: w, u: (-drag * airU - lift * airW) / (pitchPlaneSpeed * profile.mass),
        w: (lift * airU - drag * airW) / (pitchPlaneSpeed * profile.mass) - GRAVITY, pitch: q, q: moment / pitchInertia,
        bodyShift: shiftRate, bank: 0, heading: 0, right: u * launchSin, forward: u * launchCos, v: 0, p: 0, r: 0,
      };
    }

    const loads = lateralLoads(beta, turnInput * profile.rudderLimitDeg, p, r, speed, effectiveSpan, pressure * area, rudderScales);
    const axial = lift * Math.sin(alpha) - drag * Math.cos(alpha);
    const normal = -lift * Math.cos(alpha) - drag * Math.sin(alpha);
    const down = loads.side * sb + normal * cb;
    const forwardForce = axial * cp + down * sp, upForce = axial * sp - down * cp;
    const rightForce = loads.side * cb - normal * sb;
    const headingRate = (q * sb + r * cb) / cp;
    const sh = Math.sin(heading), ch = Math.cos(heading);
    return {
      pathLength: Math.hypot(u, v), height: w,
      u: forwardForce / profile.mass + headingRate * v, w: upForce / profile.mass - GRAVITY,
      pitch: q * cb - r * sb, q: (moment + (yawInertia - rollInertia) * r * p) / pitchInertia,
      bodyShift: shiftRate, bank: p + headingRate * sp, heading: headingRate,
      right: u * sh + v * ch, forward: u * ch - v * sh, v: rightForce / profile.mass - headingRate * u,
      p: (loads.roll + gustRoll + (pitchInertia - yawInertia) * q * r) / rollInertia,
      r: (loads.yaw + (rollInertia - pitchInertia) * p * q) / yawInertia,
    };
  }
  return { airflow, rates, location };
}
