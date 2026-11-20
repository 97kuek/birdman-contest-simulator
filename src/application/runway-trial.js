import { aircraftProfile } from '../domain/aircraft-profiles.js';
import { createFlight, STEPS_PER_SECOND } from '../domain/flight.js';
import { poweredGroundRoll, SPINUP_SECONDS } from '../domain/powered-launch.js';
import { propTurnsPerCrank, reserveCapacityJ } from '../domain/ren-practice.js';
import { GRAVITY, RAD_PER_RPM } from '../domain/units.js';
import { isOnPavement, runwayLength as length, runwayHalfWidth as halfWidth } from '../domain/runway-support.js';
import { createRunwayDeparture } from '../domain/runway-departure.js';
import { createLandingRoll } from '../domain/runway-rollout.js';
import { rampSample } from './flight-session.js';

const profile = aircraftProfile('ren');
const stepSeconds = 1 / STEPS_PER_SECOND;
const startForward = 38;
// Playable grass verge beyond the surveyed pavement, in metres.
const verge = 8;
// Nose and rear wheel stations, measured aft of the CG on the 聯 model.
const wheelStations = [-1.04, profile.releaseWheelAft];
// Combined push from the starters. The force and hand-off limits are
// assumptions, documented separately from the field footage.
const starterPeakN = 120;
const releaseSeconds = 5.5, releaseTravel = 18, releaseSpeed = 6;

function starterForce(s) {
  const margin = Math.min(1, s.t / .45, releaseSeconds - s.t, (releaseTravel - s.travel) / 2, releaseSpeed - s.speed);
  return starterPeakN * Math.max(0, margin);
}

// The centre of the running gear defines the lane. The 32.2 m wing is wider
// than the paved strip even when the aircraft is on the centreline.
function exitFraction(from, to) {
  let fraction = Infinity;
  for (const [key, low, high] of [['forward', -verge, length + verge], ['right', -halfWidth - verge, halfWidth + verge]]) {
    if (to[key] < low || to[key] > high) {
      const edge = to[key] < low ? low : high;
      fraction = Math.min(fraction, (edge - from[key]) / (to[key] - from[key]));
    }
  }
  return fraction;
}

// With zero remaining deck length the reference point is the start of a
// level track, so positive wheel travel advances from that point.
function levelTrack(right, forward, heading) {
  return { edgeRight: right - profile.releaseWheelAft * Math.sin(heading),
    edgeForward: forward - profile.releaseWheelAft * Math.cos(heading), edgeHeight: 0,
    heading, rightStep: Math.sin(heading), forwardStep: Math.cos(heading), dropStep: 0,
    deckClearance: profile.deckClearance, length: 0, pushed: 0, push: 0,
    duration: 0, windTimeOffset: 0, speed: 0 };
}

export function createRunwayTrial(hull, weather = 'calm', gustOffset = 0, { preSpin = false } = {}) {
  let track = levelTrack(0, startForward, 0);
  let rolling = poweredGroundRoll(profile, track, weather, gustOffset);
  let state = { t: 0, speed: 0, travel: 0, omega: 0, angle: 0, reserve: reserveCapacityJ, watts: 0 };
  let phase = 'roll', reason, duration = null, flight, touchdown, landingRoll, crankAngle = 0, takeoffTravel;
  const departure = createRunwayDeparture(profile, wheelStations);
  let starterReleasedAt = null, starterReleaseForward = null;
  function starterStatus() {
    const starterAttached = starterReleasedAt === null;
    return { starterAttached, starterReleasedAt, starterReleaseForward,
      liftOffAt: departure.liftOff ? duration + departure.liftOff.seconds : null,
      liftOffForward: departure.liftOff ? startForward + takeoffTravel + departure.liftOff.forwardTravel : null,
      starterForceN: starterAttached ? starterForce(state) : 0 };
  }
  function releaseStarters() {
    if (starterReleasedAt !== null) return;
    starterReleasedAt = state.t;
    starterReleaseForward = startForward + state.travel;
  }
  function groundPose() {
    const drive = { rpm: state.omega / RAD_PER_RPM, watts: state.watts,
      reserve: state.reserve, propellerAngle: state.angle, crankAngle };
    const pose = rampSample({ ...track, rampSampleAt: () => state }, weather, state.t, gustOffset, profile, drive);
    const wheelLoad = Math.max(0, (state.wheelSupport ?? profile.mass * GRAVITY) / (profile.mass * GRAVITY));
    return { ...pose, ...starterStatus(), wheelLoad, t: state.t, bank: 0, bottomHeight: 0, pathLength: state.travel, distance: state.travel };
  }
  const onGround = groundPose();
  const held = [{ ...state, t: -SPINUP_SECONDS }];
  if (preSpin) {
    const steps = Math.round(SPINUP_SECONDS / stepSeconds);
    for (let i = 0; i < steps; i++) held.push(rolling.advance(held.at(-1), stepSeconds, 300, true));
    state = { ...held.at(-1), t: 0 };
    crankAngle = state.angle / propTurnsPerCrank;
  }
  let sample = groundPose();

  function onGroundAt(spinSeconds) {
    if (!preSpin || spinSeconds <= 0) return onGround;
    const index = spinSeconds >= SPINUP_SECONDS ? held.length - 1 : spinSeconds / stepSeconds;
    const low = Math.floor(index), a = held[low], b = held[Math.min(low + 1, held.length - 1)];
    const interpolate = key => a[key] + (index - low) * (b[key] - a[key]);
    const angle = interpolate('angle');
    return { ...onGround, rpm: interpolate('omega') / RAD_PER_RPM, reserve: interpolate('reserve'),
      watts: 300, propellerAngle: angle, crankAngle: angle / propTurnsPerCrank };
  }

  function abort(cause) {
    phase = 'aborted';
    reason = cause;
  }

  // Stop at the first boundary crossing even when drawing skips many steps.
  function advanceWheels(watts) {
    // Apply half the crew impulse before and after the normal wheel/propeller
    // integration so changing thrust also changes distance in the same step.
    const assists = phase === 'roll' && starterReleasedAt === null;
    const halfStepPerMass = stepSeconds / (2 * profile.propulsion.mass);
    const pushed = assists ? { ...state, speed: state.speed + starterForce(state) * halfStepPerMass } : state;
    const next = rolling.advance(pushed, stepSeconds, watts, false, (sample.catcherBrakeN ?? 0) + (sample.tipDragN ?? 0));
    if (assists) next.speed += starterForce(next) * halfStepPerMass;
    const distance = next.travel - state.travel;
    const direction = phase === 'rollout' ? sample.track : track.heading;
    const df = distance * Math.cos(direction), dx = distance * Math.sin(direction);
    const from = sample;
    const end = { forward: from.forward + df, right: from.right + dx };
    const fraction = exitFraction(sample, end);
    if (fraction <= 1) {
      for (const key of ['travel', 't', 'angle', 'speed', 'omega', 'reserve'])
        next[key] = state[key] + fraction * (next[key] - state[key]);
    }
    if (next.watts > 0) crankAngle += (next.angle - state.angle) / propTurnsPerCrank;
    state = next;
    if (assists && (state.t >= releaseSeconds - 1e-9 || state.travel >= releaseTravel || state.speed >= releaseSpeed))
      releaseStarters();
    sample = groundPose();
    sample.forward = from.forward + df * Math.min(1, fraction);
    sample.right = from.right + dx * Math.min(1, fraction);
    if (fraction <= 1) abort('off-runway');
  }

  function rollStep(watts) {
    advanceWheels(watts);
    if (phase === 'aborted') return;
    const { support, pitchAcceleration } = rolling.forces(state, state.watts);
    const upward = -support / profile.propulsion.mass;
    // The last wheel unloads when each contact can accelerate upwards.
    if (wheelStations.some(aft => upward - aft * pitchAcceleration <= 0)) return;
    releaseStarters();
    duration = state.t;
    takeoffTravel = state.travel;
    const launch = { ...levelTrack(sample.right, sample.forward, 0), speed: state.speed, windTimeOffset: duration };
    flight = createFlight(profile.design, hull, { weather, gustOffset, launch, releaseDrive: sample, runway: { exitFraction, departure } });
    phase = 'flight';
  }

  function beginRollout() {
    touchdown = sample;
    // Large lateral contacts belong to a wing rather than the wheels.
    if (Math.abs(sample.contactSide) <= .5 && Math.abs(sample.contactAft) > 1.5) {
      abort('ground-strike');
      return;
    }
    phase = 'rollout';
    landingRoll = createLandingRoll(hull, touchdown, weather, gustOffset);
    sample = { ...touchdown };
    landingRoll(sample, 0);
    track = levelTrack(sample.right, sample.forward, sample.track);
    rolling = poweredGroundRoll(profile, track, weather, gustOffset);
    state = { t: sample.t, speed: sample.groundSpeed, travel: 0,
      omega: sample.rpm * RAD_PER_RPM, angle: sample.propellerAngle, reserve: sample.reserve, watts: 0 };
    crankAngle = sample.crankAngle;
  }

  function rolloutStep() {
    // Pedalling ceases on contact. As lift decays, the wheels carry more
    // weight, increasing rolling resistance in the same force law as takeoff.
    const before = state.t;
    advanceWheels(0);
    sample.pathLength += touchdown.pathLength;
    sample.distance = sample.pathLength;
    const stopped = landingRoll(sample, state.t - before);
    if (phase === 'rollout' && stopped) phase = 'landed';
  }

  return {
    onGround, onGroundAt,
    get duration() { return duration; },
    advance(elapsed, pitch = 0, rudder = 0, watts = 300) {
      if (![elapsed, pitch, rudder, watts].every(Number.isFinite) || elapsed < 0 || watts < 0 || watts > 2 * profile.propulsion.power)
        throw new RangeError('Invalid runway trial time or control input.');
      while (phase === 'roll' && state.t + stepSeconds <= elapsed + 1e-9) rollStep(watts);
      if (phase === 'flight') {
        flight.advanceTo(elapsed - duration, pitch, rudder, watts);
        const air = flight.current();
        sample = { ...air, ...starterStatus(), t: duration + air.t, pathLength: takeoffTravel + air.pathLength, distance: takeoffTravel + air.pathLength };
        if (flight.disqualified) abort('off-runway');
        else if (flight.failure) abort('structural-failure');
        else if (flight.result) beginRollout();
      }
      while (phase === 'rollout' && state.t + stepSeconds <= elapsed + 1e-9) rolloutStep();
      const visiblePhase = phase === 'flight' && !departure.liftOff ? 'roll' : phase;
      return { phase: visiblePhase, sample, ...(phase === 'landed' && { onPavement: isOnPavement(sample.right, sample.forward) }), ...(reason && { reason }) };
    },
  };
}
