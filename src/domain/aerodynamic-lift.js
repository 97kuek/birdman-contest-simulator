const MIN_POST_STALL_LIFT_FRACTION = 0.45;

// Empirical bounded lift after stall, not a tunnel measurement of either section.
export function liftCoefficient(angle, slope, maximum) {
  const linear = slope * angle;
  if (Math.abs(linear) <= maximum) return linear;
  const beyondStall = Math.abs(angle) - maximum / slope;
  return Math.sign(linear) * maximum * Math.max(MIN_POST_STALL_LIFT_FRACTION, Math.cos(2 * beyondStall));
}

// At a centreline tail aft of the CG, omega × r adds q * arm to body-down
// velocity. Spanwise flow does not contribute to the tail's section lift.
export function horizontalTailLoad({ axialSpeed, downSpeed, alpha }, pitchRate, arm,
  density, area, slope, incidenceOffset, maxLiftCoefficient) {
  const localDown = downSpeed + pitchRate * arm;
  const localAlpha = Math.atan2(localDown, axialSpeed);
  const pressure = 0.5 * density * (axialSpeed ** 2 + localDown ** 2);
  const sectionLift = pressure * area * liftCoefficient(localAlpha + incidenceOffset, slope, maxLiftCoefficient);
  // Resolve one force into CG wind axes for translation and body axes for torque.
  const rotation = localAlpha - alpha;
  return {
    lift: sectionLift * Math.cos(rotation),
    drag: -sectionLift * Math.sin(rotation),
    upwardNormal: sectionLift * Math.cos(localAlpha),
  };
}
