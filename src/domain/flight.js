import { aircraftDynamics, releaseState, CG_HEIGHT } from './aircraft-dynamics.js';
import { poweredFlightDynamics } from './powered-flight.js';
import { nextBuoy, practiceBuoys, pedalEffort, riderClimate, riderCriticalPower, propTurnsPerCrank, reserveCapacityJ } from './ren-practice.js';
import { RAD_PER_RPM } from './units.js';
import { aircraftProfile } from './aircraft-profiles.js';
import { advanceElevator, replayElevator } from './elevator.js';
import { aircraftShoreContact } from './shoreline.js';
import { cgShiftFromBody, referenceTiming, resolveOpening } from './pilot-shift.js';
import { rampWingMotion } from './ramp-wing.js';
import { poweredLaunch, SPINUP_SECONDS } from './powered-launch.js';
import { launchProfile } from './launch.js';
import { geometryAt, hullAtControls, landingMeasurement } from './water-contact.js';

export { BASE_DESIGN, QX25_DESIGN, REN_DESIGN, RUDDER_LIMIT_DEG } from './aircraft-profiles.js';
export { referenceTiming } from './pilot-shift.js';
export { CG_HEIGHT } from './aircraft-dynamics.js';
export { LAUNCH, launchProfile, MAX_LAUNCH_HEADING_DEGREES, rampAt, RAMP_LENGTH } from './launch.js';
export { hull2D, WATER_RUNOUT_SECONDS, waterRunoutPose } from './water-contact.js';

export const STEPS_PER_SECOND = 120;
const DT = 1 / STEPS_PER_SECOND;
export const SAMPLES_PER_SECOND = 20;
export const FLIGHT_LIMIT_SECONDS = 120;
const STEPS_PER_SAMPLE = STEPS_PER_SECOND / SAMPLES_PER_SECOND;
// Compensate round-off when a caller requests an exact integration boundary.
const STEP_ROUNDING_TOLERANCE = 1e-9;

// Switches used by the calibration experiments to isolate early-flight assumptions.
export const previousFactors = Object.freeze({ release: false, pilot: false, wind: false });

export function advanceState(state, rates, seconds, elevatorDeg) {
  return {
    ...(state.omega === undefined ? {} : {
      omega: Math.max(0, state.omega + seconds * rates.omega),
      propellerAngle: state.propellerAngle + seconds * rates.propellerAngle,
    }),
    pathLength: state.pathLength + seconds * rates.pathLength, height: state.height + seconds * rates.height,
    u: state.u + seconds * rates.u, w: state.w + seconds * rates.w,
    leftTip: state.leftTip + seconds * rates.leftTip, rightTip: state.rightTip + seconds * rates.rightTip,
    leftTipRate: state.leftTipRate + seconds * rates.leftTipRate, rightTipRate: state.rightTipRate + seconds * rates.rightTipRate,
    elevatorDeg, pitch: state.pitch + seconds * rates.pitch, q: state.q + seconds * rates.q, bodyShift: state.bodyShift + seconds * rates.bodyShift,
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
  contestOpening = true, opening, releaseAttitude, releaseExperiment, rigidWing = false, release = true, pilot = true, wind = true, weather = 'reference', gustOffset = 0, push = 1, coast = 0, direction = 0,
  aircraftId = design.aircraftId ?? 'ryukai', firstLand, platformContact, runway, launch: preparedLaunch, releaseDrive, referenceControl: requestedReference = false, returnSeconds = referenceTiming.returnSeconds, onsetMetres = referenceTiming.onsetMetres,
} = {}) {
  if (!(returnSeconds > 0) || !Number.isFinite(returnSeconds) || !Number.isFinite(onsetMetres)) {
    throw new RangeError('Pilot return time must be positive and timing parameters must be finite.');
  }
  const profile = aircraftProfile(aircraftId);
  // The prescribed course and controller were reconstructed from Tatsumi telemetry.
  const referenceControl = requestedReference && aircraftId === 'ryukai';
  // Keep the reference pilot schedule and launch normal for release probes.
  if (releaseExperiment && (!referenceControl || direction !== 0)) {
    throw new RangeError('Release load experiments require the straight Tatsumi reference flight.');
  }
  design = { ...design };
  const powered = profile.propulsion;
  const base = preparedLaunch ?? launchProfile(push, coast, direction, profile.deckClearance);
  const launch = powered && !preparedLaunch ? poweredLaunch(profile, base, weather, gustOffset) : base;
  releaseDrive ??= launch.driveAt?.(SPINUP_SECONDS + launch.duration);
  const damage = {};
  const { loadsAt, rates, location, prescribedCourse } = powered
    ? poweredFlightDynamics(profile, launch, weather, gustOffset, undefined, damage)
    : aircraftDynamics(design, launch, { aircraftId, opening: resolveOpening(opening), releaseExperiment, rigidWing, pilot, wind, weather, gustOffset, referenceControl, returnSeconds, onsetMetres,
    contestOpening: contestOpening && pilot && aircraftId === 'ryukai' });
  let state = releaseState(launch, release, pilot, profile, releaseAttitude);
  const climate = powered && riderClimate(weather, gustOffset);
  let demand = powered?.power, watts = demand, courseLeg = 0, courseTime = null;
  if (powered) Object.assign(state, { omega: (releaseDrive?.rpm ?? powered.rpm) * RAD_PER_RPM, propellerAngle: releaseDrive?.propellerAngle ?? 0, crankAngle: releaseDrive?.crankAngle ?? 0, reserve: releaseDrive?.reserve ?? reserveCapacityJ });
  const rampWing = rigidWing || powered ? null : rampWingMotion(launch, state, loadsAt, DT);
  if (rampWing) Object.assign(state, rampWing.release);
  if (releaseExperiment?.freeLateral) {
    const { bank = 0, rollRate = 0, lateralVelocity = 0, yawRate = 0 } = releaseExperiment;
    if (![bank, rollRate, lateralVelocity, yawRate].every(Number.isFinite)) throw new RangeError('Release lateral state must be finite.');
    state.bank = bank;
    state.p = rollRate;
    state.v = lateralVelocity;
    state.r = yawRate;
  }
  let loads = loadsAt(state, 0);
  let criticalPower = powered && riderCriticalPower(climate, loads.air.speed);
  let rudderDeg = 0;
  let failure = null, wreckWater = null;
  const shoreContact = aircraftShoreContact(hull, firstLand);
  let origin = 0, step = 0, result = null, disqualified = null;
  const inputs = [], turnInputs = [], powerInputs = [];

  function wingPose(state, loads) {
    if (!loads.structure) return undefined;
    const { leftTwist, rightTwist, leftMoment, rightMoment, utilization } = loads.structure;
    return { leftTip: state.leftTip, rightTip: state.rightTip, leftTwist, rightTwist,
      leftMoment, rightMoment, limitMoment: loads.structure.limitMoment, utilization, failedSide: damage.failure?.side ?? null,
      ...(damage.failure && { foldFraction: Math.min(1, Math.max(0, (origin + step * DT - damage.failure.time) / .25)) }) };
  }

  function contactShape(state, loads) {
    const shape = hullAtControls(hull, rudderDeg, state.elevatorDeg, wingPose(state, loads));
    return geometryAt(state.pitch, shape, state.bank);
  }

  function sample(t, state, loads, shape = contactShape(state, loads)) {
    const { pathLength, height, u, v, w, pitch, bank, bodyShift, elevatorDeg, p, q, r } = state;
    const position = location(state);
    const { heading, right, forward } = position;
    const { speed, headwind, updraft, beta } = loads.air;
    const track = prescribedCourse ? heading : heading + Math.atan2(v, u);
    return {
      t, pathLength, right, forward, gustOffset, heading, track, bank,
      ...(powered && { windTime: t + (launch.windTimeOffset ?? 0), watts, criticalPower, reserve: state.reserve, crankAngle: state.crankAngle, ...(!runway && { courseLeg, courseTime }), rpm: state.omega / RAD_PER_RPM, propellerAngle: state.propellerAngle }),
      distance: powered ? pathLength : Math.hypot(right - launch.edgeRight, forward - launch.edgeForward), height, bottomHeight: state.height + shape.bottom,
      pitch, speed, groundSpeed: Math.hypot(u, v), verticalSpeed: w, pitchRate: q, bodyShift, shift: cgShiftFromBody(bodyShift, profile), headwind, updraft,
      wing: wingPose(state, loads), rudderDeg, elevatorDeg, sideslipDeg: beta, rollRate: p, yawRate: r,
    };
  }

  const samples = [sample(0, state, loads)];
  let clearance = samples[0].bottomHeight;

  function integrate(pilotInput, turnInput) {
    // Fixed-step midpoint integration keeps the trajectory independent of display cadence.
    const t = origin + step * DT;
    if (powered) criticalPower = riderCriticalPower(climate, loads.air.speed);
    const effort = powered && pedalEffort(demand, state.reserve, DT, criticalPower);
    if (powered) watts = effort.watts;
    const halfAngle = advanceElevator(state.elevatorDeg, pilotInput, DT / 2, profile);
    const midpoint = advanceState(state, rates(state, t, pilotInput, turnInput, loads, watts), DT / 2, halfAngle);
    const endAngle = advanceElevator(state.elevatorDeg, pilotInput, DT, profile);
    const next = advanceState(state, rates(midpoint, t + DT / 2, pilotInput, turnInput, undefined, watts), DT, endAngle);
    if (powered) {
      next.reserve = effort.reserve;
      next.crankAngle = state.crankAngle + (watts > 0 ? (next.propellerAngle - state.propellerAngle) / propTurnsPerCrank : 0);
    }
    step++;
    const nextLoads = loadsAt(next, origin + step * DT);
    const nextShape = contactShape(next, nextLoads);
    const nextClearance = next.height + nextShape.bottom;
    // A runway launch starts with wheels exactly on the surface and moving away.
    const touching = runway ? nextClearance < -1e-8 : nextClearance <= 0 || clearance <= 0;
    const surfaceFraction = touching ? (clearance <= 0 ? 0 : clearance / (clearance - nextClearance)) : 1;
    function stateAt(f) {
      if (f === 1) return next;
      const hit = { ...state };
      for (const key of Object.keys(hit)) hit[key] += f * (next[key] - state[key]);
      hit.elevatorDeg = advanceElevator(state.elevatorDeg, pilotInput, f * DT, profile);
      return hit;
    }
    // Compare events on the same substep so a later overload cannot erase a landing.
    const startUse = loads.structure?.utilization ?? 0;
    const endUse = nextLoads.structure?.utilization ?? 0;
    let breakFraction = Infinity;
    if (!damage.failure && startUse >= 1) breakFraction = 0;
    else if (!damage.failure && endUse >= 1) {
      let low = 0, high = 1;
      for (let i = 0; i < 14; i++) {
        const mid = (low + high) / 2;
        const usage = loadsAt(stateAt(mid), t + mid * DT).structure.utilization;
        if (usage >= 1) high = mid;
        else low = mid;
      }
      breakFraction = high;
    }
    const fraction = Math.min(surfaceFraction, breakFraction);
    const hit = stateAt(fraction);
    const hitTime = t + fraction * DT;
    const hitLoads = fraction === 1 ? nextLoads : loadsAt(hit, hitTime);
    if (shoreContact || platformContact || runway) {
      const wheelClearance = powered ? profile.deckClearance + CG_HEIGHT : 0;
      const from = { wheelClearance, ...location(state), height: state.height, pitch: state.pitch, bank: state.bank, wing: wingPose(state, loads) };
      const to = { ...location(hit), height: hit.height, pitch: hit.pitch, bank: hit.bank, wing: wingPose(hit, hitLoads) };
      const shore = shoreContact?.(from, to) ?? Infinity;
      const platform = platformContact?.(from, to) ?? Infinity;
      const exit = runway?.exitFraction(from, to) ?? Infinity;
      const first = Math.min(shore, platform, exit);
      if (first <= 1) {
        const contactTime = t + fraction * first * DT;
        const contactState = stateAt(fraction * first);
        disqualified = sample(contactTime, contactState, loadsAt(contactState, contactTime));
        if (first === exit) disqualified.contactReason = 'off-runway';
        else if (platform <= shore) disqualified.contactReason = 'platform-contact';
        return;
      }
    }
    if (breakFraction < surfaceFraction || (!touching && breakFraction <= 1)) {
      failure = sample(hitTime, hit, hitLoads);
      failure.wing.failedSide = hitLoads.structure.failedSide;
      if (powered) {
        state = hit;
        loads = hitLoads;
        clearance = hit.height + contactShape(hit, hitLoads).bottom;
        origin = hitTime;
        step = 0;
        failure.wing.foldFraction = 0;
      }
      return;
    }
    if (powered && !runway && courseLeg < practiceBuoys.length) {
      courseLeg = nextBuoy(courseLeg, location(hit));
      if (courseLeg === practiceBuoys.length) courseTime = hitTime;
    }
    if (touching) {
      const shape = contactShape(hit, hitLoads);
      hit.height = -shape.bottom;
      const last = sample(hitTime, hit, hitLoads, shape);
      if (runway) {
        Object.assign(last, { contactSide: shape.contactSide, contactAft: shape.contactAft });
        samples.push(last);
        result = { samples, duration: last.t };
        return;
      }
      const { distance, ...positions } = landingMeasurement(last, shape, launch);
      if (firstLand?.(positions.contactRight, positions.contactForward, positions.contactRight, positions.contactForward) != null) {
        disqualified = last;
        return;
      }
      Object.assign(last, { aircraftId, airborneLiftN: (hitLoads.lift ?? hitLoads.wingLift ?? 0) * Math.cos(hit.bank), contactSide: shape.contactSide, contactAft: shape.contactAft });
      if (damage.failure) {
        wreckWater = { samples: [last], duration: last.t, weather };
        return;
      }
      samples.push(last);
      result = { ...positions, aircraftId, weather, gustOffset, launch, design, samples, inputs, turnInputs, duration: last.t, distance: powered ? last.pathLength : distance,
        ...(powered && { powerInputs }) };
      return;
    }
    state = next;
    loads = nextLoads;
    clearance = nextClearance;
    if (!damage.failure && step % STEPS_PER_SAMPLE === 0) samples.push(sample(origin + step * DT, state, loads, nextShape));
  }
  return {
    samples, rampWingAt: rampWing?.at,
    wreckAt(seconds) {
      if (!failure || !powered) return null;
      damage.failure ??= { side: failure.wing.failedSide, time: failure.t };
      demand = 0;
      while (step < Math.floor(Math.min(10, seconds) / DT) && !wreckWater && !disqualified) integrate(0, 0);
      return { sample: disqualified ?? wreckWater?.samples.at(-1) ?? sample(origin + step*DT,state,loads),
        water: wreckWater, blocked: !!disqualified };
    },
    get result() { return result; },
    get failure() { return failure; },
    get disqualified() { return disqualified; },
    get time() { return failure?.t ?? disqualified?.t ?? result?.duration ?? step * DT; },
    current() { return failure ?? disqualified ?? result?.samples.at(-1) ?? sample(step * DT, state, loads); },
    advanceTo(seconds, pilotInput = 0, turnInput = 0, pedalWatts = powered?.power) {
      if (powered && (!Number.isFinite(seconds) || !Number.isFinite(pedalWatts) || pedalWatts < 0 || pedalWatts > powered.power * 2)) {
        throw new RangeError('Powered flight requires finite time and zero to twice design power.');
      }
      const target = Math.floor((powered ? seconds : Math.min(seconds, FLIGHT_LIMIT_SECONDS)) * STEPS_PER_SECOND + STEP_ROUNDING_TOLERANCE);
      if (target <= step || result || disqualified || failure) return;
      const start = step * DT;
      demand = pedalWatts;
      turnInput = Math.max(-1, Math.min(1, turnInput));
      pilotInput = Math.max(-1, Math.min(1, pilotInput));
      const turnDegrees = turnInput * profile.rudderLimitDeg;
      if (turnDegrees !== rudderDeg) {
        rudderDeg = turnDegrees;
        clearance = state.height + contactShape(state, loads).bottom;
      }
      while (step < target && !result && !disqualified && !failure) integrate(pilotInput, turnInput);
      const end = failure?.t ?? disqualified?.t ?? result?.duration ?? step * DT;
      recordCommand(inputs, pilotInput, start, end);
      recordCommand(turnInputs, turnInput, start, end);
      if (powered) {
        const last = powerInputs.at(-1);
        if (last?.watts === demand) last.end = end;
        else powerInputs.push({ start, end, watts: demand });
      }
      if (!powered && !result && !disqualified && !failure && step >= FLIGHT_LIMIT_SECONDS * STEPS_PER_SECOND) {
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
  // The rudder follows the held command; the elevator travels between deflections.
  const profile = aircraftProfile(run.aircraftId);
  const time = Math.max(0, t);
  const held = inputs => inputs?.find(input => input.start <= time && time < input.end)?.direction ?? 0;
  const rudderDeg = held(run.turnInputs) * profile.rudderLimitDeg;
  // Power is a held command. Rotor phase stays unwrapped between samples.
  const power = profile.propulsion && (run.powerInputs?.find(input => input.start <= time && time < input.end)?.watts
    ?? profile.propulsion.power);
  if (t <= 0) return { ...run.samples[0], rudderDeg, ...(profile.propulsion && { watts: run.samples[0].reserve == null ? power : pedalEffort(power, run.samples[0].reserve, DT, run.samples[0].criticalPower).watts }) };
  const i = Math.min(Math.floor(t * SAMPLES_PER_SECOND), run.samples.length - 2);
  const a = run.samples[i], b = run.samples[i + 1], fraction = (t - a.t) / (b.t - a.t);
  const elevatorDeg = replayElevator(a, t, run.inputs ?? [], profile);
  const lerp = key => a[key] + fraction * (b[key] - a[key]);
  return {
    t, gustOffset: run.gustOffset ?? 0, right: lerp('right'), forward: lerp('forward'), heading: lerp('heading'), bank: lerp('bank'), track: lerp('track'),
    ...(profile.propulsion && { windTime: time + (run.launch?.windTimeOffset ?? 0), watts: a.reserve == null ? power : pedalEffort(power, lerp('reserve'), DT, a.criticalPower).watts,
      rpm: lerp('rpm'), propellerAngle: lerp('propellerAngle'),
      ...(a.reserve !== undefined && { reserve: lerp('reserve'), crankAngle: lerp('crankAngle'), courseLeg: a.courseLeg, courseTime: a.courseTime }) }),
    wing: interpolateWing(a.wing, b.wing, fraction),
    rudderDeg, elevatorDeg, sideslipDeg: lerp('sideslipDeg'), rollRate: lerp('rollRate'), pitchRate: lerp('pitchRate'), yawRate: lerp('yawRate'),
    distance: lerp('distance'), pathLength: lerp('pathLength'), height: lerp('height'), bottomHeight: lerp('bottomHeight'),
    pitch: lerp('pitch'), speed: lerp('speed'), groundSpeed: lerp('groundSpeed'), verticalSpeed: lerp('verticalSpeed'),
    bodyShift: a.bodyShift === undefined ? undefined : lerp('bodyShift'), shift: lerp('shift'), headwind: lerp('headwind'), updraft: lerp('updraft'),
  };
}

function interpolateWing(a, b, fraction) {
  if (!a || !b) return undefined;
  const mix = key => a[key] + fraction * (b[key] - a[key]);
  return { leftTip: mix('leftTip'), rightTip: mix('rightTip'), leftTwist: mix('leftTwist'), rightTwist: mix('rightTwist'),
    leftMoment: mix('leftMoment'), rightMoment: mix('rightMoment'), utilization: mix('utilization'), failedSide: null };
}
