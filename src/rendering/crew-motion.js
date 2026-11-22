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

const start = new THREE.Vector3(), pole = new THREE.Vector3();

const { clamp, lerp, smoothstep } = THREE.MathUtils;
const cycle = 2 * Math.PI;
const stand = [0, .827, 0, -.045, 0, 0, .025, 0, 0, -.218, .755, -.084, .218, .755, -.084];
const pose = new Float64Array(stand.length), layer = new Float64Array(stand.length);

function sampleClip(frames, fraction, values) {
  const at = clamp(fraction, 0, 1) * (frames.length - 1);
  const i = Math.floor(at), next = Math.min(i + 1, frames.length - 1);
  for (let k = 0; k < values.length; k++) values[k] = lerp(frames[i][k], frames[next][k], at - i);
}

export function resetRunner(member) {
  member.stride = member.phase / cycle;
  member.previousFootfall = Math.floor(2 * member.stride);
  member.lastRoot ??= new THREE.Vector3();
  member.lastRoot.copy(member.root.position);
  for (const leg of member.legs) {
    leg.contact ??= new THREE.Vector3();
    leg.ankle ??= new THREE.Vector3();
    leg.planted = false;
    leg.hasContact = false;
  }
  for (const arm of member.arms) {
    arm.freeHand ??= new THREE.Vector3();
    arm.grip ??= new THREE.Vector3();
  }
}

// Retarget the Blender poses in local metres. The feet follow travel across
// the runway (also sideways when a starter faces the frame). During support,
// keep the ankle over one point on the ground while the hips move past it.
export function poseRunner(member, speed, dt, action, progress, weight, slopeAft = 0, slopeRight = 0, hold = 0) {
  const { root, torso, head } = member;
  if (!member.lastRoot) resetRunner(member);
  const run = smoothstep(speed, .03, 3.5);
  const dx = root.position.x - member.lastRoot.x, dz = root.position.z - member.lastRoot.z;
  const distance = Math.hypot(dx, dz);
  const highGrip = hold && Math.min(member.arms[0].grip.y, member.arms[1].grip.y) > 1.40;
  const strideLength = .54 + (highGrip ? 1.06 : 1.44) * smoothstep(speed, 0, 3.5);
  const walking = smoothstep(speed, 0, .35);
  member.stride += distance / (strideLength * member.scale);
  const phase = member.stride % 1;
  sampleClip(member.clips.Run, phase, pose);
  for (let i = 0; i < pose.length; i++) pose[i] = lerp(stand[i], pose[i], run);
  if (action && weight > 0) {
    sampleClip(member.clips[action], progress ?? phase, layer);
    for (let i = 0; i < pose.length; i++) pose[i] = lerp(pose[i], layer[i], weight);
  }
  torso.position.fromArray(pose);
  torso.rotation.set(pose[3], pose[4], pose[5]);
  head.rotation.set(pose[6], pose[7], pose[8]);
  torso.scale.y = 1;
  if (hold) {
    // A high boom draws the chest upright. For a low bar, bend the knees
    // and bring the shoulder girdle over the palms before extending the arms.
    const gripHeight = (member.arms[0].grip.y + member.arms[1].grip.y) / 2;
    const overhead = hold * smoothstep(gripHeight, 1.30, 1.76);
    torso.rotation.x *= 1 - .78 * overhead;
    torso.scale.y += .10 * overhead;
    for (let pass = 0; pass < 2; pass++) {
      torso.updateMatrix();
      for (const arm of member.arms) {
        start.set(arm.sign * .186, .45, 0).applyMatrix4(torso.matrix);
        segment.subVectors(arm.grip, start);
        const distance = segment.length();
        const excess = Math.max(0, distance - (arm.length + arm.lowerLength) * .96);
        torso.position.addScaledVector(segment, hold * excess / Math.max(.001, distance));
      }
      torso.position.x = clamp(torso.position.x, -.17, .17);
      torso.position.y = clamp(torso.position.y, .63, .907);
      torso.position.z = clamp(torso.position.z, -.22, .16);
    }
  }
  torso.updateMatrix();
  member.arms[0].freeHand.fromArray(pose, 9);
  member.arms[1].freeHand.fromArray(pose, 12);

  const yaw = root.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
  const alongX = distance ? (c * dx - s * dz) / distance : 0;
  const alongZ = distance ? (s * dx + c * dz) / distance : -1;
  const support = lerp(.60, .43, run);
  for (const leg of member.legs) {
    const { sign } = leg;
    const footPhase = (phase + (sign > 0 ? .5 : 0)) % 1;
    const stance = footPhase < support;
    const swing = clamp((footPhase - support) / (1 - support), 0, 1);
    const clearance = Math.sin(Math.PI * swing);
    // Zero slope at both ends of the airborne arc eases the foot onto the sole.
    const span = strideLength * support;
    const offset = span * (stance ? .5 - footPhase / support : smoothstep(swing, 0, 1) - .5);
    const wide = action === 'Catch' ? .032 * weight : 0;
    const footX = sign * (.106 + wide) * lerp(1, -alongZ, walking);
    const footZ = sign * ((.106 + wide) * alongX * walking + .135 * (1 - walking));
    let x = footX + alongX * offset * walking;
    let z = footZ + alongZ * offset * walking;
    const planted = stance || speed < .04;
    if (leg.hasContact && dt < .30 && distance < .72) {
      const worldX = (leg.contact.x - root.position.x) / member.scale;
      const worldZ = (leg.contact.z - root.position.z) / member.scale;
      const heldX = c * worldX - s * worldZ, heldZ = s * worldX + c * worldZ;
      if (planted && leg.planted) {
        x = heldX; z = heldZ;
      } else if (!planted) {
        // Leave the previous toe-off point continuously, even through turns.
        const flight = smoothstep(swing, 0, 1);
        const landing = span * walking * .5 + (1 - swing) * (1 - support) * strideLength;
        x = lerp(heldX, footX + alongX * landing, flight);
        z = lerp(heldZ, footZ + alongZ * landing, flight);
      }
    }
    const footYaw = Math.atan2(-alongX, -alongZ) * walking;
    if (planted && (!leg.planted || !leg.hasContact || dt >= .30 || distance >= .72)) {
      leg.contactYaw = yaw + footYaw;
      leg.contact.set(root.position.x + member.scale * (c * x + s * z), 0,
        root.position.z + member.scale * (-s * x + c * z));
      leg.hasContact = true;
    }
    leg.planted = planted;
    leg.ankle.set(x, .078 + run * .225 * clearance ** 2 + z * slopeAft + x * slopeRight, z);
    start.set(sign * .094, 0, 0).applyMatrix4(torso.matrix);
    const reachLength = leg.length + leg.lowerLength - .002;
    const dx = x - start.x, dz = z - start.z;
    const hipHeight = leg.ankle.y + Math.sqrt(Math.max(0, reachLength ** 2 - dx * dx - dz * dz));
    torso.position.y = Math.min(torso.position.y, hipHeight - (start.y - torso.matrix.elements[13]));
    leg.end.rotation.set(-Math.atan(slopeAft) - .46 * Math.sin(cycle * swing) * clearance * run, planted ? leg.contactYaw - yaw : footYaw, Math.atan(slopeRight), 'YXZ');
  }
  torso.updateMatrix();
  for (const leg of member.legs) {
    start.set(leg.sign * .094, 0, 0).applyMatrix4(torso.matrix);
    // Knees and toes follow the course while the upper body turns to the boom.
    reach(leg, start, leg.ankle, pole.set(leg.sign * .065 + alongX * walking, 0, lerp(-1, alongZ, walking)));
  }
  member.lastRoot.copy(root.position);
  const footfall = Math.floor(2 * member.stride);
  const landed = footfall > member.previousFootfall;
  member.previousFootfall = footfall;
  return landed;
}
