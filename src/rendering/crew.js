import * as THREE from 'three';
import { LAUNCH, RAMP_LENGTH, rampAt } from '../domain/launch.js';
import { aircraftProfile } from '../domain/aircraft-profiles.js';
import { renSparHeight } from '../domain/ren-wing.js';
import { createCrewMembers } from './crew-model.js';
import layout from './biwa-platform.json' with { type: 'json' };
import { deckHeight, deckRun, deckSlope } from './launch-deck.js';

import { placeBone, poseRunner, reach } from './crew-motion.js';

const segment = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);

// Stop the runner before the curved lip, including the shoe and stride clearance.
function runnerReleaseTime(launch, startX, startZ) {
  function insideDeck(travel) {
    const x = startX + travel * launch.rightStep;
    const z = startZ - travel * launch.forwardStep;
    return Math.abs(x) < layout.deck_half_width - .39 && Math.hypot(x, Math.max(0, deckRun - z) + 0.52) < 9.87;
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
  return launch.timeAtTravel?.(stop) ?? Math.sqrt(2 * stop / launch.acceleration);
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
      poseRunner(member, gait, run, .12 * relax, -.34 - .18 * run + .16 * relax,
        cos * deckSlope, sin * deckSlope);

      const aircraftY = launch.edgeHeight + (RAMP_LENGTH - travel) * launch.dropStep + (launch.deckClearance ?? LAUNCH.deckClearance);
      const gripY = aircraftY + station.y - member.root.position.y;
      for (const arm of member.arms) {
        const { sign } = arm;
        start.set(sign * 0.186, 0.45, 0).applyMatrix4(member.torso.matrix);
        const gripX = member.side
          ? (fuselageCrew ? member.side * station.grip - lateral + sign * .065 : sign * .174)
          : sign * .08 - lateral;
        target.set(gripX, gripY, station.z - station.aft + 0.056).divideScalar(member.scale);
        if (member.line) {
          target.x = .04 * sign;
          target.y += sign * .075;
        }
        target.lerp(segment.set(sign * 0.22, 0.61, -0.16), relax);
        reach(arm, start, target, pole.set(sign * .85, -1, .05));
      }
      if (member.line) {
        // A removable handling line stays with the runner after release.
        const upper = member.arms[1].end.position, lower = member.arms[0].end.position;
        start.set((member.side * sideStation.lateral - lateral) / member.scale,
          (aircraftY + renSparHeight(sideStation.lateral) - member.root.position.y) / member.scale, -station.aft / member.scale);
        start.lerp(target.copy(upper).addScaledVector(down, .54), relax);
        placeBone(member.line[0], start, upper, 1);
        placeBone(member.line[1], upper, lower, 1);
        target.copy(lower).addScaledVector(down, .25);
        target.z += .06 * run;
        placeBone(member.line[2], lower, target, 1);
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
