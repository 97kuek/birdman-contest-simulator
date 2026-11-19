import { aircraftProfile } from './aircraft-profiles.js';

const ryukai = aircraftProfile();

// Tatsumi's published empty/gross masses are 48/100 kg. Of the remaining
// 52 kg we model 4 kg of equipment and grip-supported mass as stationary.
// The effective moving mass and the cabin travel are simulation assumptions.
export const PILOT_SHIFT = Object.freeze({
  emptyMass: ryukai.emptyMass, fixedPayloadMass: 4, releaseCgShift: ryukai.releaseCgShift,
  maxBodyTravel: 0.10, maxBodyRate: 0.30,
});
function movingMassFraction(profile) {
  return (profile.mass - profile.emptyMass - PILOT_SHIFT.fixedPayloadMass) / profile.mass;
}

// Metres along the aircraft, aft positive. Replay samples store the combined CG.
export const cgShiftFromBody = (bodyShift, profile = ryukai) => bodyShift * movingMassFraction(profile);
export const bodyShiftFromCg = (cgShift, profile = ryukai) => cgShift / movingMassFraction(profile);
export const limitBodyShift = metres => Math.max(-PILOT_SHIFT.maxBodyTravel, Math.min(PILOT_SHIFT.maxBodyTravel, metres));

// Inferred input for the 2025 reference flight. Times are seconds from release.
// The target moves through the same travel and rate limits as a player's input.
export const TATSUMI_PULLUP = Object.freeze({ holdUntil: 0.5, easeAt: 2.5, resumeTrimAt: 4.4, activeResponseSeconds: 0.2 });

export function launchBodyTarget(time, input, opening = TATSUMI_PULLUP) {
  const rest = time < opening.holdUntil ? bodyShiftFromCg(ryukai.releaseCgShift) : 0;
  // A full command can reach either stop even while the neutral stance is forward.
  return (1 - Math.abs(input)) * rest + input * PILOT_SHIFT.maxBodyTravel;
}

export const referenceTiming = Object.freeze({ returnSeconds: 0.45, onsetMetres: 0 });
const PILOT = Object.freeze({
  engagementMetres: 40, previousEngagementMetres: 65, earlyReturnMetres: 40,
  landingSpeed: 7.9, cruiseSpeedIncrement: 1.95, approachHeight: 2, flareHeight: 1.6,
  speedGain: 0.03, climbGain: 0.06, pitchDamping: 0.2, flareOffset: 0.07, flareClimbGain: 0.12,
});

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function trimBodyTarget({ pathLength, w, q }, speed, clearance, { pilot, onsetMetres }) {
  const cruise = clamp(clearance / PILOT.approachHeight, 0, 1);
  const targetSpeed = PILOT.landingSpeed + PILOT.cruiseSpeedIncrement * cruise;
  const flare = clamp(1 - clearance / PILOT.flareHeight, 0, 1);
  const trimShift = PILOT.speedGain * (speed - targetSpeed) - PILOT.climbGain * w - PILOT.pitchDamping * q;
  const flareShift = flare * (PILOT.flareOffset - PILOT.flareClimbGain * w);
  const length = pilot ? PILOT.engagementMetres : PILOT.previousEngagementMetres;
  const engagement = clamp((pathLength - (pilot ? onsetMetres : 0)) / length, 0, 1);
  // The trim controller requests displacement of the combined CG, in metres.
  return limitBodyShift(bodyShiftFromCg(engagement * (trimShift + flareShift)));
}

export function resolveOpening(overrides) {
  if (!overrides) return TATSUMI_PULLUP;
  const opening = { ...TATSUMI_PULLUP, ...overrides };
  const { holdUntil, easeAt, resumeTrimAt, activeResponseSeconds } = opening;
  if (![holdUntil, easeAt, resumeTrimAt, activeResponseSeconds].every(Number.isFinite)
      || holdUntil < 0 || easeAt < holdUntil || resumeTrimAt < easeAt || activeResponseSeconds <= 0) {
    throw new RangeError('Opening control times must be ordered and the response time must be positive.');
  }
  return opening;
}

export function weightShiftRate(state, time, speed, pilotInput, clearance, options) {
  const { pilot, referenceControl, contestOpening, opening = TATSUMI_PULLUP, returnSeconds } = options;
  const { bodyShift, pathLength } = state;
  const direct = contestOpening && (!referenceControl || time < opening.resumeTrimAt);
  let desired, responseTime = referenceTiming.returnSeconds;
  if (direct) {
    const pulling = time >= opening.holdUntil && time < opening.easeAt;
    const command = referenceControl ? Number(pulling) : pilotInput;
    desired = launchBodyTarget(time, command, opening);
    // Deliberate movement settles faster than a release to neutral. Blend for analog inputs.
    responseTime += Math.abs(command) * (opening.activeResponseSeconds - responseTime);
  } else {
    desired = referenceControl ? trimBodyTarget(state, speed, clearance, options)
      : limitBodyShift(PILOT_SHIFT.maxBodyTravel * pilotInput);
    if (pilot && pathLength < PILOT.earlyReturnMetres && bodyShift < 0 && desired > bodyShift) {
      responseTime = returnSeconds;
    }
  }
  return clamp((desired - bodyShift) / responseTime, -PILOT_SHIFT.maxBodyRate, PILOT_SHIFT.maxBodyRate);
}
