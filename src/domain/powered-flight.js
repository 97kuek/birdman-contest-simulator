import { propellerModel, wingPolar } from './powered-cruise.js';
import { GRAVITY, RADIANS_PER_DEGREE } from './units.js';
import { CG_HEIGHT, groundEffectFactor } from './aircraft-dynamics.js';
import { renSparHeight } from './ren-wing.js';
import { windAt } from './weather.js';

// Reduced-order rigid aircraft. The polar and shaft dynamics are shared with the
// cruise bench. The damped pitch and bank response represent unmeasured control
// derivatives. Translational motion still follows the aerodynamic forces.
export function poweredFlightDynamics(profile, launch, weather, gustOffset, windField = windAt) {
  const plane = profile.propulsion;
  const polar = wingPolar(plane);
  const rotor = propellerModel(plane);
  const location = state => ({ right: launch.edgeRight + state.right,
    forward: launch.edgeForward + state.forward, heading: state.heading });

  // Centre of pressure of a semi-elliptical span load on each side.
  const arm = plane.span * 2 / (3 * Math.PI);
  const mount = renSparHeight(arm) - CG_HEIGHT;

  function loadsAt(state, time) {
    const centre = { ...location(state), height: state.height, pathLength: state.pathLength, gustOffset };
    const sh = Math.sin(state.heading), ch = Math.cos(state.heading);
    const sb = Math.sin(state.bank), cb = Math.cos(state.bank);
    const sp = Math.sin(state.pitch), cp = Math.cos(state.pitch);

    function airflow(position, forwardVelocity = 0, sideVelocity = 0, upVelocity = 0) {
      const wind = windField(weather, position, time);
      const cross = wind.crosswind ?? 0;
      const headwind = wind.headwind * ch + cross * sh;
      const along = state.u + forwardVelocity + headwind;
      const across = state.v + sideVelocity + cross * ch - wind.headwind * sh;
      const up = state.w + upVelocity - wind.updraft;
      const horizontal = Math.hypot(along, across);
      return { speed: Math.hypot(horizontal, up), beta: Math.atan2(across, along),
        pathAngle: Math.atan2(up, horizontal), axial: along * cp + up * sp, headwind, updraft: wind.updraft };
    }
    const air = airflow(centre);
    // Retain the aircraft's lumped parasite drag at its centre.
    const bodyDrag = polar(air.speed, state.pitch - air.pathAngle).parasiteDrag;
    function halfWing(station) {
      const up = mount * cb - station * sb;
      const side = station * cb + mount * sb;
      const forward = -up * sp;
      const height = centre.height + up * cp;
      const local = airflow({ ...centre, right: centre.right + side * ch + forward * sh,
        forward: centre.forward - side * sh + forward * ch, height },
        // Incremental wing velocity about the existing still-air rudder response.
        // The rising wing unloads in a gust; applying the entire commanded roll
        // rate here would count the original handling model's damping twice.
        state.gustRollRate * side * sp, state.gustRollRate * up, -state.gustRollRate * side * cp);
      const polarLoad = polar(local.speed, state.pitch - local.pathAngle);
      const lift = polarLoad.lift / 2;
      const drag = polarLoad.inducedDrag * groundEffectFactor(height, plane.span) / 2;
      const horizontal = -drag * Math.cos(local.pathAngle) - lift * cb * Math.sin(local.pathAngle);
      const lateral = lift * sb;
      const fx = horizontal * Math.cos(local.beta) - lateral * Math.sin(local.beta);
      const fy = horizontal * Math.sin(local.beta) + lateral * Math.cos(local.beta);
      const fz = lift * cb * Math.cos(local.pathAngle) - drag * Math.sin(local.pathAngle);
      const normal = cb * (fz * cp - fx * sp) + fy * sb;
      return { height, lift, drag, normal, forward: fx, right: fy, up: fz };
    }
    const left = halfWing(-arm), right = halfWing(arm);
    const horizontalDrag = bodyDrag * Math.cos(air.pathAngle);
    return { air: { ...air, beta: air.beta / RADIANS_PER_DEGREE }, beta: air.beta, axial: air.axial,
      left, right, lift: left.lift + right.lift, drag: bodyDrag + left.drag + right.drag,
      rollMoment: arm * (left.normal - right.normal),
      forwardForce: left.forward + right.forward - horizontalDrag * Math.cos(air.beta),
      rightForce: left.right + right.right - horizontalDrag * Math.sin(air.beta),
      upForce: left.up + right.up - bodyDrag * Math.sin(air.pathAngle) };
  }

  function rates(state, time, pitchInput, turnInput, loads = loadsAt(state, time), watts = plane.power) {
    const { pitch, bank, heading, u, v, w, q, p, r, omega } = state;
    const { air, beta, axial, forwardForce, rightForce, upForce, rollMoment } = loads;
    const { thrust, acceleration } = rotor(omega, axial, watts);
    const sh = Math.sin(heading), ch = Math.cos(heading);
    const speedRatio = Math.min(1.5, air.speed / plane.speed);
    const pitchTarget = 0.9 * state.elevatorDeg * RADIANS_PER_DEGREE;
    const bankTarget = 11 * RADIANS_PER_DEGREE * turnInput;
    // Fin weathercocking aligns the nose with the air-relative track.
    const turnRate = GRAVITY * Math.tan(bank) / Math.max(3, air.speed) + 0.7 * beta;
    const rollDamping = 1.9 * speedRatio;
    const wingRollAcceleration = rollMoment / profile.rollInertia;
    return {
      gustRollRate: wingRollAcceleration - rollDamping * state.gustRollRate,
      pathLength: Math.hypot(u, v), height: w,
      right: u * sh + v * ch, forward: u * ch - v * sh,
      u: (forwardForce + thrust * Math.cos(pitch)) / plane.mass + r * v,
      v: rightForce / plane.mass - r * u,
      w: (upForce + thrust * Math.sin(pitch)) / plane.mass - GRAVITY,
      pitch: q, q: 2.5 * speedRatio ** 2 * (pitchTarget - pitch) - 2.8 * speedRatio * q,
      bank: p, p: 1.2 * speedRatio ** 2 * (bankTarget - bank) - rollDamping * p + wingRollAcceleration,
      heading: r, r: 1.8 * (turnRate - r),
      leftTip: 0, rightTip: 0, leftTipRate: 0, rightTipRate: 0, bodyShift: 0,
      omega: acceleration, propellerAngle: omega,
    };
  }
  return { rates, loadsAt, location, prescribedCourse: false };
}
