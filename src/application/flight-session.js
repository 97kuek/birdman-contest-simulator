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
import { RADIANS_PER_DEGREE } from '../domain/units.js';
import { windAt } from '../domain/weather.js';

// One browser session. A trial keeps the launch conditions it started with.
export class FlightSession {
  #history = new Map();
  #baseline = null;
  #attemptNumber = 0;

  constructor(hull, weather) {
    this.hull = hull;
    this.select(weather, 0);
  }

  select(weather, direction = this.launch.direction) {
    const heading = Math.max(-MAX_LAUNCH_HEADING_DEGREES, Math.min(MAX_LAUNCH_HEADING_DEGREES, direction));
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
    return { weather: this.weather, push, coast, direction };
  }

  get reference() {
    return (this.#baseline ??= simulateFlight(BASE_DESIGN, this.hull, this.options));
  }

  startAttempt() {
    const launch = this.launch;
    const weather = this.weather;
    const key = this.conditionKey;
    const flight = createFlight(BASE_DESIGN, this.hull, this.options);
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
          const ramp = rampAt(launch, elapsed);
          const remaining = RAMP_LENGTH - ramp.travel;
          const wind = windAt(weather, 0, 0);
          return {
            phase: elapsed < launch.handoffTime ? 'push' : 'handoff',
            sample: {
              height: launch.edgeHeight + LAUNCH.deckClearance + CG_HEIGHT + remaining * launch.dropStep,
              right: launch.edgeRight - remaining * launch.rightStep,
              forward: launch.edgeForward - remaining * launch.forwardStep,
              heading: launch.heading,
              pitch: LAUNCH.pitchDeg * RADIANS_PER_DEGREE,
              speed: Math.hypot(
                ramp.speed * Math.cos(launch.heading) + wind.headwind,
                ramp.speed * Math.sin(launch.heading) + (wind.crosswind ?? 0),
              ),
            },
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
    const wind = windAt(run.weather, contact.pathLength, contact.t);
    return waterRunoutPose(contact, seconds, this.hull, wind);
  }
}
