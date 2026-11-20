// node analysis/ren-wing-trials.js [steps|trim|gust|steering|ablation|recovery]
import { aircraftProfile } from '../src/domain/aircraft-profiles.js';
import { releaseState } from '../src/domain/aircraft-dynamics.js';
import { advanceState, launchProfile, STEPS_PER_SECOND } from '../src/domain/flight.js';
import { poweredFlightDynamics } from '../src/domain/powered-flight.js';
import { propellerModel } from '../src/domain/powered-cruise.js';
import { RADIANS_PER_DEGREE, RAD_PER_RPM } from '../src/domain/units.js';

import { advanceElevator } from '../src/domain/elevator.js';

const profile = aircraftProfile('ren');
const plane = profile.propulsion;
const launch = launchProfile();
const dynamics = poweredFlightDynamics(profile, launch, 'calm', 0);
// CG altitude at 90 s in release 40d8410's zero-wind trial. Start both models
// here to exclude the difference accumulated during launch and the first 90 s.
const comparisonHeight = 11.386902371717468;
const cruiseState = height => ({ ...releaseState(launch, true, true, profile), height,
  u: plane.speed, w: 0, omega: plane.rpm * RAD_PER_RPM, propellerAngle: 0 });
const wingAboveCG = dynamics.loadsAt(cruiseState(0), 0).left.height;

function levelTrim(cgHeight) {
  const state = cruiseState(cgHeight);
  const drag = dynamics.loadsAt(state, 0).drag;
  const rotor = propellerModel(plane);
  let low = 0, high = state.omega * 1.2;
  for (let i = 0; i < 52; i++) {
    const mid = (low + high) / 2;
    if (rotor(mid, plane.speed, 0).thrust < drag) low = mid;
    else high = mid;
  }
  const omega = (low + high) / 2;
  // At fixed shaft speed angular acceleration is affine in pedal watts.
  const off = rotor(omega, plane.speed, 0).acceleration;
  const on = rotor(omega, plane.speed, plane.power).acceleration;
  const watts = plane.power * -off / (on - off);
  return { omega, watts, drag };
}

function* trajectory(model, initial, watts, rudder, seconds, elevator = 0, releaseAt = Infinity, startTime = 0) {
  let s = initial;
  const dt = 1 / STEPS_PER_SECOND;
  for (let k = 0; k <= seconds * STEPS_PER_SECOND; k++) {
    const t = startTime + k / STEPS_PER_SECOND;
    yield { t, s };
    if (k === seconds * STEPS_PER_SECOND) break;
    const pitch = t < releaseAt ? elevator : 0, turn = t < releaseAt ? rudder : 0;
    const angle = duration => advanceElevator(s.elevatorDeg, pitch, duration, profile);
    const mid = advanceState(s, model.rates(s, t, pitch, turn, undefined, watts), dt / 2, angle(dt / 2));
    s = advanceState(s, model.rates(mid, t + dt / 2, pitch, turn, undefined, watts), dt, angle(dt));
  }
}

function wingGust(side) {
  return (_mode, pos, time) => {
    const exposed = side === 0 || side * (pos.right - launch.edgeRight) > 3;
    const updraft = exposed && time <= 1 ? 0.5 * Math.sin(Math.PI * time) ** 2 : 0;
    return { headwind: 0, crosswind: 0, updraft };
  };
}

const trial = process.argv[2] ?? 'steps';
if (trial === 'steps') {
  console.log('rudder,watts,seconds,airspeed_mps,height_change_m,vertical_speed_mps,rpm,bank_deg,track_change_deg');
  for (const rudder of [0, 1]) for (const watts of [0, 203, 300]) {
    for (const { t, s } of trajectory(dynamics, cruiseState(comparisonHeight), watts, rudder, 10)) {
      if (!Number.isInteger(t)) continue;
      const track = s.heading + Math.atan2(s.v, s.u);
      const values = [Math.hypot(s.u, s.v, s.w), s.height - comparisonHeight, s.w, s.omega / RAD_PER_RPM,
        s.bank / RADIANS_PER_DEGREE, track / RADIANS_PER_DEGREE];
      console.log([rudder, watts, t, ...values.map(x => x.toFixed(6))].join(','));
    }
  }
} else if (trial === 'trim') {
  console.log('wing_height_m,drag_N,watts,rpm,10s_height_change_m');
  for (const h of [3, 5, 10, comparisonHeight + wingAboveCG, 20, 32.2]) {
    const state = cruiseState(h - wingAboveCG);
    const { omega, watts, drag } = levelTrim(state.height);
    const last = [...trajectory(dynamics, { ...state, omega }, watts, 0, 10)].at(-1).s;
    console.log([h, drag, watts, omega / RAD_PER_RPM, last.height - state.height].join(','));
  }
} else if (trial === 'gust') {
  console.log('wing,seconds,bank_deg,roll_rate_deg_s');
  for (const side of [-1, 1, 0]) {
    const model = poweredFlightDynamics(profile, launch, 'calm', 0, wingGust(side));
    const { omega, watts } = levelTrim(comparisonHeight);
    const initial = { ...cruiseState(comparisonHeight), omega };
    for (const { t, s } of trajectory(model, initial, watts, 0, 10)) {
      console.log([side, t, s.bank / RADIANS_PER_DEGREE, s.p / RADIANS_PER_DEGREE].join(','));
    }
  }
} else if (trial === 'steering') {
  console.log('control,seconds,pitch_deg,heading_deg,bank_deg,track_deg,height_change_m');
  const { omega, watts } = levelTrim(comparisonHeight);
  const initial = { ...cruiseState(comparisonHeight), omega };
  for (const control of ['elevator', 'rudder']) {
    const elevator = control === 'elevator' ? .25 : 0;
    const rudder = control === 'rudder' ? .25 : 0;
    for (const { t, s } of trajectory(dynamics, initial, watts, rudder, 10, elevator, 1)) {
      const track = s.heading + Math.atan2(s.v, s.u);
      const angles = [s.pitch, s.heading, s.bank, track].map(x => x / RADIANS_PER_DEGREE);
      console.log([control, t, ...angles, s.height - initial.height].join(','));
    }
  }
} else if (trial === 'ablation' || trial === 'recovery') {
  const field = wingGust(-1);
  const model = isolation => poweredFlightDynamics(profile, launch, 'calm', 0, field, isolation);
  const complete = model({});
  const { omega, watts } = levelTrim(comparisonHeight);
  const initial = { ...cruiseState(comparisonHeight), omega };
  // Branch from the same state just as the left-wing gust finishes.
  const atRelease = [...trajectory(complete, initial, watts, 0, 1)].at(-1).s;
  const cases = trial === 'ablation' ? [
    ['neutral', complete], ['no-fin', model({ omitFin: true })],
    ['no-wing-sideflow', model({ omitWingSideflow: true })],
    ['no-wing-yaw-speed', model({ omitWingYawSpeed: true })],
  ] : [['neutral', complete], ['quarter', complete, -.25], ['half', complete, -.5],
    ['full-short', complete, -1, 1.5], ['full', complete, -1]];
  console.log('case,seconds,bank_deg,roll_rate_deg_s,yaw_rate_deg_s,beta_deg,fin_side_N,left_minus_right_axial_mps,left_minus_right_lift_N,wing_roll_Nm,height_change_m');
  for (const [label, dynamics, rudder = 0, releaseAt = 2] of cases) {
    for (const { t, s } of trajectory(dynamics, atRelease, watts, rudder, 9, 0, releaseAt, 1)) {
      const loads = dynamics.loadsAt(s, t), trace = {};
      dynamics.rates(s, t, 0, t < releaseAt ? rudder : 0, loads, watts, trace);
      const angles = [s.bank, s.p, s.r].map(x => x / RADIANS_PER_DEGREE);
      console.log([label, t, ...angles, loads.air.beta, trace.finSideN,
        loads.left.axial - loads.right.axial, loads.left.lift - loads.right.lift,
        loads.rollMoment, s.height - initial.height].join(','));
    }
  }
} else throw new RangeError('Unknown trial: ' + trial);
