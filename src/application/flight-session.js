import {
  BASE_DESIGN,
  CG_HEIGHT,
  LAUNCH,
  MAX_LAUNCH_HEADING_DEGREES,
  RAMP_LENGTH,
  createFlight,
  launchProfile,
  rampAt,
  simulateFlight,
  waterRunoutPose,
} from '../domain/flight.js';
import { PILOT_SHIFT } from '../domain/pilot-shift.js';
import { RADIANS_PER_DEGREE } from '../domain/units.js';
import { WEATHER, windAt } from '../domain/weather.js';

function rampSample(launch, weather, elapsed, gustOffset) {
  const ramp = rampAt(launch, elapsed);
  const remaining = RAMP_LENGTH - ramp.travel;
  const right = launch.edgeRight - remaining * launch.rightStep;
  const forward = launch.edgeForward - remaining * launch.forwardStep;
  const windTime = elapsed - launch.duration;
  const bottomHeight = launch.edgeHeight + LAUNCH.deckClearance + remaining * launch.dropStep;
  const height = bottomHeight + CG_HEIGHT;
  const wind = windAt(weather, { right, forward, height, gustOffset }, windTime);
  return {
    bottomHeight, height,
    right, forward, windTime, gustOffset,
    heading: launch.heading,
    rampTravel: ramp.travel,
    shift: PILOT_SHIFT.releaseCgShift,
    track: launch.heading,
    groundSpeed: ramp.speed * Math.hypot(launch.forwardStep, launch.rightStep),
    verticalSpeed: -ramp.speed * launch.dropStep,
    headwind: wind.headwind * Math.cos(launch.heading) + (wind.crosswind ?? 0) * Math.sin(launch.heading),
    updraft: wind.updraft ?? 0,
    pitch: LAUNCH.pitchDeg * RADIANS_PER_DEGREE,
    speed: Math.hypot(
      ramp.speed * Math.cos(launch.heading) + wind.headwind,
      ramp.speed * Math.sin(launch.heading) + (wind.crosswind ?? 0),
    ),
  };
}

// One browser session. A trial keeps the launch conditions it started with.
export class FlightSession {
  #history = new Map();
  #baseline = null;
  #attemptNumber = 0;

  #gustOffset = 0;
  #drawWindOffset;
  #prepared = false;
  #runReferences = new WeakMap();

  constructor(hull, weather, drawWindOffset = () => 0) {
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
    this.launch = Object.freeze(launchProfile(1, 0, heading));
    this.#baseline = null;
  }

  get conditionKey() {
    return this.weather + '/' + this.launch.direction;
  }

  get latest() {
    return this.#history.get(this.conditionKey);
  }

  get options() {
    const { push, coast, direction } = this.launch;
    return { weather: this.weather, gustOffset: this.#gustOffset, push, coast, direction };
  }

  get reference() {
    return (this.#baseline ??= simulateFlight(BASE_DESIGN, this.hull, this.options));
  }

  referenceFor(run) {
    if (!this.#runReferences.has(run)) {
      const { push, coast, direction } = run.launch;
      const reference = simulateFlight(run.design, this.hull, { weather: run.weather, gustOffset: run.gustOffset ?? 0,
        push, coast, direction });
      this.#runReferences.set(run, reference);
    }
    return this.#runReferences.get(run);
  }

  // Draw before aiming so the pilot can examine the wind before choosing a heading.
  prepareAttempt() {
    this.#gustOffset = WEATHER[this.weather].field ? this.#drawWindOffset() : 0;
    this.#prepared = true;
    this.#baseline = null;
  }

  get onDeck() {
    return rampSample(this.launch, this.weather, 0, this.options.gustOffset);
  }

  startAttempt() {
    if (!this.#prepared) this.prepareAttempt();
    this.#prepared = false;
    const launch = this.launch;
    const weather = this.weather;
    const key = this.conditionKey;
    const options = this.options;
    const flight = createFlight(BASE_DESIGN, this.hull, options);
    const number = ++this.#attemptNumber;
    const remember = (run) => {
      if ((this.#history.get(key)?.number ?? 0) < number) this.#history.set(key, { run, number });
    };
    return {
      number,
      samples: flight.samples,
      // Time starts with the GO cue. The solver and recorded inputs start at release.
      advance(elapsed, weightShift, rudder) {
        const airTime = elapsed - launch.duration;
        if (airTime < 0) {
          return {
            phase: elapsed < launch.handoffTime ? 'push' : 'handoff',
            sample: rampSample(launch, weather, elapsed, options.gustOffset),
          };
        }
        flight.advanceTo(airTime, weightShift, rudder);
        if (flight.result) {
          remember(flight.result);
          return { phase: 'touchdown', run: flight.result };
        }
        return { phase: airTime < 1 ? 'release' : 'glide', sample: flight.current() };
      },
    };
  }

  waterPose(run, seconds) {
    const contact = run.samples.at(-1);
    return waterRunoutPose(contact, seconds, this.hull, run.weather);
  }
}
