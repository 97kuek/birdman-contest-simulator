import { WATER_RUNOUT_SECONDS } from '../domain/water-contact.js';

// Kinematic estimates for the camera boat. Coordinates are metres right/forward of the platform.
const STATION = Object.freeze({ right: -22, forward: 92, heading: 0, speed: 0, turn: 0 });
const MAX_SPEED = 12, ACCELERATION = 1.5, BRAKING = 2;
const TURN_LIMIT = Math.PI / 8, LATERAL_ACCELERATION = 2.4;
const ABEAM = 25, ASTERN = 13, RESPONSE_SECONDS = 3;
const HULL_MARGIN = 3.3;
const hullOffsets = [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];
const clamp = (x, low, high) => Math.min(high, Math.max(low, x));

function clearFraction(state, dx, dy, firstLand) {
  if (!firstLand) return 1;
  const travel = Math.hypot(dx, dy);
  if (!travel) return 1;
  let safe = 1;
  for (const [ix, iy] of hullOffsets) {
    const x = state.right + ix * HULL_MARGIN, y = state.forward + iy * HULL_MARGIN;
    const hit = firstLand(x, y, x + dx, y + dy);
    if (hit != null) safe = Math.min(safe, Math.max(0, hit - .001 / travel));
  }
  return safe;
}

function move(state, heading, speed, travel, turn, firstLand) {
  const mid = (heading + state.heading) / 2;
  const dx = Math.sin(mid) * travel, dy = Math.cos(mid) * travel;
  const safe = clearFraction(state, dx, dy, firstLand);
  return { right: state.right + dx * safe, forward: state.forward + dy * safe,
    heading, speed: safe < 1 ? 0 : speed, turn };
}

function follow(state, plane, dt, side, firstLand) {
  const sin = Math.sin(plane.track), cos = Math.cos(plane.track);
  const dx = plane.right - state.right, dy = plane.forward - state.forward;
  // Let the aircraft catch the waiting boat, then match its ground velocity.
  if (state.speed === 0 && dx * sin + dy * cos < -42) return state;
  const along = Math.max(1, plane.groundSpeed + (dx * sin + dy * cos - ASTERN) / RESPONSE_SECONDS);
  const across = (dx * cos - dy * sin + side * ABEAM) / RESPONSE_SECONDS;
  const vx = along * sin + across * cos, vy = along * cos - across * sin;
  let bearing = Math.atan2(vx, vy);
  const ahead = 7 + state.speed ** 2 / (2 * BRAKING);
  const clear = angle => clearFraction(state, ahead * Math.sin(angle), ahead * Math.cos(angle), firstLand) === 1;
  if (firstLand && !clear(bearing)) {
    // Choose the nearest open course, preferring the side the bow already faces.
    const side = Math.sin(state.heading - bearing) < 0 ? -1 : 1;
    for (const offset of [30, -30, 60, -60, 90, -90, 135, -135, 180]) {
      const alternative = bearing + side * offset * Math.PI / 180;
      if (clear(alternative)) { bearing = alternative; break; }
    }
  }
  const error = Math.atan2(Math.sin(bearing - state.heading), Math.cos(bearing - state.heading));
  const desired = Math.min(MAX_SPEED, Math.hypot(vx, vy)) * clamp(Math.cos(error), .18, 1);
  const speed = state.speed + clamp(desired - state.speed, -BRAKING * dt, ACCELERATION * dt);
  const maxTurn = Math.min(TURN_LIMIT, LATERAL_ACCELERATION / Math.max(1, speed)) * clamp(speed, .45, 1);
  const turn = clamp(error / dt, -maxTurn, maxTurn);
  return move(state, state.heading + turn * dt, speed, (state.speed + speed) * dt / 2, turn, firstLand);
}

export function createChaseCourse() {
  let route, states = [], side = -1;
  return function positionAt(samples, time, firstLand, stopTime = Infinity) {
    if (!samples?.length || time < 0) return STATION;
    if (samples !== route) {
      route = samples;
      states = [STATION];
      const start = samples[0];
      side = (STATION.right - start.right) * Math.cos(start.track) -
        (STATION.forward - start.forward) * Math.sin(start.track) > 0 ? 1 : -1;
    }
    const until = Math.min(time, stopTime);
    let lo = 0, hi = samples.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (samples[mid].t <= until) lo = mid;
      else hi = mid;
    }
    for (let i = states.length; i <= lo; i++) {
      states.push(follow(states[i - 1], samples[i - 1], samples[i].t - samples[i - 1].t, side, firstLand));
    }
    let state = states[lo];
    if (until > samples[lo].t) state = follow(state, samples[lo], until - samples[lo].t, side, firstLand);
    if (time <= stopTime) return state;
    const deceleration = Math.max(BRAKING, state.speed / WATER_RUNOUT_SECONDS);
    const coast = Math.min(time - stopTime, state.speed / deceleration);
    const speed = Math.max(0, state.speed - deceleration * coast);
    return move(state, state.heading, speed, (state.speed + speed) * coast / 2, 0, firstLand);
  };
}
