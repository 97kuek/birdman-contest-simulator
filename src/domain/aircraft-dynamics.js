import { horizontalTailLoad, liftCoefficient } from './aerodynamic-lift.js';
import { aircraftProfile } from './aircraft-profiles.js';
import { LAUNCH } from './launch.js';
import { bodyShiftFromCg, cgShiftFromBody, weightShiftRate } from './pilot-shift.js';
import { courseAt } from './race2025.js';
import { GRAVITY, RADIANS_PER_DEGREE } from './units.js';
import { solveWingStructure, wingBendShape } from './wing-structure.js';
import { WEATHER, WIND_RISE_METRES, windAt } from './weather.js';

export { BASE_DESIGN, RUDDER_LIMIT_DEG } from './aircraft-profiles.js';
export const CG_HEIGHT = 0.45;

const GROUND_EFFECT = Object.freeze({ heightScale: 33, heightExponent: 1.5, minimumRatio: 0.23 });
export function groundEffectFactor(wingHeight, span) {
  const ratio = GROUND_EFFECT.heightScale * (Math.max(0, wingHeight) / span) ** GROUND_EFFECT.heightExponent;
  return (GROUND_EFFECT.minimumRatio + ratio) / (1 + ratio);
}

const DRAG = Object.freeze({ variableAreaFraction: 0.7, fixedAreaFraction: 0.3, postStallFactor: 1.25 });

// Body axes are forward, right, down. Derivatives use degrees for beta and rudder,
// and nondimensional roll and yaw rates p*b/(2V) and r*b/(2V).
const SIDE = Object.freeze({ beta: -0.005465, roll: -0.541162, yaw: 0.170132, rudder: 0.002134 });
const ROLL = Object.freeze({ beta: -0.004723, roll: -0.794553, yaw: 0.203250, rudder: 0.000044 });
const YAW = Object.freeze({ beta: -0.000285, roll: -0.100557, yaw: -0.007178, rudder: -0.000305 });

export function releaseState(launch, release, pilot, profile = aircraftProfile(), attitude = {}) {
  const pitchDeg = release ? (attitude.pitchDeg ?? LAUNCH.pitchDeg) : LAUNCH.deckDeg;
  const pitchRateDeg = release ? (attitude.pitchRateDeg ?? profile.releasePitchRateDeg) : 0;
  if (!Number.isFinite(pitchDeg) || !Number.isFinite(pitchRateDeg)) throw new RangeError('Release attitude must be finite.');
  // QX has no measured release velocity. Carry its ramp velocity through the edge.
  const flightPath = release
    ? (profile.releasePathDeg == null ? -Math.asin(launch.dropStep) : profile.releasePathDeg * RADIANS_PER_DEGREE)
    : LAUNCH.deckDeg * RADIANS_PER_DEGREE;
  return {
    pathLength: 0, height: launch.edgeHeight + (launch.releaseHeightOffset ?? 0) + CG_HEIGHT + profile.deckClearance,
    u: launch.speed * Math.cos(flightPath), w: launch.speed * Math.sin(flightPath),
    pitch: pitchDeg * RADIANS_PER_DEGREE, q: pitchRateDeg * RADIANS_PER_DEGREE, elevatorDeg: 0,
    bodyShift: pilot ? bodyShiftFromCg(profile.releaseCgShift, profile) : 0,
    leftTip: 0, rightTip: 0, leftTipRate: 0, rightTipRate: 0,
    bank: 0, heading: launch.heading, right: (launch.releaseRightOffset ?? 0) + (profile.releaseWheelAft ?? 0) * Math.sin(launch.heading),
    forward: (launch.releaseForwardOffset ?? 0) + (profile.releaseWheelAft ?? 0) * Math.cos(launch.heading), v: 0, p: 0, r: 0,
  };
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

export function aircraftDynamics(design, launch, options) {
  const { referenceControl, weather, wind, gustOffset = 0 } = options;
  const experiment = options.releaseExperiment;
  const prescribedCourse = referenceControl && !experiment?.freeLateral;
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
    if (!prescribedCourse) return { right: state.right + launch.edgeRight, forward: state.forward + launch.edgeForward, heading: state.heading };
    const course = courseAt(state.pathLength);
    return { right: launch.edgeRight + course.right * launchCos + course.forward * launchSin,
      forward: launch.edgeForward + course.forward * launchCos - course.right * launchSin,
      heading: launch.heading + course.heading };
  }
  function airflow(state, time, position = location(state), localWind) {
    const { pathLength, u, w, v, pitch, bank, heading } = state;
    const wind = windAt(weather, { ...position, pathLength, height: position.height ?? state.height, gustOffset }, time, windRiseLength);
    // Fixed wind cards are in platform axes, including on the prescribed reference track.
    // The historical scalar wind scenario is the calibrated longitudinal component.
    const windHeading = prescribedCourse && wind.crosswind !== undefined
      ? position.heading : heading;
    const headingCos = Math.cos(windHeading), headingSin = Math.sin(windHeading);
    const crosswind = wind.crosswind ?? 0;
    const headwind = wind.headwind * headingCos + crosswind * headingSin + (localWind?.headwind ?? 0);
    const updraft = wind.updraft + (localWind?.updraft ?? 0);
    const airU = u + headwind, airW = w - updraft;
    const airV = prescribedCourse && wind.crosswind === undefined ? 0 : v - wind.headwind * headingSin + crosswind * headingCos;
    const speed = Math.hypot(airU, airW, airV);
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cb = Math.cos(bank), sb = Math.sin(bank);
    const down = sp * airU - cp * airW;
    const beta = Math.atan2(cb * airV + sb * down, speed) / RADIANS_PER_DEGREE;
    const axialSpeed = cp * airU + sp * airW;
    const downSpeed = cb * down - sb * airV;
    const alpha = Math.atan2(downSpeed, axialSpeed);
    return { speed, alpha, beta, axialSpeed, downSpeed, airU, airW, cp, sp, cb, sb, headwind, updraft };
  }

  // One bending mode per half-wing, sampled at its lift centroid.
  const bendAtLoadCentre = wingBendShape(profile.design.aircraftId ?? 'ryukai', 4 / (3 * Math.PI));
  const referenceHalfLift = .25 * airDensity * profile.cruiseSpeed ** 2 * profile.area * wingCL0;
  const rigidWing = options.rigidWing ?? false;

  function wingLoads(state, time, air, leftSupport, rightSupport) {
    const { height, heading } = state;
    const { speed, alpha, cp, sp, cb, sb } = air;
    const wingHeight = height + wingMountHeight - CG_HEIGHT;
    const wingAngle = wingCL0 / wingSlope + alpha + (incidence - profile.design.incidence) * RADIANS_PER_DEGREE;
    const centre = resolveWingGust || experiment?.wingWindAt ? location(state) : null;
    const ch = Math.cos(heading), sh = Math.sin(heading);
    const wingRight = ch * cb + sh * sp * sb, wingForward = -sh * cb + ch * sp * sb;

    function halfLoad(arm, tip, tipRate) {
      const bend = rigidWing ? 0 : bendAtLoadCentre * tip;
      const localHeight = wingHeight - arm * cp * sb + bend * cp * cb;
      const local = centre ? airflow(state, time, {
        right: centre.right + arm * wingRight + bend * (ch * sb - sh * sp * cb),
        forward: centre.forward + arm * wingForward - bend * (sh * sb + ch * sp * cb),
        height: localHeight,
      }, experiment?.wingWindAt?.(time, arm < 0 ? 'left' : 'right')) : air;
      // The right wing moves down during positive roll. Upward elastic motion
      // opposes that incidence change. Both act on the load carried by the spar.
      const baseAngle = wingAngle + local.alpha - alpha;
      const rollAngle = rigidWing ? 0 : Math.atan2(state.p * arm, local.speed);
      const angle = baseAngle + rollAngle
        - (rigidWing ? 0 : Math.atan2(bendAtLoadCentre * tipRate, local.speed));
      const pressureArea = .25 * airDensity * local.speed ** 2 * area;
      const cl = liftCoefficient(angle, wingSlope, profile.maxLiftCoefficient);
      const rigidRollLift = rollAngle === 0 ? 0 : pressureArea
        * (liftCoefficient(baseAngle + rollAngle, wingSlope, profile.maxLiftCoefficient)
          - liftCoefficient(baseAngle, wingSlope, profile.maxLiftCoefficient));
      return { lift: pressureArea * cl, rigidRollLift,
        slope: Math.abs(angle * wingSlope) < profile.maxLiftCoefficient ? pressureArea * wingSlope : 0,
        ground: groundEffectFactor(localHeight, effectiveSpan) };
    }
    const left = halfLoad(-halfWingArm, state.leftTip, state.leftTipRate);
    const right = halfLoad(halfWingArm, state.rightTip, state.rightTipRate);
    const structure = rigidWing ? null : solveWingStructure(profile, span, {
      leftSupport, rightSupport, supportStation: experiment?.supportStation,
      supportAcceleration: time >= 0 ? (leftSupport + rightSupport) / profile.mass : 0,
      leftLift: left.lift, rightLift: right.lift, leftLiftSlope: left.slope, rightLiftSlope: right.slope, referenceHalfLift,
      leftTip: state.leftTip, rightTip: state.rightTip, leftTipRate: state.leftTipRate, rightTipRate: state.rightTipRate,
    });
    const leftForce = structure?.leftLift ?? left.lift;
    const rightForce = structure?.rightLift ?? right.lift;
    const groundFactor = rigidWing ? groundEffectFactor(wingHeight, effectiveSpan) : (left.ground + right.ground) / 2;
    // The trainer's Cl_p already supplies the rigid roll-rate moment. Remove
    // its strip estimate with the same geometric arm as the structural solve.
    const rigidRollMoment = (left.rigidRollLift - right.rigidRollLift) * span * 2 / (3 * Math.PI);
    const roll = structure ? structure.rollMoment - rigidRollMoment : (leftForce - rightForce) * halfWingArm;
    return { structure, wingLift: leftForce + rightForce, gustRoll: roll * Math.cos(alpha), groundFactor, wingAngle };
  }

  function loadsAt(state, time) {
    const air = airflow(state, time);
    const left = experiment?.handForceAt?.(time, 'left') ?? 0;
    const right = experiment?.handForceAt?.(time, 'right') ?? 0;
    const normal = air.cp * air.cb;
    return { air, handForce: left + right, handDifference: left - right,
      ...wingLoads(state, time, air, left * normal, right * normal) };
  }

  function rates(state, time, pilotInput, turnInput, loads = loadsAt(state, time)) {
    // u, v are horizontal ground velocities along/across heading, w is vertical up.
    // p, q, r are body roll, pitch and yaw rates in radians per second.
    const { u, w, q, bodyShift, heading, v, p, r } = state;
    const { speed, alpha, beta, airU, airW, cp, sp, cb, sb } = loads.air;
    const { wingLift, gustRoll, groundFactor, wingAngle, structure } = loads;
    const pressure = 0.5 * airDensity * speed ** 2;
    const cl = rigidWing ? liftCoefficient(wingAngle, wingSlope, profile.maxLiftCoefficient) : wingLift / (pressure * area);
    const downwash = (wingCL0 - groundFactor * cl) / (Math.PI * efficiency * aspectRatio);
    const elevatorAngle = state.elevatorDeg * RADIANS_PER_DEGREE;
    // A differential vertical gust changes only the tail section's velocity.
    // Keep alpha in the CG wind axes when resolving its force for translation.
    const tailUp = experiment?.tailUpdraftAt?.(state.pathLength - tailArm * cp) ?? 0;
    const tailAir = tailUp ? { ...loads.air, axialSpeed: loads.air.axialSpeed - sp * tailUp,
      downSpeed: loads.air.downSpeed + cb * cp * tailUp } : loads.air;
    const tail = horizontalTailLoad(tailAir, q, tailArm, airDensity, tailArea, tailSlope,
      tailCL0 / tailSlope + downwash - elevatorAngle * profile.elevatorEffectiveness, profile.maxLiftCoefficient);
    const bendRates = {
      leftTip: state.leftTipRate, rightTip: state.rightTipRate,
      leftTipRate: structure?.leftTipAcceleration ?? 0,
      rightTipRate: structure?.rightTipAcceleration ?? 0,
    };
    const lift = wingLift + tail.lift;
    const wingStall = Math.max(0, Math.abs(wingAngle) - profile.maxLiftCoefficient / wingSlope);
    const inducedDrag = groundFactor * (lift / (pressure * area)) ** 2 / (Math.PI * aspectRatio * efficiency);
    const drag = tail.drag + pressure * (parasite + area * (inducedDrag + DRAG.postStallFactor * Math.sin(wingStall) ** 2));
    // Project the aerodynamic force onto the normal to the body-axis CG lever.
    const upwardNormal = lift * Math.cos(alpha) + drag * Math.sin(alpha);
    const { handForce, handDifference } = loads;
    const handLever = handForce ? experiment.handArm + cgShiftFromBody(bodyShift, profile) : 0;
    const differentialMoment = handDifference * (experiment?.supportStation ?? 0);
    const handMoment = handForce * handLever * cp * cb;
    const moment = handMoment + profile.wingMomentCoefficient * pressure * area * chord
      + wingLift * profile.wingMomentArmChords * chord - tailArm * tail.upwardNormal + upwardNormal * cgShiftFromBody(bodyShift, profile);
    const shiftRate = weightShiftRate(state, time, speed, pilotInput, Math.max(0, state.height - CG_HEIGHT), options);
    if (prescribedCourse) {
      // Pressure uses the complete airspeed. Lift and drag rotate in the pitch plane.
      const pitchPlaneSpeed = Math.hypot(airU, airW);
      return {
        ...bendRates, pathLength: u, height: w, u: (-drag * airU - lift * airW) / (pitchPlaneSpeed * profile.mass),
        w: (lift * airU - drag * airW) / (pitchPlaneSpeed * profile.mass) + handForce / profile.mass - GRAVITY, pitch: q, q: moment / pitchInertia,
        bodyShift: shiftRate, bank: 0, heading: 0, right: u * launchSin, forward: u * launchCos, v: 0, p: 0, r: 0,
      };
    }

    const lateral = lateralLoads(beta, turnInput * profile.rudderLimitDeg, p, r, speed, effectiveSpan, pressure * area, rudderScales);
    const axial = lift * Math.sin(alpha) - drag * Math.cos(alpha);
    const normal = -lift * Math.cos(alpha) - drag * Math.sin(alpha);
    const down = lateral.side * sb + normal * cb;
    const forwardForce = axial * cp + down * sp, upForce = axial * sp - down * cp;
    const rightForce = lateral.side * cb - normal * sb;
    const headingRate = (q * sb + r * cb) / cp;
    const sh = Math.sin(heading), ch = Math.cos(heading);
    return {
      ...bendRates, pathLength: Math.hypot(u, v), height: w,
      u: forwardForce / profile.mass + headingRate * v, w: (upForce + handForce) / profile.mass - GRAVITY,
      pitch: q * cb - r * sb, q: (moment + (yawInertia - rollInertia) * r * p) / pitchInertia,
      bodyShift: shiftRate, bank: p + headingRate * sp, heading: headingRate,
      right: u * sh + v * ch, forward: u * ch - v * sh, v: rightForce / profile.mass - headingRate * u,
      p: (lateral.roll + gustRoll + differentialMoment * cb * cp + (pitchInertia - yawInertia) * q * r) / rollInertia,
      r: (lateral.yaw + differentialMoment * sp - handForce * handLever * cp * sb + (rollInertia - pitchInertia) * p * q) / yawInertia,
    };
  }
  return { airflow, rates, location, loadsAt, prescribedCourse };
}
