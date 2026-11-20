import { AIR_DENSITY, propellerModel, wingPolar } from './powered-cruise.js';
import { GRAVITY, RADIANS_PER_DEGREE } from './units.js';
import { CG_HEIGHT, groundEffectFactor } from './aircraft-dynamics.js';
import { renSparHeight, renSparOutboardSlope, renWingResponse } from './ren-wing.js';
import { REN_TAIL, tailSection } from './ren-tail.js';
import { windAt } from './weather.js';

export function poweredFlightDynamics(profile, launch, weather, gustOffset, windField = windAt, isolation = {}) {
  const plane = profile.propulsion;
  const polar = wingPolar(plane), rotor = propellerModel(plane);
  const location = state => ({ right: launch.edgeRight + state.right,
    forward: launch.edgeForward + state.forward, heading: state.heading });

  // Centre of an elliptical load on each half-span and its effective dihedral.
  const arm = plane.span * 2 / (3 * Math.PI);
  const mount = renSparHeight(arm) - CG_HEIGHT;
  const dihedral = Math.atan(renSparOutboardSlope(arm));
  const bendAtArm = (arm / (plane.span / 2)) ** 2.5;
  const { horizontal, vertical } = REN_TAIL;
  const elevator = tailSection(horizontal), rudder = tailSection(vertical);
  // Approximate immersed area by the fraction of each span crossing the axial
  // propeller stream. Fixed disk footprint, no swirl or downstream mixing.
  const radius = plane.radius, hubHeight = plane.shaftHeight;
  const horizontalFraction = Math.min(1, 2 * Math.sqrt(Math.max(0, radius ** 2
    - (horizontal.height - hubHeight) ** 2)) / horizontal.span);
  const finBottom = vertical.height - vertical.span / 2, finTop = finBottom + vertical.span;
  const verticalFraction = Math.max(0, Math.min(finTop, hubHeight + radius)
    - Math.max(finBottom, hubHeight - radius)) / vertical.span;
  const diskMassPerLength = AIR_DENSITY * Math.PI * radius ** 2;
  const tailZ = CG_HEIGHT - horizontal.height, finZ = CG_HEIGHT - vertical.height;
  const ix = profile.rollInertia, iy = profile.pitchInertia, iz = ix + iy;

  function loadsAt(state, time) {
    const centre = { ...location(state), height: state.height, pathLength: state.pathLength, gustOffset };
    const sh = Math.sin(state.heading), ch = Math.cos(state.heading);
    const sb = Math.sin(state.bank), cb = Math.cos(state.bank);
    const sp = Math.sin(state.pitch), cp = Math.cos(state.pitch);

    // x,y,z and p,q,r are body-forward, right, down. Sample environmental wind
    // in world coordinates, then add the velocity of this rotating station.
    function stationFlow(x, y, z) {
      const offsetDown = y * sb + z * cb, side = y * cb - z * sb;
      const forward = x * cp + offsetDown * sp;
      const height = centre.height + x * sp - offsetDown * cp;
      const wind = windField(weather, { ...centre, height, right: centre.right + side * ch + forward * sh,
        forward: centre.forward + forward * ch - side * sh }, time + (launch.windTimeOffset ?? 0));
      const cross = wind.crosswind ?? 0;
      const headwind = wind.headwind * ch + cross * sh;
      const along = state.u + headwind, across = state.v + cross * ch - wind.headwind * sh;
      const up = state.w - wind.updraft, down = along * sp - up * cp;
      return { height, headwind, updraft: wind.updraft, along, across, up,
        axial: along * cp + up * sp + state.q * z - state.r * y,
        side: across * cb + down * sb + state.r * x - state.p * z,
        down: down * cb - across * sb + state.p * y - state.q * x };
    }

    const centreFlow = stationFlow(0, 0, 0);
    const { along, across, up, headwind, updraft, axial } = centreFlow;
    const speed = Math.hypot(along, across, up);
    const beta = Math.atan2(centreFlow.side, Math.hypot(axial, centreFlow.down));
    const pathAngle = Math.atan2(up, Math.hypot(along, across));
    const bodyDrag = polar(speed, 0).parasiteDrag;
    // Each wing's section velocity includes both yaw and roll. The baseline
    // polar uses projected wing area, so preserve its level vertical lift.
    function halfWing(sign) {
      const failure = isolation.failure;
      const side = sign < 0 ? 'left' : 'right';
      const fold = failure && (failure.side === side || failure.side === 'both')
        ? Math.min(1, Math.max(0, (time - failure.time) / .25)) : 0;
      const tip = (sign < 0 ? state.leftTip : state.rightTip) ?? 0;
      const tipRate = (sign < 0 ? state.leftTipRate : state.rightTipRate) ?? 0;
      const angle = Math.atan(Math.tan(dihedral) + 2.5 * bendAtArm * tip / arm);
      const cd = Math.cos(angle), sd = Math.sin(angle);
      const flow = stationFlow(0, sign * arm, -mount - tip * bendAtArm);
      // Analysis can isolate the sideslip and yaw-speed couplings independently.
      const normal = (flow.down - tipRate * bendAtArm) * cd + (isolation.omitWingSideflow ? 0 : sign * flow.side * sd);
      const axial = isolation.omitWingYawSpeed ? flow.axial + state.r * sign * arm : flow.axial;
      const alpha = Math.atan2(normal, axial);
      const section = polar(Math.hypot(axial, normal), alpha);
      // Only the panel beyond the flying-wire station folds. An elliptical
      // distribution puts roughly 36% of the half-wing lift outboard.
      const lift = section.lift * (1 - .36 * fold) / 2;
      const drag = section.inducedDrag * groundEffectFactor(flow.height, plane.span) / 2
        + .5 * AIR_DENSITY * axial ** 2 * plane.area * .12 * fold;
      const sectionLift = lift / cd;
      const fn = -sectionLift * Math.cos(alpha) - drag * Math.sin(alpha);
      return { height: flow.height, axial, lift, drag, x: sectionLift * Math.sin(alpha) - drag * Math.cos(alpha),
        y: fn * sign * sd, z: fn * cd };
    }
    const left = halfWing(-1), right = halfWing(1);
    return { air: { speed, beta: beta / RADIANS_PER_DEGREE, pathAngle, headwind, updraft, axial },
      axial, left, right, structure: renWingResponse(-left.z, -right.z, state, plane.mass, GRAVITY), lift: left.lift + right.lift, drag: bodyDrag + left.drag + right.drag,
      rollMoment: arm * (right.z - left.z) + mount * (right.y + left.y),
      yawMoment: arm * (left.x - right.x),
      x: left.x + right.x, y: left.y + right.y, z: left.z + right.z,
      dragScale: speed ? bodyDrag / speed : 0, along, across, up,
      tailFlow: stationFlow(-horizontal.arm, 0, tailZ), finFlow: stationFlow(-vertical.arm, 0, finZ) };
  }

  function rates(state, time, pitchInput, turnInput, loads = loadsAt(state, time), watts = plane.power, trace) {
    const { pitch, bank, heading, u, v, w, q, p, r, omega } = state;
    const { tailFlow, finFlow, dragScale } = loads;
    const { thrust, acceleration } = rotor(omega, loads.axial, watts);
    // Actuator-disk far-wake velocity increment, applied only for positive thrust.
    const approach = Math.max(0, loads.axial);
    const slipstream = Math.sqrt(approach ** 2 + 2 * Math.max(0, thrust) / diskMassPerLength) - approach;
    const tail = elevator(tailFlow.axial, tailFlow.down, -state.elevatorDeg * RADIANS_PER_DEGREE,
      slipstream, horizontalFraction);
    const fin = isolation.omitFin ? { axial: 0, normal: 0 } : rudder(finFlow.axial, finFlow.side, turnInput * profile.rudderLimitDeg * RADIANS_PER_DEGREE,
      slipstream, verticalFraction);
    const x = loads.x + tail.axial + fin.axial + thrust, y = loads.y + fin.normal, z = loads.z + tail.normal;
    if (trace) trace.finSideN = fin.normal;
    const rollMoment = loads.rollMoment - finZ * fin.normal;
    // The main wing and thrust line are trimmed about the CG at neutral.
    const pitchMoment = horizontal.arm * tail.normal + tailZ * tail.axial + finZ * fin.axial;
    const yawMoment = loads.yawMoment - vertical.arm * fin.normal;
    const sh = Math.sin(heading), ch = Math.cos(heading);
    const sb = Math.sin(bank), cb = Math.cos(bank), sp = Math.sin(pitch), cp = Math.cos(pitch);
    const down = y * sb + z * cb;
    const headingRate = (q * sb + r * cb) / cp;
    return {
      pathLength: Math.hypot(u, v), height: w, right: u * sh + v * ch, forward: u * ch - v * sh,
      u: (x * cp + down * sp - dragScale * loads.along) / plane.mass + headingRate * v,
      v: (y * cb - z * sb - dragScale * loads.across) / plane.mass - headingRate * u,
      w: (x * sp - down * cp - dragScale * loads.up) / plane.mass - GRAVITY,
      pitch: q * cb - r * sb, q: (pitchMoment + (iz - ix) * r * p) / iy,
      bank: p + sp * headingRate, p: (rollMoment + (iy - iz) * q * r) / ix,
      heading: headingRate, r: (yawMoment + (ix - iy) * p * q) / iz,
      leftTip: state.leftTipRate ?? 0, rightTip: state.rightTipRate ?? 0,
      leftTipRate: loads.structure.leftTipAcceleration, rightTipRate: loads.structure.rightTipAcceleration, bodyShift: 0,
      omega: acceleration, propellerAngle: omega,
    };
  }
  return { rates, loadsAt, location, prescribedCourse: false };
}
