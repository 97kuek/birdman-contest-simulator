import { MathUtils, Vector3 } from 'three';
import { aircraftProfile } from '../../domain/aircraft-profiles.js';
import { limitBodyShift } from '../../domain/pilot-shift.js';
import { pilotJumpLift, poseLaunchLegs } from './pilot-launch.js';
import { matchingParts } from './model.js';

// The edited shoulder sockets, hand grips, knees and ankles are rig datums.
// Use the same two-link IK during a live launch and while seeking the replay.
export function bindGliderPilot(aircraft, id) {
  const ryukai = id === 'ryukai';
  const pilot = aircraft.getObjectByName('pilot');
  const torso = pilot.getObjectByName(ryukai ? 'pilot-torso' : 'qx-pilot-torso');
  const moving = pilot.getObjectByName('pilot-weight-shift');
  const restHeight = torso.position.y;
  const clearance = aircraftProfile(id).deckClearance;
  const legs = matchingParts(pilot, 'pilot-hip').map(hip => {
    const knee = hip.getObjectByName('pilot-knee');
    const shoe = knee.getObjectByName('ankle');
    const length = p => Math.hypot(p.position.y, p.position.z);
    const angle = p => Math.atan2(-p.position.y, p.position.z);
    return { hip, knee, shoe, side: Math.sign(hip.position.x), thighLength: length(knee),
      calfLength: length(shoe), thighAxis: angle(knee), calfAxis: angle(shoe),
      standingHip: hip.userData.standingHip, soleHeight: hip.userData.soleHeight, footAngle: hip.userData.footAngle,
      rest: { height: hip.position.y, hip: hip.rotation.x, knee: knee.rotation.x, shoe: shoe.rotation.x } };
  });
  const [sockets, grips, uppers, lowers] = ['shoulder-socket', 'grip-center', 'upper-arm', 'forearm']
    .map(name => matchingParts(pilot, name));
  const upperLength = ryukai ? .238 : .265, lowerLength = ryukai ? .200 : .25;
  const shoulder = new Vector3(), elbow = new Vector3(), reach = new Vector3(), bend = new Vector3();
  const forward = new Vector3(0, 0, 1), direction = new Vector3();
  function align(part, start, end) {
    direction.subVectors(end, start);
    if (!ryukai) part.scale.z = direction.length() * .5 + .011;
    part.position.copy(start).lerp(end, .5);
    part.quaternion.setFromUnitVectors(forward, direction.normalize());
  }
  function poseArms() {
    torso.updateMatrix();
    for (const [i, socket] of sockets.entries()) {
      shoulder.copy(socket.position).applyMatrix4(torso.matrix).add(moving.position);
      const wrist = grips[i].position, side = Math.sign(socket.position.x);
      reach.subVectors(wrist, shoulder);
      const d = reach.length();
      reach.divideScalar(d);
      const projection = MathUtils.clamp((d*d + upperLength**2 - lowerLength**2)/(2*d), 0, upperLength);
      if (ryukai) bend.set(-side*.17, 1, 0);
      else bend.set(side*.26, -.8, .5);
      bend.addScaledVector(reach, -bend.dot(reach)).normalize();
      elbow.copy(shoulder).addScaledVector(reach, projection)
        .addScaledVector(bend, Math.sqrt(Math.max(0, upperLength**2 - projection**2)));
      align(uppers[i], shoulder, elbow);
      align(lowers[i], elbow, wrist);
    }
  }
  pilot.userData.setBodyOffset = metres => {
    moving.position.z = ryukai ? limitBodyShift(metres) : MathUtils.clamp(metres, -.14, .14);
    poseArms();
  };
  return (sample, weight) => {
    torso.rotation.x = .13 * weight;
    torso.position.y = restHeight - (ryukai ? .042 : .063) * weight + pilotJumpLift(weight);
    poseLaunchLegs(legs, sample, weight, clearance);
    poseArms();
  };
}
