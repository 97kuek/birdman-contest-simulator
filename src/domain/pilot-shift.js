import { LAUNCH } from './launch.js';

// Tatsumi's published empty/gross masses are 48/100 kg. Of the remaining
// 52 kg we model 4 kg of equipment and grip-supported mass as stationary.
// The effective moving mass and the cabin travel are simulation assumptions.
export const PILOT_SHIFT = Object.freeze({
  emptyMass: 48, fixedPayloadMass: 4, releaseCgShift: -0.04,
  maxBodyTravel: 0.10, maxBodyRate: 0.30,
});
const movingMassFraction = (LAUNCH.mass - PILOT_SHIFT.emptyMass - PILOT_SHIFT.fixedPayloadMass) / LAUNCH.mass;

// Metres along the aircraft, aft positive. Replay samples store the combined CG.
export const cgShiftFromBody = bodyShift => bodyShift * movingMassFraction;
export const bodyShiftFromCg = cgShift => cgShift / movingMassFraction;
export const limitBodyShift = metres => Math.max(-PILOT_SHIFT.maxBodyTravel, Math.min(PILOT_SHIFT.maxBodyTravel, metres));
