import { CRUISE_AIRCRAFT } from './powered-cruise.js';
import { LAUNCH } from './launch.js';

export const BASE_DESIGN = Object.freeze({ span: 25.1, incidence: 3.2 });
export const QX25_DESIGN = Object.freeze({ aircraftId: 'qx25', span: 26.2, incidence: 4.2 });
export const REN_DESIGN = Object.freeze({ aircraftId: 'ren', span: CRUISE_AIRCRAFT.ren.span, incidence: 0 });
export const RUDDER_LIMIT_DEG = 10;

// TORICA Tatsumi.csv and FlightModel/isoSim1.cs, revision 3bddd010.
// span is the aerodynamic calculation span. design.span is the drawing span.
const ryukai = Object.freeze({
  design: BASE_DESIGN, mass: LAUNCH.mass, emptyMass: 48,
  area: 17.92, span: 24.514, aspectRatio: 33.534, efficiency: 0.987,
  chord: 0.812, tailArm: 2.9, tailArea: 1.736, wingHeight: 0.555,
  pitchInertia: 51, rollInertia: 993.022, yawInertia: 1028.254,
  airDensity: 1.164, cruiseSpeed: 10.5, wingLiftSlopePerDegree: 0.103, tailLiftSlopePerDegree: 0.079,
  maxLiftCoefficient: 1.4, dragCoefficient: 0.015, wingMomentCoefficient: -0.132,
  wingMomentArmChords: 0.1, referenceTailVolume: 0.346,
  // Published fin area and arm, see docs/steering-validation.md.
  finArea: 0.62, finArm: 3.5, rudderEffectiveness: 1,
  rudderLimitDeg: RUDDER_LIMIT_DEG, elevatorLimitDeg: 0, elevatorEffectiveness: 0,
  deckClearance: LAUNCH.deckClearance, releasePathDeg: LAUNCH.pathDeg, releaseCgShift: -0.04, releasePitchRateDeg: LAUNCH.pitchRateDeg,
});

// Kyushu University, QX-25 three-view, 主要諸元 and tail dimension lines:
// https://www.q-birdman.jp/history/images/qx-25.pdf
// The tail arm is recovered from Vh = Sh * lh / (S * MAC). The CG is at
// 36.5% MAC. A wing aerodynamic centre at 25% MAC is a model assumption.
const qxFinArea = 0.661;
const qxFinVolume = 0.00468;
const qxTailArm = 0.395 * 20.62 * 0.863 / 1.88;
const qx25 = Object.freeze({
  ...ryukai, design: QX25_DESIGN, mass: 117, emptyMass: 51,
  area: 20.62, span: 26.2, aspectRatio: 33.29, chord: 0.863,
  tailArea: 1.88, referenceTailVolume: 0.395, tailArm: qxTailArm,
  cruiseSpeed: 9.50, wingMomentArmChords: 0.365 - 0.25,
  finArea: qxFinArea, finArm: qxFinVolume * 26.2 * 20.62 / qxFinArea,
  rudderLimitDeg: 17, elevatorLimitDeg: 10,
  elevatorControl: Object.freeze({ pressDegPerSecond: 16, returnDegPerSecond: 48 }),
  // Assumptions rather than measured QX aerodynamic derivatives or telemetry.
  // The tail response and drag are estimates. Torica lift slopes and lateral
  // derivatives serve as starting values. Inertias scale with mass and length².
  wingHeight: 0.13, rudderEffectiveness: 0.65, elevatorEffectiveness: 0.75, efficiency: 0.93, dragCoefficient: 0.017,
  pitchInertia: 51 * (117 / 100) * (qxTailArm / ryukai.tailArm) ** 2,
  rollInertia: 993.022 * (117 / 100) * (26.2 / 25.1) ** 2,
  yawInertia: 1028.254 * (117 / 100) * (26.2 / 25.1) ** 2,
  // The pilot reported a nose-up tendency on release. Its rate is unmeasured.
  deckClearance: 0.635, releasePathDeg: null, releaseCgShift: 0, releasePitchRateDeg: 14,
});

// The design point fixes the polar. Tail limits come from the three-view. Inertias, stick rates and
// release conditions are estimates for a seated pilot operating the tail.
const renWheelStations = Object.freeze([-1.04, .29]); // metres aft of CG, front then rear
const ren = Object.freeze({
  design: REN_DESIGN, propulsion: CRUISE_AIRCRAFT.ren, fixedPilot: true,
  mass: CRUISE_AIRCRAFT.ren.mass, area: CRUISE_AIRCRAFT.ren.area, span: REN_DESIGN.span,
  // Estimate: 45% of the 33.2 kg empty mass uniformly spread along the span.
  rollInertia: 0.45 * 33.2 * REN_DESIGN.span ** 2 / 12,
  // Mass radius of gyration about the lateral axis, estimated at 1.1 m.
  pitchInertia: CRUISE_AIRCRAFT.ren.mass * 1.1 ** 2,
  cruiseSpeed: CRUISE_AIRCRAFT.ren.speed, deckClearance: 0.40, wheelStations: renWheelStations, releaseWheelAft: renWheelStations[1],
  releasePathDeg: null, releaseCgShift: 0, releasePitchRateDeg: 0,
  rudderLimitDeg: 12.5, elevatorLimitDeg: 10,
  elevatorControl: Object.freeze({ pressDegPerSecond: 18, returnDegPerSecond: 36 }),
});

export function aircraftProfile(aircraftId = 'ryukai') {
  if (aircraftId === 'ryukai') return ryukai;
  if (aircraftId === 'qx25') return qx25;
  if (aircraftId === 'ren') return ren;
  throw new RangeError('Unknown aircraft: ' + aircraftId);
}
