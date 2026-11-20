// node analysis/ren-wing-trials.js [steps|trim|gust]
import { aircraftProfile } from '../src/domain/aircraft-profiles.js';
import { releaseState } from '../src/domain/aircraft-dynamics.js';
import { advanceState, launchProfile, STEPS_PER_SECOND } from '../src/domain/flight.js';
import { poweredFlightDynamics } from '../src/domain/powered-flight.js';
import { propellerModel } from '../src/domain/powered-cruise.js';
import { RADIANS_PER_DEGREE, RAD_PER_RPM } from '../src/domain/units.js';

const profile = aircraftProfile('ren');
const plane = profile.propulsion;
const launch = launchProfile();
const dynamics = poweredFlightDynamics(profile, launch, 'calm', 0);
// CG altitude at 90 s in release 40d8410's zero-wind trial. Start both models
// here to exclude the difference accumulated during launch and the first 90 s.
const comparisonHeight = 11.386902371717468;
const cruiseState = height => ({ ...releaseState(launch, true, true, profile), height,
  u: plane.speed, w: 0, omega: plane.rpm * RAD_PER_RPM, propellerAngle: 0, gustRollRate: 0 });
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

function* trajectory(model, initial, watts, rudder, seconds) {
  let s = initial;
  const dt = 1 / STEPS_PER_SECOND;
  for (let k = 0; k <= seconds * STEPS_PER_SECOND; k++) {
    const t = k / STEPS_PER_SECOND;
    yield { t, s };
    if (k === seconds * STEPS_PER_SECOND) break;
    const mid = advanceState(s, model.rates(s, t, 0, rudder, undefined, watts), dt / 2, 0);
    s = advanceState(s, model.rates(mid, t + dt / 2, 0, rudder, undefined, watts), dt, 0);
  }
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
    const field = (_mode, pos, time) => {
      // A fixed half-plane over the lake, separated from the centre by 3 m.
      const exposed = side === 0 || side * (pos.right - launch.edgeRight) > 3;
      const updraft = exposed && time <= 1 ? 0.5 * Math.sin(Math.PI * time) ** 2 : 0;
      return { headwind: 0, crosswind: 0, updraft };
    };
    const model = poweredFlightDynamics(profile, launch, 'calm', 0, field);
    const { omega, watts } = levelTrim(comparisonHeight);
    const initial = { ...cruiseState(comparisonHeight), omega };
    for (const { t, s } of trajectory(model, initial, watts, 0, 10)) {
      console.log([side, t, s.bank / RADIANS_PER_DEGREE, s.p / RADIANS_PER_DEGREE].join(','));
    }
  }
} else throw new RangeError('Expected steps, trim or gust');
