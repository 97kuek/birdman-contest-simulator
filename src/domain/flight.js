import { aircraftDynamics, referenceTiming, releaseState } from './aircraft-dynamics.js';
import { aircraftProfile } from './aircraft-profiles.js';
import { aircraftShoreContact } from './shoreline.js';
import { cgShiftFromBody } from './pilot-shift.js';
import { launchProfile } from './launch.js';
import { geometryAt, hullAtControls, landingMeasurement } from './water-contact.js';

export { BASE_DESIGN, QX25_DESIGN, RUDDER_LIMIT_DEG } from './aircraft-profiles.js';
export { CG_HEIGHT, referenceTiming } from './aircraft-dynamics.js';
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
    pitch: state.pitch + seconds * rates.pitch, q: state.q + seconds * rates.q, bodyShift: state.bodyShift + seconds * rates.bodyShift,
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

export function createFlight(design, hull, {
  release = true, pilot = true, wind = true, weather = 'reference', gustOffset = 0, push = 1, coast = 0, direction = 0,
  aircraftId = design.aircraftId ?? 'ryukai', firstLand, referenceControl: requestedReference = false, returnSeconds = referenceTiming.returnSeconds, onsetMetres = referenceTiming.onsetMetres,
} = {}) {
  if (!(returnSeconds > 0) || !Number.isFinite(returnSeconds) || !Number.isFinite(onsetMetres)) {
    throw new RangeError('Pilot return time must be positive and timing parameters must be finite.');
  }
  const profile = aircraftProfile(aircraftId);
  // The prescribed course and controller were reconstructed from Tatsumi telemetry.
  const referenceControl = requestedReference && aircraftId === 'ryukai';
  design = { ...design };
  const launch = launchProfile(push, coast, direction, profile.deckClearance);
  const { airflow, rates, location } = aircraftDynamics(design, launch, { aircraftId, pilot, wind, weather, gustOffset, referenceControl, returnSeconds, onsetMetres });
  let state = releaseState(launch, release, pilot, profile);
  let rudderDeg = 0, elevatorDeg = 0, collisionHull = hull;
  const shoreContact = aircraftShoreContact(hull, firstLand);
  let step = 0, result = null, disqualified = null;
  const inputs = [], turnInputs = [];

  function bottomHeight({ height, pitch, bank }) {
    return height + geometryAt(pitch, collisionHull, bank).bottom;
  }

  function sample(t, state) {
    const { pathLength, height, u, v, w, pitch, bank, bodyShift, p, q, r } = state;
    const position = location(state);
    const { heading, right, forward } = position;
    const { speed, headwind, updraft, beta } = airflow(state, t, position);
    const track = referenceControl ? heading : heading + Math.atan2(v, u);
    return {
      t, pathLength, right, forward, gustOffset, heading, track, bank,
      distance: Math.hypot(right - launch.edgeRight, forward - launch.edgeForward), height, bottomHeight: bottomHeight(state),
      pitch, speed, groundSpeed: Math.hypot(u, v), verticalSpeed: w, pitchRate: q, bodyShift, shift: cgShiftFromBody(bodyShift, profile), headwind, updraft,
      rudderDeg, elevatorDeg, sideslipDeg: beta, rollRate: p, yawRate: r,
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
    const touching = nextClearance <= 0 || clearance <= 0;
    const fraction = clearance <= 0 ? 0 : touching ? clearance / (clearance - nextClearance) : 1;
    function stateAt(f) {
      if (f === 1) return next;
      const hit = { ...state };
      for (const key of Object.keys(hit)) hit[key] += f * (next[key] - state[key]);
      return hit;
    }
    const hit = stateAt(fraction);
    if (shoreContact) {
      const from = { ...location(state), pitch: state.pitch, bank: state.bank };
      const to = { ...location(hit), pitch: hit.pitch, bank: hit.bank };
      const shore = shoreContact(from, to);
      if (shore !== null) {
        disqualified = sample((step - 1 + fraction * shore) * DT, stateAt(fraction * shore));
        return;
      }
    }
    if (touching) {
      const shape = geometryAt(hit.pitch, collisionHull, hit.bank);
      hit.height = -shape.bottom;
      const last = sample((step - 1 + fraction) * DT, hit);
      const { distance, ...positions } = landingMeasurement(last, shape, launch);
      if (firstLand?.(positions.contactRight, positions.contactForward, positions.contactRight, positions.contactForward) != null) {
        disqualified = last;
        return;
      }
      samples.push(last);
      result = { ...positions, aircraftId, weather, gustOffset, launch, design, samples, inputs, turnInputs, duration: last.t, distance };
      return;
    }
    state = next;
    clearance = nextClearance;
    if (step % STEPS_PER_SAMPLE === 0) samples.push(sample(step * DT, state));
  }
  return {
    samples,
    get result() { return result; },
    get disqualified() { return disqualified; },
    get time() { return disqualified?.t ?? result?.duration ?? step * DT; },
    current() { return disqualified ?? result?.samples.at(-1) ?? sample(step * DT, state); },
    advanceTo(seconds, pilotInput = 0, turnInput = 0) {
      const target = Math.floor(Math.min(seconds, FLIGHT_LIMIT_SECONDS) * STEPS_PER_SECOND + STEP_ROUNDING_TOLERANCE);
      if (target <= step || result || disqualified) return;
      const start = step * DT;
      turnInput = Math.max(-1, Math.min(1, turnInput));
      pilotInput = Math.max(-1, Math.min(1, pilotInput));
      const turnDegrees = turnInput * profile.rudderLimitDeg;
      const pitchDegrees = profile.elevatorLimitDeg ? pilotInput * profile.elevatorLimitDeg : 0;
      if (turnDegrees !== rudderDeg || pitchDegrees !== elevatorDeg) {
        rudderDeg = turnDegrees;
        elevatorDeg = pitchDegrees;
        collisionHull = hullAtControls(hull, rudderDeg, elevatorDeg);
        clearance = bottomHeight(state);
      }
      while (step < target && !result && !disqualified) integrate(pilotInput, turnInput);
      const end = disqualified?.t ?? result?.duration ?? step * DT;
      recordCommand(inputs, pilotInput, start, end);
      recordCommand(turnInputs, turnInput, start, end);
      if (!result && !disqualified && step >= FLIGHT_LIMIT_SECONDS * STEPS_PER_SECOND) {
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
  if (t >= run.duration) return run.samples.at(-1);
  // Surface commands are held across sample boundaries, even on a quick reversal.
  const profile = aircraftProfile(run.aircraftId);
  const time = Math.max(0, t);
  const held = inputs => inputs?.find(input => input.start <= time && time < input.end)?.direction ?? 0;
  const rudderDeg = held(run.turnInputs) * profile.rudderLimitDeg;
  const elevatorDeg = profile.elevatorLimitDeg ? held(run.inputs) * profile.elevatorLimitDeg : 0;
  if (t <= 0) return { ...run.samples[0], rudderDeg, elevatorDeg };
  const i = Math.min(Math.floor(t * SAMPLES_PER_SECOND), run.samples.length - 2);
  const a = run.samples[i], b = run.samples[i + 1], fraction = (t - a.t) / (b.t - a.t);
  const lerp = key => a[key] + fraction * (b[key] - a[key]);
  return {
    t, gustOffset: run.gustOffset ?? 0, right: lerp('right'), forward: lerp('forward'), heading: lerp('heading'), bank: lerp('bank'), track: lerp('track'),
    rudderDeg, elevatorDeg, sideslipDeg: lerp('sideslipDeg'), rollRate: lerp('rollRate'), pitchRate: lerp('pitchRate'), yawRate: lerp('yawRate'),
    distance: lerp('distance'), pathLength: lerp('pathLength'), height: lerp('height'), bottomHeight: lerp('bottomHeight'),
    pitch: lerp('pitch'), speed: lerp('speed'), groundSpeed: lerp('groundSpeed'), verticalSpeed: lerp('verticalSpeed'),
    bodyShift: a.bodyShift === undefined ? undefined : lerp('bodyShift'), shift: lerp('shift'), headwind: lerp('headwind'), updraft: lerp('updraft'),
  };
}
