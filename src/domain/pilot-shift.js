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
