import { propellerModel, wingPolar } from './powered-cruise.js';
import { GRAVITY, RADIANS_PER_DEGREE } from './units.js';
import { windAt } from './weather.js';

// Reduced-order rigid aircraft. The polar and shaft dynamics are shared with the
// cruise bench. The damped pitch and bank response represent unmeasured control
// derivatives. Translational motion still follows the aerodynamic forces.
export function poweredFlightDynamics(profile, launch, weather, gustOffset) {
  const plane = profile.propulsion;
  const polar = wingPolar(plane);
  const rotor = propellerModel(plane);
  const location = state => ({ right: launch.edgeRight + state.right,
    forward: launch.edgeForward + state.forward, heading: state.heading });

  function loadsAt(state, time) {
    const wind = windAt(weather, { ...location(state), height: state.height, pathLength: state.pathLength, gustOffset }, time);
    const sin = Math.sin(state.heading), cos = Math.cos(state.heading);
    const cross = wind.crosswind ?? 0;
    const headwind = wind.headwind * cos + cross * sin;
    const along = state.u + headwind;
    const across = state.v + cross * cos - wind.headwind * sin;
    const up = state.w - wind.updraft;
    const horizontal = Math.hypot(along, across);
    const speed = Math.hypot(horizontal, up);
    const beta = Math.atan2(across, along);
    const pathAngle = Math.atan2(up, horizontal);
    const axial = along * Math.cos(state.pitch) + up * Math.sin(state.pitch);
    return {
      air: { speed, headwind, updraft: wind.updraft, beta: beta / RADIANS_PER_DEGREE },
      beta, pathAngle, axial, ...polar(speed, state.pitch - pathAngle),
    };
  }

  function rates(state, time, pitchInput, turnInput, loads = loadsAt(state, time), watts = plane.power) {
    const { pitch, bank, heading, u, v, w, q, p, r, omega } = state;
    const { air, lift, drag, beta, pathAngle, axial } = loads;
    const { thrust, acceleration } = rotor(omega, axial, watts);
    const cp = Math.cos(pathAngle), sp = Math.sin(pathAngle);
    const cb = Math.cos(bank), sb = Math.sin(bank);
    // Lift is normal to the airflow. Roll it about the air path. Project drag
    // along the airflow and thrust along the propeller axis, then resolve the
    // horizontal forces into the rotating aircraft-heading frame.
    const alongForce = -drag * cp - lift * cb * sp;
    const acrossForce = lift * sb;
    const sh = Math.sin(heading), ch = Math.cos(heading);
    const speedRatio = Math.min(1.5, air.speed / plane.speed);
    const pitchTarget = 0.9 * state.elevatorDeg * RADIANS_PER_DEGREE;
    const bankTarget = 11 * RADIANS_PER_DEGREE * turnInput;
    // Fin weathercocking aligns the nose with the air-relative track.
    const turnRate = GRAVITY * Math.tan(bank) / Math.max(3, air.speed) + 0.7 * beta;
    return {
      pathLength: Math.hypot(u, v), height: w,
      right: u * sh + v * ch, forward: u * ch - v * sh,
      u: (alongForce * Math.cos(beta) - acrossForce * Math.sin(beta) + thrust * Math.cos(pitch)) / plane.mass + r * v,
      v: (alongForce * Math.sin(beta) + acrossForce * Math.cos(beta)) / plane.mass - r * u,
      w: (lift * cb * cp - drag * sp + thrust * Math.sin(pitch)) / plane.mass - GRAVITY,
      pitch: q, q: 2.5 * speedRatio ** 2 * (pitchTarget - pitch) - 2.8 * speedRatio * q,
      bank: p, p: 1.2 * speedRatio ** 2 * (bankTarget - bank) - 1.9 * speedRatio * p,
      heading: r, r: 1.8 * (turnRate - r),
      leftTip: 0, rightTip: 0, leftTipRate: 0, rightTipRate: 0, bodyShift: 0,
      omega: acceleration, propellerAngle: omega,
    };
  }
  return { rates, loadsAt, location, prescribedCourse: false };
}
