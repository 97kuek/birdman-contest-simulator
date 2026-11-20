import * as THREE from 'three';
import { CRUISE_AIRCRAFT } from '../domain/powered-cruise.js';
import { renSparHeight } from '../domain/ren-wing.js';
import { catcherRunSpeed, catcherStations, catcherVerge, predictedCatcherStation, waitingCatcher, rearCatchPoints } from '../domain/runway-support.js';
import { wingBendShape } from '../domain/wing-structure.js';
import { createCrewMembers, standingCrewGeometry } from './crew-model.js';
import { placeBone, poseRunner, reach } from './crew-motion.js';
import { createRunwaySupportCar } from './runway-support-car.js';

const { clamp, smoothstep } = THREE.MathUtils;
const boomHeight = CRUISE_AIRCRAFT.ren.shaftHeight;
const catcherRoles = [
  { name: '左翼', side: -1, x: -13.2, aft: .45, wing: true, stationOffset: 0 },
  { name: 'フレーム', ...rearCatchPoints.frame, key: 'frame', x: rearCatchPoints.frame.right, gripY: 1.17, gripZ: .67, stationOffset: rearCatchPoints.frame.offset },
  { name: 'テール', ...rearCatchPoints.tail, key: 'tail', x: rearCatchPoints.tail.right, gripY: CRUISE_AIRCRAFT.ren.shaftHeight, gripZ: 5.75, stationOffset: rearCatchPoints.tail.offset },
  { name: '右翼', side: 1, x: 13.2, aft: .45, wing: true, stationOffset: 0 },
];
const frameStarters = [-1, 1].map(side => ({
  name: side < 0 ? '左フレーム' : '右フレーム', side, x: side * .37,
  aft: 2.20, gripY: boomHeight, gripZ: 1.92, boom: true,
}));
const starterRoles = [catcherRoles[0], ...frameStarters, catcherRoles[2], catcherRoles[3]];
const catcherWingStation = 12.5;
// Illustrative reaction time between wheel lift and the two wing handlers
// letting go together with the frame and tail starters after the push tapers.
const wingReleaseDelay = 1;
const start = new THREE.Vector3(), target = new THREE.Vector3(), pole = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0), localGrip = new THREE.Matrix4();
const ropeShape = new THREE.CylinderGeometry(.014, .014, 1, 5).translate(0, -.5, 0);
const ropeMaterial = new THREE.MeshStandardMaterial({ color: '#c5923b', roughness: 1 });

function addLine(member) {
  member.line = new THREE.Mesh(ropeShape, ropeMaterial);
  member.line.name = '翼の保持索';
  member.root.add(member.line);
}

function poseMember(member, speed, hold, modelBase, effort = 0, braking = 0) {
  const { role, root } = member;
  const run = clamp(speed / 4.1, 0, 1);
  const gait = member.phase + member.travel * Math.PI / (member.scale * (.82 + .30 * run));
  const overhead = hold && role.name === 'テール';
  poseRunner(member, gait, run, .035 * hold, overhead ? -.04 - .08 * run : -.09 - .16 * run - .12 * hold - .16 * effort + .35 * braking);
  if (hold && !role.wing) {
    root.updateMatrix();
    localGrip.copy(root.matrix).invert().multiply(modelBase.matrix);
  }
  for (const arm of member.arms) {
    const sign = arm.sign;
    start.set(sign * .186, .45, 0).applyMatrix4(member.torso.matrix);
    target.set(sign * .207, .72 + .10 * run, -.10 - .30 * sign * Math.sin(gait) * run);
    if (hold) {
      // Both hands meet the rear cockpit pylon or the fixed tail boom.
      // The two wing handlers grasp a line suspended from the moving spar.
      if (role.wing) pole.set(sign * .07, 1.33 + sign * .035, -.26);
      else if (role.name === 'テール' || role.boom) pole.set(role.side * .045, role.gripY - .03, role.gripZ + sign * .13).applyMatrix4(localGrip);
      else pole.set(sign * .027, role.gripY + sign * .055, role.gripZ).applyMatrix4(localGrip);
      target.lerp(pole, hold);
    }
    reach(arm, start, target, pole.set(sign * .55, -.28, .8));
  }
}

function holdWing(member, sample, station, modelBase) {
  const side = station < 0 ? 'left' : 'right';
  const bend = (sample.wing?.[side + 'Tip'] ?? 0) * wingBendShape('ren', Math.abs(station) / 16.1);
  target.set(station, renSparHeight(station) + bend, 0).applyMatrix4(modelBase.matrix);
  target.sub(member.root.position).applyAxisAngle(up, -member.root.rotation.y).divideScalar(member.scale);
  placeBone(member.line, member.arms[1].end.position, target, 1);
}

function move(member, x, forward, seconds, turn) {
  const position = member.root.position;
  const dx = x - position.x, df = forward + position.z;
  const distance = Math.hypot(dx, df);
  member.travel += distance;
  if (turn && distance > .001) member.root.rotation.y = -Math.atan2(dx, df);
  position.set(x, 0, -forward);
  return seconds ? distance / seconds : 0;
}

export function createRunwayCrew() {
  const group = new THREE.Group();
  group.name = '富士川の地上班';
  const members = createCrewMembers('ren', starterRoles.length + catcherRoles.length * catcherStations.length);
  const starters = members.slice(0, starterRoles.length), catchers = members.slice(starterRoles.length);
  const car = createRunwaySupportCar();
  group.add(...members.map(member => member.root), car.group);
  const waitingGeometry = new Map();
  for (const [i, member] of members.entries()) {
    const catcherIndex = i - starterRoles.length;
    const role = catcherIndex < 0 ? starterRoles[i] : catcherRoles[catcherIndex % catcherRoles.length];
    member.role = role;
    for (const arm of member.arms) arm.end.name = arm.sign < 0 ? '左手' : '右手';
    member.travel = 0;
    member.root.name = role.name + (catcherIndex < 0 ? 'スターター' : 'キャッチャー');
    if (role.wing) addLine(member);
    if (catcherIndex < 0) continue;
    if (member.line) member.line.visible = false;
    member.station = catcherStations[Math.floor(catcherIndex / catcherRoles.length)];
    member.root.name += '・' + member.station + 'm';
    poseMember(member, 0, 0);
    if (!waitingGeometry.has(member.phase)) waitingGeometry.set(member.phase, standingCrewGeometry(member));
    member.waiting = new THREE.Mesh(waitingGeometry.get(member.phase), member.torso.material);
    member.waiting.name = member.root.name + '・待機';
    member.waiting.scale.copy(member.root.scale);
    member.waiting.castShadow = true;
    group.add(member.waiting);
  }

  let last, receiver, wingRelease, initialForward, carSpeed = 0;
  function reset(sample) {
    initialForward = sample.forward;
    receiver = null;
    wingRelease = null;
    for (const member of starters) {
      const { x, aft, wing, side } = member.role;
      member.root.position.set(x, 0, -(sample.forward - aft));
      member.root.rotation.y = wing ? 0 : side * .92;
    }
    for (const member of catchers) {
      const { side, stationOffset } = member.role;
      member.root.position.set(side * catcherVerge, 0, -(member.station + stationOffset));
      member.root.rotation.y = side * Math.PI * .55;
      member.waiting.position.copy(member.root.position);
      member.waiting.rotation.copy(member.root.rotation);
      member.root.visible = false;
      if (member.line) member.line.visible = false;
      member.waiting.visible = true;
    }
    for (const member of members) member.travel = 0;
    // Rear bumper just inside the south threshold, aligned behind the aircraft.
    car.group.position.set(0, 0, -2.7);
    car.group.rotation.y = 0;
    carSpeed = 0;
  }

  function depart(sample, elapsed, dt, modelBase) {
    if (!wingRelease && sample.liftOffAt != null) {
      const at = Math.min(sample.liftOffAt + wingReleaseDelay, sample.touchdownAt ?? Infinity);
      if (elapsed >= at) {
        // Interpolate the release station even when a tab skips the entire
        // takeoff. Both the animated hands and the call use this same event.
        const fraction = clamp((at - sample.liftOffAt) / Math.max(.001, sample.t - sample.liftOffAt), 0, 1);
        wingRelease = { at, forward: sample.liftOffForward + (sample.forward - sample.liftOffForward) * fraction };
      }
    }
    if (!wingRelease && sample.liftOffAt == null && sample.starterReleasedAt != null && sample.groundSpeed < .05) {
      wingRelease = { at: elapsed, forward: sample.forward };
    }
    for (const member of starters) {
      const { side, x, aft, wing } = member.role;
      const release = wingRelease?.forward;
      const free = release != null;
      const age = free ? Math.max(0, elapsed - wingRelease.at) : 0;
      const relax = smoothstep(age, 0, .65);
      const coast = 5 * (1 - Math.exp(-age / 1.3));
      const follow = Math.min(Math.max(0, sample.forward - (release ?? sample.forward)),
        5.8 * Math.min(age, 16) + 4 * (1 - Math.exp(-Math.max(0, age - 16))));
      const forward = (free ? release + (wing ? follow : coast) : sample.forward) - aft;
      const outward = wing ? Math.min(5.8, age * .68) : Math.min(19 - Math.abs(x), Math.max(0, age - .35) * 2.7);
      const speed = move(member, x + side * outward, forward, dt, free);
      poseMember(member, speed, 1 - relax, modelBase, smoothstep(sample.starterForceN, 0, 90));
      if (wing) {
        member.line.visible = !free;
        if (!free) holdWing(member, sample, x, modelBase);
      }
    }
  }

  function approach(sample, dt, modelBase) {
    for (const member of catchers) {
      const { side, stationOffset } = member.role;
      const waiting = waitingCatcher(member.station, side, stationOffset, sample.forward);
      const jogging = waiting.forward > member.station + stationOffset && waiting.forward < member.station + stationOffset + 18;
      const speed = move(member, waiting.right, waiting.forward, dt, true);
      member.root.visible = jogging;
      member.waiting.visible = !jogging;
      member.waiting.position.copy(member.root.position);
      if (jogging) poseMember(member, speed, 0, modelBase);
    }
  }
  function receive(sample, phase, dt, modelBase) {
    receiver ??= sample.catchers?.station ?? predictedCatcherStation(sample);
    for (const member of catchers) {
      if (member.station !== receiver) {
        member.root.visible = false;
        member.waiting.visible = true;
        member.waiting.position.copy(member.root.position);
        continue;
      }
      const { role, root } = member;
      member.waiting.visible = false;
      root.visible = true;
      const side = role.side;
      const slow = phase === 'landed' || sample.groundSpeed < 2;
      const station = side * catcherWingStation;
      target.set(role.wing ? station : role.x, 0, role.wing ? .28 : role.aft).applyMatrix4(modelBase.matrix);
      const person = sample.catchers?.[role.wing ? (side < 0 ? 'left' : 'right') : role.key];
      const x = slow ? target.x : side * catcherVerge;
      const forward = slow ? -target.z : sample.forward + 6 + role.stationOffset;
      const dx = x - root.position.x, df = forward + root.position.z;
      const distance = Math.hypot(dx, df);
      const fraction = Math.min(1, dt * catcherRunSpeed / (distance || 1));
      const speed = move(member, person ? person.right : root.position.x + dx * fraction,
        person ? person.forward : -root.position.z + df * fraction, dt, true);
      const hold = person ? Number(person.holding) : slow ? 1 - smoothstep(distance, .35, 1) : 0;
      if (hold) root.rotation.y = -sample.heading + (role.wing ? 0 : side * .92);
      poseMember(member, speed, hold, modelBase, 0, !role.wing && person?.holding ? smoothstep(sample.groundSpeed, 0, 1) : 0);
      if (role.wing) {
        member.line.visible = hold > .95;
        if (member.line.visible) holdWing(member, sample, station, modelBase);
      }
    }
  }

  function followCar(sample, dt) {
    // Stay behind the tail on the aircraft's track. Keep the rear team and
    // the waiting catchers clear even if the aircraft stops just after launch.
    const gap = initialForward - 2.7;
    const desiredX = clamp(sample.right, -12.5, 12.5);
    let desiredForward = sample.forward - gap;
    for (const member of members) {
      const here = member.root.position;
      if (Math.abs(here.x - desiredX) < 2.4 && -here.z > -car.group.position.z)
        desiredForward = Math.min(desiredForward, -here.z - 4.5);
    }
    const step = Math.min(Math.max(0, desiredForward + car.group.position.z), 11 * dt);
    // Steer towards a point ahead on the runway. Turning the aircraft's
    // rudder must not swivel a camera mounted in a separate vehicle.
    if (step > 0) {
      const yawGoal = -clamp(Math.atan2(desiredX - car.group.position.x, 18), -.22, .22);
      const yawLimit = Math.min(dt * .14, step * .035);
      car.group.rotation.y += clamp(yawGoal - car.group.rotation.y, -yawLimit, yawLimit);
    }
    const dx = -Math.tan(car.group.rotation.y) * step;
    car.group.position.x = clamp(car.group.position.x + dx, -12.5, 12.5);
    car.group.position.z -= step;
    carSpeed = dt ? Math.hypot(step, dx) / dt : 0;
    car.setDistance(-car.group.position.z, carSpeed);
  }

  function update(sample, phase, elapsed, modelBase) {
    if (phase === 'ready' || last == null || elapsed < last) {
      reset(sample);
      last = elapsed;
    }
    const dt = Math.max(0, elapsed - last);
    last = elapsed;
    modelBase.updateMatrix();
    depart(sample, elapsed, dt, modelBase);
    if (phase === 'flight') approach(sample, dt, modelBase);
    if (phase === 'landed' || phase === 'rollout') receive(sample, phase, dt, modelBase);
    followCar(sample, dt);
  }
  function answer(wing, seconds) {
    const responding = wing === 'left' ? -1 : wing === 'right' ? 1 : 0;
    const nod = Math.sin(Math.PI * Math.min(1, seconds / .48)) ** 2;
    for (const member of starters) {
      if (member.role.wing && member.role.side === responding) member.head.rotation.x += .22 * nod;
    }
  }
  return { group, update, answer, supportCar: car.group,
    get supportCarSpeed() { return carSpeed; }, get wingFollowersReleased() { return Boolean(wingRelease); } };
}
