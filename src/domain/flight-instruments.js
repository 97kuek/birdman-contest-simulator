import { CG_HEIGHT } from './aircraft-dynamics.js';
import { LAUNCH, RAMP_LENGTH } from './launch.js';
import { RADIANS_PER_DEGREE } from './units.js';

// Centreline mounts in the model, metres forward/up from its CG. The pitot tip
// follows the rendered mast. The electronics board positions are approximations.
const PITOT_UP = 1.021 - CG_HEIGHT;
const UNDER = { forward: 0.32, up: 0.008 - CG_HEIGHT };
const MAIN = { forward: 0.42, up: 0.15 - CG_HEIGHT };
const AIR = { forward: 0.13, up: 1.019 - CG_HEIGHT };
const PRESSURE_MOUNTS = [UNDER, MAIN, AIR];
const DECK_SLOPE = Math.tan(-LAUNCH.deckDeg * RADIANS_PER_DEGREE);
const STANDING_CG = LAUNCH.edgeHeight + CG_HEIGHT + LAUNCH.deckClearance
  - RAMP_LENGTH * Math.sin(LAUNCH.deckDeg * RADIANS_PER_DEGREE);
const STANDING_PITCH = LAUNCH.pitchDeg * RADIANS_PER_DEGREE;
const PLATFORM_DATUM = 10.6; // 25th_Main1_denso.ino, const_platform_m
const SONAR_LIMIT = 8; // EM_Under_denso.ino returns the sentinel 10 m beyond 8 m.

// Ideal centreline pitot, with axial pressure recovery approximated by projection.
// Pitch-up moves the mast tip aft. Roll/yaw make no axial velocity at a centreline mount.
function pitotSpeed(s, cp, sp) {
  if (s.groundSpeed === undefined) return s.speed;
  const alongHeading = s.groundSpeed * Math.cos((s.track ?? s.heading) - s.heading) + (s.headwind ?? 0);
  const up = (s.verticalSpeed ?? 0) - (s.updraft ?? 0);
  const pitchRate = Number.isFinite(s.pitchRate) ? s.pitchRate : 0;
  return Math.max(0, cp * alongHeading + sp * up - pitchRate * PITOT_UP);
}

// With uniform static air the inferred barometric height change equals the
// mount's geometric rise from the standing calibration pose. Three boards
// share the same deck datum. Their median is used in the saved main sketch.
function pressureAltitude(s, sp, upVertical) {
  const estimates = PRESSURE_MOUNTS.map(({ forward, up }) =>
    PLATFORM_DATUM + (s.height - STANDING_CG) + forward * (sp - Math.sin(STANDING_PITCH))
    + up * (upVertical - Math.cos(STANDING_PITCH)));
  return estimates.sort((a, b) => a - b)[1];
}

function sonarRange(s, onDeck, cp, sp, cb, upVertical) {
  // Intersect a body-down ray with the mean lake surface or the sloped platform.
  const slope = onDeck ? DECK_SLOPE : 0;
  const ch = Math.cos(s.heading ?? 0), sh = Math.sin(s.heading ?? 0);
  const upForward = -sp * cb * ch - Math.sin(s.bank ?? 0) * sh;
  const upNormal = upVertical + slope * upForward;
  if (upNormal <= 0) return null;
  const cgClearance = onDeck ? s.height - LAUNCH.edgeHeight + slope * s.forward : s.height;
  const forwardNormal = sp + slope * cp * ch;
  const range = Math.max(0, (cgClearance + UNDER.forward * forwardNormal) / upNormal + UNDER.up);
  return range <= SONAR_LIMIT ? Math.floor(range * 100 + 1e-9) / 100 : null;
}

function instrumentAudio(silent, airspeed, range) {
  const toneHz = silent ? 0 : airspeed < 9.5 ? 440 : airspeed < 10.8 ? 880 : 1320;
  const intervalSeconds = range === null || range > 1.5 ? 0.9
    : 0.125 + (0.9875 - 0.125) * Math.min(1, range);
  return { toneHz, intervalSeconds };
}

export function readFlightInstruments(sample, aircraftId = 'ryukai') {
  const onDeck = sample.t === undefined;
  const silent = onDeck || sample.bottomHeight <= 1e-8;
  if (aircraftId === 'qx25' || aircraftId === 'ren') {
    // No measured sensor calibration for these aircraft. Show simulated airspeed and lake clearance.
    const altitude = Math.max(0, sample.bottomHeight);
    return { airspeed: sample.speed, altitude, source: 'simulation', ...instrumentAudio(silent, sample.speed, altitude) };
  }
  const cp = Math.cos(sample.pitch), sp = Math.sin(sample.pitch), cb = Math.cos(sample.bank ?? 0);
  const upVertical = cp * cb;
  const airspeed = pitotSpeed(sample, cp, sp);
  const barometricAltitude = pressureAltitude(sample, sp, upVertical);
  const ultrasonicRange = sonarRange(sample, onDeck, cp, sp, cb, upVertical);
  // Height-based interpolation follows the handoff's 0.3–1.5 m transition,
  // without assuming that the saved sketch's filter state was flown at the contest.
  const weight = onDeck || ultrasonicRange === null ? 0
    : Math.min(1, Math.max(0, (1.5 - ultrasonicRange) / 1.2));
  const altitude = Math.max(0, (1 - weight) * barometricAltitude + weight * (ultrasonicRange ?? 0));
  const source = weight === 0 ? 'pressure' : weight === 1 ? 'ultrasonic' : 'blended';
  // Approximate decision boundaries from the 2025 log. The handoff supplies
  // pitch and interval, but does not give as-flown speed thresholds.
  return { airspeed, altitude, barometricAltitude, ultrasonicRange, source, ...instrumentAudio(silent, airspeed, ultrasonicRange) };
}
