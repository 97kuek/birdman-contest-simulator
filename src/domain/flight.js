import { aircraftDynamics, referenceTiming, releaseState, RUDDER_LIMIT_DEG } from './aircraft-dynamics.js';
import { launchProfile } from './launch.js';
import { courseAt } from './race2025.js';
import { geometryAt, hullAtRudder, landingMeasurement } from './water-contact.js';

export { BASE_DESIGN, CG_HEIGHT, referenceTiming, RUDDER_LIMIT_DEG } from './aircraft-dynamics.js';
export { LAUNCH, launchProfile, MAX_LAUNCH_HEADING_DEGREES, rampAt, RAMP_LENGTH } from './launch.js';
export { hull2D, WATER_RUNOUT_SECONDS, waterRunoutPose } from './water-contact.js';

const STEPS_PER_SECOND = 120;
const DT = 1 / STEPS_PER_SECOND;
export const SAMPLES_PER_SECOND = 20;
export const FLIGHT_LIMIT_SECONDS = 120;
const STEPS_PER_SAMPLE = STEPS_PER_SECOND / SAMPLES_PER_SECOND;
// Compensate round-off when a caller requests an exact integration boundary.
const STEP_ROUNDING_TOLERANCE = 1e-9;

// Switches used by the calibration experiments to isolate early-flight assumptions.
export const previousFactors = Object.freeze({ release: false, pilot: false, wind: false });

function advanceState(state, rates, seconds) {
  return {
    pathLength: state.pathLength + seconds * rates.pathLength, height: state.height + seconds * rates.height,
    u: state.u + seconds * rates.u, w: state.w + seconds * rates.w,
    pitch: state.pitch + seconds * rates.pitch, q: state.q + seconds * rates.q, shift: state.shift + seconds * rates.shift,
    bank: state.bank + seconds * rates.bank, heading: state.heading + seconds * rates.heading,
    right: state.right + seconds * rates.right, forward: state.forward + seconds * rates.forward,
    v: state.v + seconds * rates.v, p: state.p + seconds * rates.p, r: state.r + seconds * rates.r,
  };
}

function recordCommand(log, command, start, end) {
  if (!command) return;
  const last = log.at(-1);
  if (last?.direction === command && last.end === start) last.end = end;
  else log.push({ start, end, direction: command });
}

export function createFlight({ span, incidence }, hull, {
  release = true, pilot = true, wind = true, weather = 'reference', push = 1, coast = 0, direction = 0,
  referenceControl = false, returnSeconds = referenceTiming.returnSeconds, onsetMetres = referenceTiming.onsetMetres,
} = {}) {
  if (!(returnSeconds > 0) || !Number.isFinite(returnSeconds) || !Number.isFinite(onsetMetres)) {
    throw new RangeError('Pilot return time must be positive and timing parameters must be finite.');
  }
  const design = { span, incidence };
  const launch = launchProfile(push, coast, direction);
  const { airflow, rates } = aircraftDynamics(design, launch, { pilot, wind, weather, referenceControl, returnSeconds, onsetMetres });
  const launchCos = Math.cos(launch.heading), launchSin = Math.sin(launch.heading);
  let state = releaseState(launch, release, pilot);
  let rudderDeg = 0, collisionHull = hull;
  let step = 0, result = null;
  const inputs = [], turnInputs = [];

  function bottomHeight({ height, pitch, bank }) {
    return height + geometryAt(pitch, collisionHull, bank).bottom;
  }

  function sample(t, state) {
    const { pathLength, height, u, v, w, pitch, bank, shift, p, r } = state;
    let { heading, right, forward } = state;
    if (referenceControl) {
      const course = courseAt(pathLength);
      right = course.right * launchCos + course.forward * launchSin;
      forward = course.forward * launchCos - course.right * launchSin;
      heading = course.heading + launch.heading;
    }
    const { speed, headwind, updraft, beta } = airflow(state, t);
    const track = referenceControl ? heading : heading + Math.atan2(v, u);
    return {
      t, pathLength, right: right + launch.edgeRight, forward: forward + launch.edgeForward, heading, track, bank,
      distance: Math.hypot(right, forward), height, bottomHeight: bottomHeight(state),
      pitch, speed, groundSpeed: Math.hypot(u, v), verticalSpeed: w, shift, headwind, updraft,
      rudderDeg, sideslipDeg: beta, rollRate: p, yawRate: r,
    };
  }

  const samples = [sample(0, state)];
  let clearance = samples[0].bottomHeight;

  function integrate(pilotInput, turnInput) {
    // Fixed-step midpoint integration keeps the trajectory independent of display cadence.
    const t = step * DT;
    const midpoint = advanceState(state, rates(state, t, pilotInput, turnInput), DT / 2);
    const next = advanceState(state, rates(midpoint, t + DT / 2, pilotInput, turnInput), DT);
    step++;
    const nextClearance = bottomHeight(next);
    if (nextClearance <= 0 || clearance <= 0) {
      const fraction = clearance <= 0 ? 0 : clearance / (clearance - nextClearance);
      const hit = { ...state };
      for (const key of Object.keys(hit)) hit[key] += fraction * (next[key] - state[key]);
      const shape = geometryAt(hit.pitch, collisionHull, hit.bank);
      hit.height = -shape.bottom;
      const last = sample((step - 1 + fraction) * DT, hit);
      samples.push(last);
      const { distance, ...positions } = landingMeasurement(last, shape, launch);
      result = { ...positions, weather, launch, design, samples, inputs, turnInputs, duration: last.t, distance };
      return;
    }
    state = next;
    clearance = nextClearance;
    if (step % STEPS_PER_SAMPLE === 0) samples.push(sample(step * DT, state));
  }
  return {
    samples,
    get result() { return result; },
    get time() { return result?.duration ?? step * DT; },
    current() { return result?.samples.at(-1) ?? sample(step * DT, state); },
    advanceTo(seconds, pilotInput = 0, turnInput = 0) {
      const target = Math.floor(Math.min(seconds, FLIGHT_LIMIT_SECONDS) * STEPS_PER_SECOND + STEP_ROUNDING_TOLERANCE);
      if (target <= step || result) return;
      const start = step * DT;
      turnInput = Math.max(-1, Math.min(1, turnInput));
      const degrees = turnInput * RUDDER_LIMIT_DEG;
      if (degrees !== rudderDeg) {
        rudderDeg = degrees;
        collisionHull = hullAtRudder(hull, degrees);
        clearance = bottomHeight(state);
      }
      while (step < target && !result) integrate(pilotInput, turnInput);
      const end = result?.duration ?? step * DT;
      recordCommand(inputs, pilotInput, start, end);
      recordCommand(turnInputs, turnInput, start, end);
      if (!result && step >= FLIGHT_LIMIT_SECONDS * STEPS_PER_SECOND) {
        throw new Error('Flight did not reach the water within the simulation window.');
      }
    },
  };
}

export function simulateFlight(design, hull, options) {
  const flight = createFlight(design, hull, { ...options, referenceControl: true });
  flight.advanceTo(FLIGHT_LIMIT_SECONDS);
  return flight.result;
}

export function poseAt(run, t) {
  // Hold the commanded rudder angle across reversals between recorded poses.
  const held = run.turnInputs?.find(input => input.start <= Math.max(0, t) && t < input.end);
  const rudderDeg = (held?.direction ?? 0) * RUDDER_LIMIT_DEG;
  if (t <= 0) return { ...run.samples[0], rudderDeg };
  if (t >= run.duration) return run.samples.at(-1);
  const i = Math.min(Math.floor(t * SAMPLES_PER_SECOND), run.samples.length - 2);
  const a = run.samples[i], b = run.samples[i + 1], fraction = (t - a.t) / (b.t - a.t);
  const lerp = key => a[key] + fraction * (b[key] - a[key]);
  return {
    t, right: lerp('right'), forward: lerp('forward'), heading: lerp('heading'), bank: lerp('bank'), track: lerp('track'),
    rudderDeg, sideslipDeg: lerp('sideslipDeg'), rollRate: lerp('rollRate'), yawRate: lerp('yawRate'),
    distance: lerp('distance'), pathLength: lerp('pathLength'), height: lerp('height'), bottomHeight: lerp('bottomHeight'),
    pitch: lerp('pitch'), speed: lerp('speed'), groundSpeed: lerp('groundSpeed'), verticalSpeed: lerp('verticalSpeed'),
    shift: lerp('shift'), headwind: lerp('headwind'), updraft: lerp('updraft'),
  };
}
