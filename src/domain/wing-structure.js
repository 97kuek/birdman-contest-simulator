import { GRAVITY, RADIANS_PER_DEGREE } from './units.js';

// Tip travel from the unloaded outline to the steady glide curve on each
// team's three-view. The 3g design figure on the Tatsumi drawing is a lower
// bound. The game's overload cutoffs are estimates of root moment capacity.
export const WING_STRUCTURE = Object.freeze({
  ryukai: Object.freeze({ referenceTip: .753, overloadFactor: 3 }),
  qx25: Object.freeze({ referenceTip: 1.234, overloadFactor: 3 }),
});

// Estimates shared by both aircraft. These are model inputs, not test data.
const WING_FRACTION_OF_EMPTY_MASS = .45;
const TRIM_TIP_TWIST = -.75 * RADIANS_PER_DEGREE;
// Differences between the spar line and the steady glide curve at quarters
// of the half-span. Only the tip difference is explicitly dimensioned.
const spanwiseBend = {
  ryukai: [0, .07, .25, .53, WING_STRUCTURE.ryukai.referenceTip],
  qx25: [0, .10, .36, .74, WING_STRUCTURE.qx25.referenceTip],
};

export function wingBendShape(aircraftId, fraction) {
  const x = Math.max(0, Math.min(1, fraction));
  const bend = spanwiseBend[aircraftId];
  // Cubic Hermite interpolation through the drawing, with a clamped root.
  const index = Math.min(Math.floor(x * 4), 3), t = x * 4 - index;
  const low = bend[index], high = bend[index + 1];
  const leftSlope = index === 0 ? 0 : (high - bend[index - 1]) / 2;
  const rightSlope = index === 3 ? high - low : (bend[index + 2] - low) / 2;
  const t2 = t * t, t3 = t2 * t;
  return ((2 * t3 - 3 * t2 + 1) * low + (t3 - 2 * t2 + t) * leftSlope
    + (3 * t2 - 2 * t3) * high + (t3 - t2) * rightSlope) / bend.at(-1);
}

export function wingTwistShape(fraction) {
  const x = Math.max(0, Math.min(1, fraction));
  return x * (2 - x);
}

// Integrate the fixed spatial distributions once. Each weight is a fraction
// of the half-wing total. Chord taper approximates the incremental lift due to
// twist; mass per unit span is assumed to taper to 20% of its root value.
function sectionIntegrals(aircraftId, tipChordRatio) {
  const strips = 64;
  let liftSum = 0, liftBend = 0, liftTwist = 0;
  let twistLift = 0, twistArm = 0, twistBend = 0, twistSquared = 0;
  let massArm = 0, massBend = 0, massBendArm = 0, modalMass = 0;
  for (let i = 0; i < strips; i++) {
    const x = (i + .5) / strips;
    const bend = wingBendShape(aircraftId, x), twist = wingTwistShape(x);
    const lift = Math.sqrt(1 - x * x);
    const chord = 2 * (1 - (1 - tipChordRatio) * x) / ((1 + tipChordRatio) * strips);
    const mass = (1 - .8 * x) / (.6 * strips);
    liftSum += lift;
    liftBend += lift * bend;
    liftTwist += lift * twist;
    twistLift += chord * twist;
    twistArm += chord * twist * x;
    twistBend += chord * twist * bend;
    twistSquared += chord * twist * twist;
    massArm += mass * x;
    massBend += mass * bend;
    massBendArm += mass * bend * x;
    modalMass += mass * bend * bend;
  }
  return { liftBend: liftBend / liftSum, liftTwist: liftTwist / liftSum,
    liftArm: 4 / (3 * Math.PI), twistLift, twistArm, twistBend, twistSquared,
    massArm, massBend, massBendArm, modalMass };
}

const integrals = {
  ryukai: sectionIntegrals('ryukai', .250 / 1.009),
  qx25: sectionIntegrals('qx25', .35 / 1.06),
};

// One bending coordinate (tip displacement, positive up) and one torsional
// coordinate (tip incidence change, positive nose up) on each half-wing.
// The bending equilibrium is K*y = ∫(lift - mass*normalAcceleration)*shape.
// span is the full design span in metres. Forces are N and lift slopes N/rad.
export function solveWingStructure(profile, span, {
  leftLift, rightLift, leftSupport = 0, rightSupport = 0, supportStation = 0, leftLiftSlope = 0, rightLiftSlope = 0, normalAcceleration, supportAcceleration = 0,
  leftTip, rightTip, leftTipRate = 0, rightTipRate = 0,
  referenceHalfLift = profile.mass * GRAVITY / 2,
}) {
  const aircraftId = profile.design.aircraftId ?? 'ryukai';
  const structure = WING_STRUCTURE[aircraftId], w = integrals[aircraftId];
  const scale = span / profile.design.span, halfSpan = span / 2;
  const halfMass = profile.emptyMass * WING_FRACTION_OF_EMPTY_MASS / 2;
  const referenceForce = referenceHalfLift * w.liftBend - halfMass * GRAVITY * w.massBend;
  // A family of wings of constant chord and spar section has Kbend ∝ EI/b³
  // and Ktorsion ∝ GJ/b. The trainer keeps aircraft and wing mass fixed.
  const bendingStiffness = referenceForce / (structure.referenceTip * scale ** 3);
  const referenceTwist = TRIM_TIP_TWIST * scale;
  const compliance = referenceTwist / (referenceHalfLift * w.liftTwist);
  function aerodynamicLoad(rigidLift, slope) {
    // Assume a small net nose-down moment per unit lift at the spar.
    // The existing CL curve describes the trimmed wing. Only twist away from
    // that shape changes CL. Solve the scalar torsional equilibrium directly.
    const twistDelta = compliance * w.liftTwist * (rigidLift - referenceHalfLift)
      / (1 - compliance * slope * w.twistSquared);
    const correction = slope * twistDelta;
    return {
      twist: referenceTwist + twistDelta,
      lift: rigidLift + correction * w.twistLift,
      moment: halfSpan * (rigidLift * w.liftArm + correction * w.twistArm),
      bendingForce: rigidLift * w.liftBend + correction * w.twistBend,
    };
  }
  const left = aerodynamicLoad(leftLift, leftLiftSlope);
  const right = aerodynamicLoad(rightLift, rightLiftSlope);
  const acceleration = normalAcceleration ?? (left.lift + right.lift) / profile.mass + supportAcceleration;
  const inertia = halfMass * acceleration;
  // Individual normal point loads, projected onto its bending mode.
  const handShape = leftSupport || rightSupport ? wingBendShape(aircraftId, supportStation / halfSpan) : 0;
  const leftEquilibrium = (left.bendingForce + leftSupport * handShape - inertia * w.massBend) / bendingStiffness;
  const rightEquilibrium = (right.bendingForce + rightSupport * handShape - inertia * w.massBend) / bendingStiffness;
  const omega = Math.sqrt(bendingStiffness / (halfMass * w.modalMass));
  const dampingRatio = .20; // Assumed modal damping supplements aerodynamic damping.
  function tipAcceleration(tip, rate, equilibrium) {
    return omega * (omega * (equilibrium - (tip ?? equilibrium)) - 2 * dampingRatio * rate);
  }
  const leftTipAcceleration = tipAcceleration(leftTip, leftTipRate, leftEquilibrium);
  const rightTipAcceleration = tipAcceleration(rightTip, rightTipRate, rightEquilibrium);
  // d'Alembert root reaction: subtract both the fuselage acceleration and
  // the local elastic acceleration φ(x)*tipAcceleration from the applied load.
  const elasticInertiaArm = halfSpan * halfMass * w.massBendArm;
  const leftMoment = left.moment + leftSupport * supportStation - halfSpan * inertia * w.massArm - elasticInertiaArm * leftTipAcceleration;
  const rightMoment = right.moment + rightSupport * supportStation - halfSpan * inertia * w.massArm - elasticInertiaArm * rightTipAcceleration;
  const limitMoment = structure.overloadFactor * profile.design.span / 2
    * (referenceHalfLift * w.liftArm - halfMass * GRAVITY * w.massArm);
  const leftUtilization = Math.abs(leftMoment) / limitMoment;
  const rightUtilization = Math.abs(rightMoment) / limitMoment;
  const utilization = Math.max(leftUtilization, rightUtilization);
  let failedSide = null;
  if (utilization >= 1) {
    failedSide = leftUtilization > rightUtilization ? 'left' : 'right';
    if (leftUtilization === rightUtilization) failedSide = 'both';
  }
  return {
    leftTip: leftEquilibrium, rightTip: rightEquilibrium, leftTipAcceleration, rightTipAcceleration,
    leftTwist: left.twist, rightTwist: right.twist, leftLift: left.lift, rightLift: right.lift,
    leftMoment, rightMoment, rollMoment: left.moment - right.moment,
    utilization, limitMoment, failedSide,
    referenceTip: referenceForce / bendingStiffness,
    bendingOmegaRadPerSec: omega,
  };
}
