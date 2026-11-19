// The single fore/aft control drives body travel directly and progressively
// deflects the QX elevator. Rates describe the player's stick, not servo latency.
export function advanceElevator(angle, input, seconds, profile) {
  if (!profile.elevatorLimitDeg) return 0;
  const target = input * profile.elevatorLimitDeg;
  const { pressDegPerSecond, returnDegPerSecond } = profile.elevatorControl;
  if (angle * target < 0) {
    const centreTime = Math.abs(angle) / returnDegPerSecond;
    if (seconds <= centreTime) return angle - Math.sign(angle) * seconds * returnDegPerSecond;
    seconds -= centreTime;
    angle = 0;
  }
  const rate = Math.abs(target) > Math.abs(angle) ? pressDegPerSecond : returnDegPerSecond;
  const delta = target - angle;
  return Math.abs(delta) <= seconds * rate ? target : angle + Math.sign(delta) * seconds * rate;
}

// Replay starts at a sampled deflection. Apply any intervening input edges
// so even a tap that fits between two 20 Hz samples is visible when scrubbing.
export function replayElevator(sample, time, inputs, profile) {
  if (!profile.elevatorLimitDeg) return 0;
  let angle = sample.elevatorDeg, cursor = sample.t;
  for (const input of inputs) {
    if (input.start >= time) break;
    if (input.end <= cursor) continue;
    if (input.start > cursor) {
      angle = advanceElevator(angle, 0, input.start - cursor, profile);
      cursor = input.start;
    }
    const end = Math.min(time, input.end);
    angle = advanceElevator(angle, input.direction, end - cursor, profile);
    cursor = end;
  }
  return advanceElevator(angle, 0, time - cursor, profile);
}
