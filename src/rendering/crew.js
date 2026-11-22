import * as THREE from 'three';
import { LAUNCH, RAMP_LENGTH, rampAt } from '../domain/launch.js';
import { aircraftProfile } from '../domain/aircraft-profiles.js';
import { renSparHeight } from '../domain/ren-wing.js';
import { createCrewMembers } from './crew-model.js';
import layout from './biwa-platform.json' with { type: 'json' };
import { deckHeight, deckRun, deckSlope } from './launch-deck.js';

import { placeBone, poseRunner, reach, resetRunner } from './crew-motion.js';

const down = new THREE.Vector3(0, -1, 0);

// Reserve the stopping distance before the curved lip. Both feet must stay
// on the usable deck even on an oblique launch.
function runnerHandoff(launch, startX, startZ) {
  const braking = 7.5;
  function release(travel) {
    const at = launch.timeAtTravel?.(travel) ?? Math.sqrt(2 * travel / launch.acceleration);
    const speed = rampAt(launch, at).speed;
    return { at, travel, speed, duration: speed / braking };
  }
  function canStop(handoff) {
    const stop = handoff.travel + .5 * handoff.speed * handoff.duration;
    const x = startX + stop * launch.rightStep;
    const z = startZ - stop * launch.forwardStep;
    return Math.abs(x) < layout.deck_half_width - .39 && Math.hypot(x, Math.max(0, deckRun - z) + .52) < 9.87;
  }
  const requested = release(launch.pushed);
  if (canStop(requested)) return requested;
  let low = 0, high = launch.pushed;
  for (let i = 0; i < 16; i++) {
    const mid = .5 * (low + high);
    if (canStop(release(mid))) low = mid;
    else high = mid;
  }
  return release(low);
}

export function createLaunchCrew(model, team = 'ryukai') {
  const group = new THREE.Group();
  const members = createCrewMembers(model, team);
  group.name = 'プラットフォームのプッシャー';
  group.add(...members.map(member => member.root));
  let previousTime = -1, previousLaunch = null;
  const start = new THREE.Vector3(), target = new THREE.Vector3(), pole = new THREE.Vector3();

  const releaseWheelAft = aircraftProfile(team).releaseWheelAft ?? 0;
  const fuselageCrew = team === 'qx25';
  if (team === 'ren') {
    const geometry = new THREE.CylinderGeometry(.010, .010, 1, 6);
    geometry.translate(0, -.5, 0);
    const material = new THREE.MeshStandardMaterial({ color: '#b4402b', roughness: .9 });
    for (const member of members.filter(m => m.side)) {
      member.line = Array.from({ length: 3 }, () => {
        const part = new THREE.Mesh(geometry, material);
        part.name = 'wing-handling-line';
        member.root.add(part);
        return part;
      });
    }
  }
  const stations = {
    ryukai: [{ lateral: 3.12, aft: 1.15, y: .535, z: .565 }, { lateral: .29, aft: 1.79, y: .34, z: 1.32 }],
    qx25: [{ lateral: .58, aft: 1.31, y: .38, z: .93, grip: .23 }, { lateral: .18, aft: 1.96, y: .43, z: 1.43 }],
    ren: [{ lateral: 3.85, aft: .38, y: .84, z: .03 }, { lateral: .21, aft: 1.85, y: .62, z: 1.31 }],
  };
  const [sideStation, rearStation] = stations[team];

  function update(launch, elapsed, onFootfall) {
    const time = Math.min(elapsed, launch.duration + 1.1);
    if (previousLaunch === launch && previousTime === time) return;
    const reset = previousLaunch !== launch || time < previousTime;
    const dt = reset ? 0 : time - previousTime;
    previousTime = time;
    previousLaunch = launch;
    const cos = Math.cos(launch.heading), sin = Math.sin(launch.heading);
    for (const member of members) {
      // At oblique headings the outside wing runner moves inboard onto the fan.
      const station = member.side ? sideStation : rearStation;
      const inboard = member.side && !fuselageCrew ? 1.65 * Math.abs(sin) : 0;
      const lateral = (member.side || 1) * (station.lateral - inboard);
      const aft = station.aft - releaseWheelAft;
      const startX = cos * lateral - sin * aft;
      const startZ = deckRun + sin * lateral + cos * aft;
      if (reset) member.handoff = runnerHandoff(launch, startX, startZ);
      const handoff = member.handoff;
      const age = Math.max(0, time - handoff.at);
      const relax = THREE.MathUtils.smoothstep(age, 0, .55);
      const rolling = rampAt(launch, Math.min(time, handoff.at));
      const brakingTime = Math.min(handoff.duration, age);
      const speed = age ? Math.max(0, handoff.speed - 7.5 * brakingTime) : rolling.speed;
      const travel = rolling.travel + brakingTime * (handoff.speed + speed) / 2;
      const x = startX + travel * launch.rightStep, z = startZ - travel * launch.forwardStep;
      member.root.position.set(x, deckHeight(z), z);
      member.root.rotation.y = -launch.heading;
      if (reset) resetRunner(member);
      const action = age ? 'Release' : 'Push';
      const weight = age ? 1 - THREE.MathUtils.smoothstep(age, .60, 1.05) : .9;
      const slope = z < deckRun ? deckSlope : 0;
      const aircraftY = launch.edgeHeight + (RAMP_LENGTH - travel) * launch.dropStep + (launch.deckClearance ?? LAUNCH.deckClearance);
      const gripY = aircraftY + station.y - member.root.position.y;
      for (const arm of member.arms) {
        const { sign } = arm;
        const gripX = member.side
          ? (fuselageCrew ? member.side * station.grip - lateral + sign * .065 : sign * .174)
          : sign * .08 - lateral;
        arm.grip.set(gripX, gripY, station.z - station.aft + 0.056).divideScalar(member.scale);
        if (member.line) {
          arm.grip.x = .04 * sign;
          arm.grip.y += sign * .075;
        }
      }
      const footfall = poseRunner(member, speed, dt, action, age ? relax : null, weight, cos * slope, sin * slope, 1 - relax);
      if (footfall && speed > .1 && Number.isFinite(elapsed)) onFootfall?.(member.side, member.previousFootfall);

      for (const arm of member.arms) {
        const { sign } = arm;
        start.set(sign * .186, .45, 0).applyMatrix4(member.torso.matrix);
        target.copy(arm.grip).lerp(arm.freeHand, relax);
        reach(arm, start, target, pole.set(sign * .85, -1, .05));
      }
      member.gaze = member.head.rotation.x;
      if (member.line) {
        // A removable handling line stays with the runner after release.
        const upper = member.arms[1].end.position, lower = member.arms[0].end.position;
        start.set((member.side * sideStation.lateral - lateral) / member.scale,
          (aircraftY + renSparHeight(sideStation.lateral) - member.root.position.y) / member.scale, -station.aft / member.scale);
        start.lerp(target.copy(upper).addScaledVector(down, .54), relax);
        placeBone(member.line[0], start, upper, 1);
        placeBone(member.line[1], upper, lower, 1);
        target.copy(lower).addScaledVector(down, .25);
        target.z += .06 * Math.min(1, speed / 4);
        placeBone(member.line[2], lower, target, 1);
      }
    }
  }

  function answer(wing, seconds) {
    const side = wing === 'left' ? -1 : wing === 'right' ? 1 : 0;
    const nod = Math.sin(Math.PI * Math.min(1, seconds / 0.48)) ** 2;
    for (const member of members) {
      member.head.rotation.x = member.gaze
        + (side && member.side === side ? 0.19 * nod : 0);
    }
  }
  return { group, update, answer };
}
