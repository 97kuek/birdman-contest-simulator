import { liftCoefficient } from './aerodynamic-lift.js';
import { GRAVITY } from './units.js';

// Design points, not telemetry. Sources and off-design assumptions are in docs/powered-cruise.md.
export const CRUISE_AIRCRAFT = Object.freeze({
  ren: Object.freeze({ name: '聯', mass: 87.7, span: 32.2, area: 28.25, speed: 7.2,
    power: 203, rpm: 144, thrust: 22, radius: 1.55 }),
  skyron: Object.freeze({ name: 'Skyron', mass: 100.6, span: 34, area: 29.01, speed: 7.4,
    power: 216, rpm: 135, thrust: 24, radius: 1.5 }),
});

const DENSITY = 1.225;
const SPAN_EFFICIENCY = 0.85;
const MAX_LIFT_COEFFICIENT = 1.45;
const EFFECTIVE_ROTOR_INERTIA = 0.8; // kg m², reflected to the propeller shaft
const RAD_PER_RPM = 2 * Math.PI / 60;
const HZ = 120;

// Ideal actuator disk in axial forward flow: P = 2ρA vi (V + vi)².
// Bisection covers both static thrust and forward flight without dividing by speed.
function propellerThrust(diskArea, speed, power) {
  if (power <= 0) return 0;
  const massFactor = 2 * DENSITY * diskArea;
  let low = 0, high = Math.cbrt(power / massFactor);
  for (let i = 0; i < 30; i++) {
    const induced = (low + high) / 2;
    if (massFactor * induced * (speed + induced) ** 2 > power) high = induced;
    else low = induced;
  }
  const induced = (low + high) / 2;
  return massFactor * induced * (speed + induced);
}

function cruiseForces(plane) {
  const weight = plane.mass * GRAVITY;
  const pressureArea = 0.5 * DENSITY * plane.speed ** 2 * plane.area;
  const trimLift = weight / pressureArea;
  const aspectRatio = plane.span ** 2 / plane.area;
  const inducedDragFactor = 1 / (Math.PI * SPAN_EFFICIENCY * aspectRatio);
  const parasiteDrag = plane.thrust / pressureArea - inducedDragFactor * trimLift ** 2;
  const liftSlope = 2 * Math.PI / (1 + 2 / (SPAN_EFFICIENCY * aspectRatio));
  const diskArea = Math.PI * plane.radius ** 2;
  const inducedAtTrim = (Math.sqrt(plane.speed ** 2 + 2 * plane.thrust / (DENSITY * diskArea)) - plane.speed) / 2;
  const trimDiskPower = plane.thrust * (plane.speed + inducedAtTrim);
  const trimOmega = plane.rpm * RAD_PER_RPM;

  return (state, watts) => {
    const { forward, up, omega } = state;
    const airspeed = Math.hypot(forward, up);
    const pathAngle = Math.atan2(up, forward);
    const cl = liftCoefficient(trimLift / liftSlope - pathAngle, liftSlope, MAX_LIFT_COEFFICIENT);
    const qS = 0.5 * DENSITY * airspeed ** 2 * plane.area;
    const lift = qS * cl, drag = qS * (parasiteDrag + inducedDragFactor * cl ** 2);
    const spin = omega / trimOmega;
    // Effective crank-to-rotor model: shaft demand scales with rpm³; losses are lumped.
    const loadTorque = plane.power / trimOmega * spin ** 2;
    const driveTorque = watts / Math.max(omega, trimOmega / 2);
    const thrust = propellerThrust(diskArea, Math.max(0, forward), trimDiskPower * spin ** 3);
    const sin = Math.sin(pathAngle), cos = Math.cos(pathAngle);
    return { thrust, lift, drag, airspeed, rates: {
      forward: (thrust - lift * sin - drag * cos) / plane.mass,
      up: (lift * cos - drag * sin - weight) / plane.mass,
      omega: (driveTorque - loadTorque) / EFFECTIVE_ROTOR_INERTIA,
      distance: forward, height: up,
    } };
  };
}

function advance(state, rates, dt) {
  return { forward: state.forward + dt * rates.forward, up: state.up + dt * rates.up,
    omega: Math.max(0, state.omega + dt * rates.omega),
    distance: state.distance + dt * rates.distance, height: state.height + dt * rates.height };
}

// Fixed attitude, still air, height relative to the initial cruise altitude.
export function runCruiseTrial(aircraftId, powerAfter30s) {
  const plane = CRUISE_AIRCRAFT[aircraftId];
  if (!Object.hasOwn(CRUISE_AIRCRAFT, aircraftId)) throw new RangeError('Unknown cruise aircraft');
  if (!Number.isFinite(powerAfter30s) || powerAfter30s < 0 || powerAfter30s > plane.power * 2)
    throw new RangeError('Cruise trial input must be between zero and twice design power');
  const forces = cruiseForces(plane);
  let state = { forward: plane.speed, up: 0, omega: plane.rpm * RAD_PER_RPM, distance: 0, height: 0 };
  const samples = [];
  for (let step = 0; step <= 60 * HZ; step++) {
    const watts = step < 30 * HZ ? plane.power : powerAfter30s;
    const current = forces(state, watts);
    if (step % HZ === 0) samples.push({ time: step / HZ, watts, ...state,
      rpm: state.omega / RAD_PER_RPM, speed: current.airspeed,
      lift: current.lift, drag: current.drag, thrust: current.thrust });
    if (step === 60 * HZ) break;
    const mid = advance(state, current.rates, 0.5 / HZ);
    state = advance(state, forces(mid, watts).rates, 1 / HZ);
  }
  return samples;
}
