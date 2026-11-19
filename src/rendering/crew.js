import * as THREE from 'three';
import { LAUNCH, RAMP_LENGTH, rampAt } from '../domain/launch.js';
import { createCrewMembers } from './crew-model.js';
import { deckHeight, deckRun, deckSlope } from './launch-deck.js';

// Scratch vectors keep bone animation allocation-free.
const axis = new THREE.Vector3(), bend = new THREE.Vector3(), joint = new THREE.Vector3();
const segment = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);

function placeBone(mesh, start, end, length) {
  segment.subVectors(end, start);
  mesh.position.copy(start);
  mesh.scale.y = segment.length() / length;
  mesh.quaternion.setFromUnitVectors(down, segment.normalize());
}

function reach(limb, from, to, pole) {
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

// Stop the runner before the curved lip, including the shoe and stride clearance.
function runnerReleaseTime(launch, startX, startZ) {
  function insideDeck(travel) {
    const x = startX + travel * launch.rightStep;
    const z = startZ - travel * launch.forwardStep;
    return Math.abs(x) < 6.43 && Math.hypot(x, Math.max(0, deckRun - z) + 0.52) < 9.87;
  }
  let stop = launch.pushed;
  if (!insideDeck(stop)) {
    let low = 0, high = stop;
    for (let i = 0; i < 12; i++) {
      const middle = (low + high) / 2;
      if (insideDeck(middle)) low = middle;
      else high = middle;
    }
    stop = low;
  }
  return Math.sqrt(2 * stop / launch.acceleration);
}

export function createLaunchCrew() {
  const group = new THREE.Group();
  const members = createCrewMembers();
  group.name = 'プラットフォームのプッシャー';
  group.add(...members.map(member => member.root));
  let previousTime = -1, previousLaunch = null;
  const start = new THREE.Vector3(), target = new THREE.Vector3(), pole = new THREE.Vector3();

  function update(launch, elapsed, onFootfall) {
    const time = Math.min(elapsed, launch.duration + 1.1);
    if (previousLaunch === launch && previousTime === time) return;
    previousTime = time;
    previousLaunch = launch;
    const cos = Math.cos(launch.heading), sin = Math.sin(launch.heading);
    for (const member of members) {
      // At oblique headings the outside wing runner moves inboard onto the fan.
      const lateral = member.side ? member.side * (3.12 - 1.65 * Math.abs(sin)) : 0.29;
      const aft = member.side ? 1.15 : 1.79;
      const startX = cos * lateral - sin * aft;
      const startZ = deckRun + sin * lateral + cos * aft;
      const releasedAt = runnerReleaseTime(launch, startX, startZ);
      const relax = THREE.MathUtils.smoothstep(Math.max(0, time - releasedAt), 0, 0.59);
      const { travel } = rampAt(launch, Math.min(time, releasedAt));
      const x = startX + travel * launch.rightStep, z = startZ - travel * launch.forwardStep;
      member.root.position.set(x, deckHeight(z), z);
      member.root.rotation.y = -launch.heading;

      // Lengthen steps through acceleration, from a short push-off to a sprint.
      const startingStep = 0.64, finalStep = Math.sqrt(startingStep ** 2 + 0.45 * travel);
      const steps = 2 * travel / ((startingStep + finalStep) * member.scale);
      const gait = member.phase + steps * Math.PI;
      // The two shoes alternate contact as their cosine swing crosses zero.
      const footfall = Math.floor(gait / Math.PI + 0.5);
      if (footfall > member.footfall && time <= releasedAt && Number.isFinite(elapsed))
        onFootfall?.(member.side, footfall);
      member.footfall = footfall;
      const run = Math.min(1, travel * 2) * (1 - relax);
      const crouch = 0.12 * relax, bounce = 0.034 * Math.cos(2 * gait) * run;
      member.torso.position.set(0, 0.785 + bounce - crouch, 0);
      member.torso.rotation.x = -0.34 - 0.18 * run + 0.16 * relax;
      member.torso.rotation.z = 0.025 * Math.sin(gait) * run;
      member.torso.updateMatrix();
      member.head.rotation.x = -member.torso.rotation.x * 0.65;

      for (const leg of member.legs) {
        const { sign } = leg;
        const cycle = Math.sin(gait) * sign, swing = Math.cos(gait) * sign;
        start.set(sign * 0.094, member.torso.position.y, 0);
        target.set(sign * 0.105, 0.078 + Math.max(0, swing) * 0.21 * run, sign * 0.125 * (1 - run) + cycle * 0.39 * run);
        target.y += (target.z * cos + target.x * sin) * deckSlope;
        reach(leg, start, target, pole.set(sign * 0.035, 0, -1));
        leg.end.rotation.x = -0.24 * run * Math.max(0, swing);
      }

      const aircraftY = launch.edgeHeight + (RAMP_LENGTH - travel) * launch.dropStep + LAUNCH.deckClearance;
      const gripY = aircraftY + (member.side ? 0.535 : 0.34) - member.root.position.y;
      for (const arm of member.arms) {
        const { sign } = arm;
        start.set(sign * 0.186, 0.45, 0).applyMatrix4(member.torso.matrix);
        const gripX = member.side ? sign * 0.174 : sign * 0.08 - lateral;
        target.set(gripX, gripY, (member.side ? 0.565 : 1.32) - aft + 0.056).divideScalar(member.scale);
        target.lerp(segment.set(sign * 0.22, 0.61, -0.16), relax);
        reach(arm, start, target, pole.set(sign * 0.58, -0.24, 0.82));
      }
    }
  }

  function answer(wing, seconds) {
    const side = wing === 'left' ? -1 : wing === 'right' ? 1 : 0;
    const nod = Math.sin(Math.PI * Math.min(1, seconds / 0.48)) ** 2;
    for (const member of members) {
      member.head.rotation.x = -member.torso.rotation.x * 0.65
        + (side && member.side === side ? 0.19 * nod : 0);
    }
  }
  return { group, update, answer };
}
