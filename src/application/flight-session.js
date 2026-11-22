import {
  CG_HEIGHT,
  LAUNCH,
  MAX_LAUNCH_HEADING_DEGREES,
  RAMP_LENGTH,
  createFlight,
  launchProfile,
  rampAt,
  simulateFlight,
  WATER_RUNOUT_SECONDS,
  waterRunoutPose,
} from '../domain/flight.js';
import { aircraftShoreContact } from '../domain/shoreline.js';
import { aircraftProfile } from '../domain/aircraft-profiles.js';
import { bodyShiftFromCg } from '../domain/pilot-shift.js';
import { RADIANS_PER_DEGREE } from '../domain/units.js';
import { poweredLaunch } from '../domain/powered-launch.js';
import { reserveCapacityJ } from '../domain/ren-practice.js';
import { prelaunchPedalSeconds } from './launch-sequence.js';
import { WEATHER, windAt } from '../domain/weather.js';

const replayLimit = 3;
const parkedDrive = { rpm: 0, watts: 0, reserve: reserveCapacityJ, propellerAngle: 0, crankAngle: 0 };

export function rampSample(launch, weather, elapsed, gustOffset, profile, drive) {
  const ramp = rampAt(launch, elapsed);
  const remaining = (launch.length ?? RAMP_LENGTH) - ramp.travel;
  const right = launch.edgeRight + (profile.releaseWheelAft ?? 0) * Math.sin(launch.heading) - remaining * launch.rightStep;
  const forward = launch.edgeForward + (profile.releaseWheelAft ?? 0) * Math.cos(launch.heading) - remaining * launch.forwardStep;
  const windTime = elapsed - launch.duration + (launch.windTimeOffset ?? 0);
  const bottomHeight = launch.edgeHeight + launch.deckClearance + remaining * launch.dropStep;
  const height = bottomHeight + CG_HEIGHT;
  const wind = windAt(weather, { right, forward, height, gustOffset }, windTime);
  return {
    ...drive,
    wing: { leftTip: 0, rightTip: 0, leftTwist: 0, rightTwist: 0 },
    bottomHeight, height,
    right, forward, windTime, gustOffset,
    heading: launch.heading,
    rampTravel: ramp.travel,
    shift: profile.releaseCgShift, bodyShift: bodyShiftFromCg(profile.releaseCgShift, profile), elevatorDeg: 0, rudderDeg: 0,
    track: launch.heading,
    groundSpeed: ramp.speed * Math.hypot(launch.forwardStep, launch.rightStep),
    verticalSpeed: -ramp.speed * launch.dropStep,
    headwind: wind.headwind * Math.cos(launch.heading) + (wind.crosswind ?? 0) * Math.sin(launch.heading),
    updraft: wind.updraft ?? 0,
    pitch: LAUNCH.pitchDeg * RADIANS_PER_DEGREE,
    speed: Math.hypot(
      ramp.speed * launch.forwardStep + wind.headwind,
      ramp.speed * launch.rightStep + (wind.crosswind ?? 0),
      -ramp.speed * launch.dropStep - (wind.updraft ?? 0),
    ),
  };
}

// One browser session. A trial keeps the launch conditions it started with.
export class FlightSession {
  #history = new Map();
  #replays = new Map();
  #baseline = null;
  #attemptNumber = 0;

  #gustOffset = 0;
  #drawWindOffset;
  #firstLand;
  #platformContact;
  #profile;
  #baseLaunch;
  #poweredLaunch;

  get launch() { return this.#poweredLaunch ?? this.#baseLaunch; }

  resolveLaunch() {
    if (this.#profile.propulsion) this.#poweredLaunch ??= poweredLaunch(this.#profile, this.#baseLaunch, this.weather, this.#gustOffset);
    return this.launch;
  }
  #shoreContact;
  #runoutLimits = new WeakMap();
  #prepared = false;
  #runReferences = new WeakMap();

  constructor(hull, weather, drawWindOffset = () => 0, firstLand, aircraftId = 'ryukai', platformContact) {
    this.#profile = aircraftProfile(aircraftId);
    this.aircraftId = aircraftId;
    this.#firstLand = firstLand;
    this.#platformContact = platformContact;
    this.#shoreContact = aircraftShoreContact(hull, firstLand);
    this.#drawWindOffset = drawWindOffset;
    this.hull = hull;
    this.select(weather, 0);
  }

  select(weather, direction = this.launch.direction) {
    const heading = Math.max(-MAX_LAUNCH_HEADING_DEGREES, Math.min(MAX_LAUNCH_HEADING_DEGREES, direction));
    if (weather !== this.weather) {
      this.#prepared = false;
      this.#gustOffset = 0;
    }
    this.weather = weather;
    this.#poweredLaunch = null;
    this.#baseLaunch = Object.freeze(launchProfile(1, 0, heading, this.#profile.deckClearance));
    this.#baseline = null;
  }

  get conditionKey() {
    return this.weather + '/' + this.launch.direction;
  }

  get latest() {
    const key = this.conditionKey;
    const entry = this.#history.get(key);
    return entry && { ...entry, run: this.#replays.get(key) };
  }

  get options() {
    const { push, coast, direction } = this.launch;
    return { aircraftId: this.aircraftId, weather: this.weather, gustOffset: this.#gustOffset, push, coast, direction };
  }

  get reference() {
    if (this.#profile.propulsion) return null; // A powered trim flight need not land.
    return (this.#baseline ??= simulateFlight(this.#profile.design, this.hull, this.options));
  }

  referenceFor(run) {
    if (aircraftProfile(run.aircraftId).propulsion) return null;
    if (!this.#runReferences.has(run)) {
      const { push, coast, direction } = run.launch;
      const reference = simulateFlight(run.design, this.hull, { aircraftId: run.aircraftId, weather: run.weather, gustOffset: run.gustOffset ?? 0,
        push, coast, direction });
      this.#runReferences.set(run, reference);
    }
    return this.#runReferences.get(run);
  }

  // Draw before aiming so the pilot can examine the wind before choosing a heading.
  prepareAttempt() {
    this.#gustOffset = WEATHER[this.weather].field ? this.#drawWindOffset() : 0;
    this.#poweredLaunch = null;
    this.#prepared = true;
    this.#baseline = null;
  }

  get onDeck() {
    if (!this.#profile.propulsion) return this.onDeckAt(0);
    const base = this.#baseLaunch;
    // Powered ground-roll wind uses GO as time zero, including while aiming.
    const preview = { ...base, windTimeOffset: base.duration };
    return rampSample(preview, this.weather, 0, this.#gustOffset, this.#profile, parkedDrive);
  }

  onDeckAt(spinSeconds) {
    const drive = this.resolveLaunch().driveAt?.(spinSeconds);
    return rampSample(this.launch, this.weather, 0, this.#gustOffset, this.#profile, drive);
  }

  startAttempt() {
    if (!this.#prepared) this.prepareAttempt();
    this.#prepared = false;
    const launch = this.resolveLaunch();
    const weather = this.weather;
    const key = this.conditionKey;
    const options = this.options;
    const profile = this.#profile;
    const driveAt = elapsed => launch.driveAt?.(prelaunchPedalSeconds + elapsed);
    const flight = createFlight(profile.design, this.hull, { ...options, launch, firstLand: this.#firstLand, platformContact: this.#platformContact, releaseDrive: driveAt(launch.duration) });
    const platformContact = this.#platformContact;
    const rampPose = t => ({ ...rampSample(launch, weather, t, options.gustOffset, profile, driveAt(t)), wing: flight.rampWingAt?.(t) });
    let previousRamp = rampPose(0), rampHit;
    const number = ++this.#attemptNumber;
    const remember = (run) => {
      if ((this.#history.get(key)?.number ?? 0) >= number) return;
      const { aircraftId, weather, distance, duration } = run;
      const summary = { aircraftId, weather, distance, duration, courseTime: run.samples.at(-1).courseTime };
      this.#history.set(key, { number, summary });
      this.#replays.delete(key);
      this.#replays.set(key, run);
      if (this.#replays.size > replayLimit) this.#replays.delete(this.#replays.keys().next().value);
    };
    return {
      number,
      wreckAt: flight.wreckAt,
      samples: flight.samples,
      // Time starts with the GO cue. The solver and recorded inputs start at release.
      advance(elapsed, pitchInput, rudder, watts) {
        const airTime = elapsed - launch.duration;
        if (previousRamp) {
          const t = Math.min(launch.duration, elapsed), nextRamp = rampPose(t);
          // Prescribed ramp motion follows a straight incline, with a nonlinear
          // time-to-distance mapping during acceleration.
          const fraction = platformContact?.(previousRamp, nextRamp);
          if (fraction != null && !rampHit) {
            const travel = previousRamp.rampTravel + (nextRamp.rampTravel - previousRamp.rampTravel) * fraction;
            let low = 0, high = t;
            for (let i = 0; i < 18; i++) {
              const mid = (low + high) / 2;
              if (rampAt(launch, mid).travel < travel) low = mid;
              else high = mid;
            }
            rampHit = { ...rampPose(high), t: 0 };
          }
          if (rampHit) return { phase: 'platform-contact', sample: rampHit };
          if (airTime < 0) {
            previousRamp = nextRamp;
            return { phase: elapsed < launch.handoffTime ? 'push' : 'handoff', sample: nextRamp };
          }
          previousRamp = null;
        }
        flight.advanceTo(airTime, pitchInput, rudder, watts);
        if (flight.failure) return { phase: 'structural-failure', sample: flight.failure };
        if (flight.disqualified) return { phase: flight.disqualified.contactReason ?? 'disqualified', sample: flight.disqualified };
        if (flight.result) {
          remember(flight.result);
          return { phase: 'touchdown', run: flight.result };
        }
        return { phase: airTime < 1 ? 'release' : 'glide', sample: flight.current() };
      },
    };
  }

  shoreAhead(sample) {
    if (!this.#shoreContact) return false;
    // Project the ground track, including sideslip. The same hull and shoreline
    // decide actual entry, but the prediction never changes the flight result.
    const lookaheadSeconds = 6;
    const travel = sample.groundSpeed * lookaheadSeconds;
    return this.#shoreContact(sample, {
      ...sample,
      right: sample.right + travel * Math.sin(sample.track),
      forward: sample.forward + travel * Math.cos(sample.track),
    }) !== null;
  }

  waterPose(run, seconds) {
    const contact = run.samples.at(-1);
    const poseAt = time => waterRunoutPose(contact, time, this.hull, run.weather);
    if ((!this.#shoreContact && !this.#platformContact) || seconds <= 0) return poseAt(seconds);
    const blocked = (a, b) => this.#shoreContact?.(a, b) != null || this.#platformContact?.(a, b) != null;
    if (!this.#runoutLimits.has(run)) {
      // The contact is already scored. Stop the visual drift before its first
      // shore crossing and use the same limit when seeking directly in replay.
      let safeTime = WATER_RUNOUT_SECONDS, previous = contact;
      const frames = WATER_RUNOUT_SECONDS * 20;
      for (let frame = 1; frame <= frames; frame++) {
        const time = frame / 20;
        const next = poseAt(time);
        if (blocked(previous, next)) {
          let low = (frame - 1) / 20, high = time;
          for (let i = 0; i < 12; i++) {
            const mid = (low + high) / 2;
            if (!blocked(previous, poseAt(mid))) low = mid;
            else high = mid;
          }
          safeTime = low;
          break;
        }
        previous = next;
      }
      this.#runoutLimits.set(run, safeTime);
    }
    const limit = this.#runoutLimits.get(run);
    if (seconds <= limit || limit === WATER_RUNOUT_SECONDS) return poseAt(seconds);
    return { ...poseAt(limit), groundSpeed: 0, verticalSpeed: 0, rollRate: 0, pitchRate: 0, yawRate: 0 };
  }
}
