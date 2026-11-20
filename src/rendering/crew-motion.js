import * as THREE from 'three';

// Scratch vectors keep bone animation allocation-free.
const axis = new THREE.Vector3(), bend = new THREE.Vector3(), joint = new THREE.Vector3();
const segment = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);

export function placeBone(mesh, start, end, length) {
  segment.subVectors(end, start);
  mesh.position.copy(start);
  mesh.scale.y = segment.length() / length;
  mesh.quaternion.setFromUnitVectors(down, segment.normalize());
}

export function reach(limb, from, to, pole) {
  axis.subVectors(to, from);
  const distance = Math.max(0.001, axis.length());
  axis.divideScalar(distance);
  const upper = limb.length, lower = limb.lowerLength;
  const span = THREE.MathUtils.clamp(distance, Math.abs(upper - lower) + 0.001, upper + lower - 0.0001);
  const along = (upper * upper - lower * lower + span * span) / (2 * span);
  bend.copy(pole).addScaledVector(axis, -pole.dot(axis)).normalize();
  joint.copy(from).addScaledVector(axis, along)
    .addScaledVector(bend, Math.sqrt(Math.max(0, upper * upper - along * along)));
  placeBone(limb.upper, from, joint, upper);
  placeBone(limb.lower, joint, to, lower);
  limb.end.position.copy(to);
}

const start = new THREE.Vector3(), target = new THREE.Vector3(), pole = new THREE.Vector3();

export function poseRunner(member, gait, run, crouch, lean, slopeAft = 0, slopeRight = 0) {
  member.torso.position.set(0, 0.785 + 0.034 * Math.cos(2 * gait) * run - crouch, 0);
  member.torso.rotation.x = lean;
  member.torso.rotation.z = 0.025 * Math.sin(gait) * run;
  member.torso.updateMatrix();
  member.head.rotation.x = -member.torso.rotation.x * 0.65;

  for (const leg of member.legs) {
    const { sign } = leg;
    const cycle = Math.sin(gait) * sign, swing = Math.cos(gait) * sign;
    start.set(sign * 0.094, member.torso.position.y, 0);
    target.set(sign * 0.105, 0.078 + Math.max(0, swing) * 0.21 * run, sign * 0.125 * (1 - run) + cycle * 0.39 * run);
    target.y += target.z * slopeAft + target.x * slopeRight;
    reach(leg, start, target, pole.set(sign * 0.035, 0, -1));
    leg.end.rotation.x = -0.24 * run * Math.max(0, swing);
  }
}
