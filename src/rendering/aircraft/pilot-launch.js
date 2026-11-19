import { MathUtils } from 'three';
import { RAMP_LENGTH } from '../../domain/launch.js';
import { deckHeight, deckRun, deckSlope } from '../launch-deck.js';

// Both three-views show a supported upper body, running legs, and a prone
// flying posture. Individual joint angles, gait phase and boarding duration
// are animation estimates. Use ramp distance and air time so replay seeking
// and a release frame reached at a different render rate give the same pose.
export function pilotLaunchWeight(sample) {
  const releaseTime = sample.t ?? ((sample.rampTravel ?? 0) - RAMP_LENGTH) / Math.max(.1, sample.groundSpeed ?? 0);
  return 1 - MathUtils.smoothstep(releaseTime, -.14, .18);
}

export function pilotJumpLift(weight) {
  return .052 * Math.sin(Math.PI*weight);
}

export function poseLaunchLegs(legs, sample, weight, clearance) {
  const travel = sample.rampTravel ?? (sample.t === undefined ? 0 : RAMP_LENGTH);
  const stepLength = Math.sqrt(.64**2 + .45*travel);
  const steps = 2*travel / (.64 + stepLength);
  const speed = MathUtils.clamp((sample.groundSpeed ?? 0) / 4, 0, 1);
  const heading = sample.heading ?? 0;
  const along = Math.cos(heading);
  const forwardStep = along / Math.hypot(1, deckSlope*along);
  const originZ = deckRun - travel*forwardStep;
  for (const leg of legs) {
    const { hip, knee, shoe, side, thighLength, calfLength, rest } = leg;
    hip.position.y = MathUtils.lerp(rest.height, leg.standingHip, weight) + pilotJumpLift(weight);
    if (weight === 0) {
      hip.rotation.x = rest.hip;
      knee.rotation.x = rest.knee;
      shoe.rotation.x = rest.shoe;
      continue;
    }
    const gait = steps * Math.PI + (side > 0 ? Math.PI : 0);
    const stride = side*.058*(1-speed) - .33*Math.sin(gait)*speed;
    const footZ = originZ + along*(hip.position.z + hip.parent.position.z + stride) + Math.sin(heading)*hip.position.x;
    const rampY = deckHeight(footZ) - deckHeight(originZ);
    const slope = footZ < deckRun ? deckSlope*along : 0;
    const footHeight = -clearance + rampY + leg.soleHeight*Math.hypot(1,slope) +
      .21*Math.max(0,Math.cos(gait))**2*speed;
    const thighFlight = leg.thighAxis + rest.hip;
    const calfFlight = leg.calfAxis + rest.hip + rest.knee;
    const proneReach = thighLength*Math.cos(thighFlight) + calfLength*Math.cos(calfFlight);
    const proneHeight = rest.height - thighLength*Math.sin(thighFlight) - calfLength*Math.sin(calfFlight);
    const aft = MathUtils.lerp(proneReach, stride, weight);
    const tuckedHeight = MathUtils.lerp(proneHeight, footHeight, weight) + .11*Math.sin(Math.PI*weight);
    const drop = hip.position.y - tuckedHeight;
    const d = MathUtils.clamp(Math.hypot(drop,aft),.01,thighLength+calfLength-.0001);
    const hipAngle = Math.atan2(drop,aft) +
      Math.acos(MathUtils.clamp((d*d+thighLength**2-calfLength**2)/(2*d*thighLength),-1,1));
    const kneeAngle = -Math.acos(MathUtils.clamp((d*d-thighLength**2-calfLength**2)/(2*thighLength*calfLength),-1,1));
    const hipRotation = hipAngle - leg.thighAxis;
    const kneeRotation = kneeAngle + leg.thighAxis - leg.calfAxis;
    hip.rotation.x = hipRotation;
    knee.rotation.x = kneeRotation;
    const shoeAngle = MathUtils.lerp(rest.shoe+rest.hip+rest.knee, leg.footAngle - Math.atan(slope), weight);
    shoe.rotation.x = shoeAngle - hipRotation - kneeRotation;
  }
}
