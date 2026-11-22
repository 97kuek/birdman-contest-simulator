import * as THREE from 'three';
import { CRUISE_AIRCRAFT } from '../domain/powered-cruise.js';
import { renSparHeight } from '../domain/ren-wing.js';
import { catcherRunSpeed, catcherStations, catcherVerge, predictedCatcherStation, waitingCatcher, wingGripSpan, rearCatchPoints } from '../domain/runway-support.js';
import { wingBendShape } from '../domain/wing-structure.js';
import { createCrewMembers, waitingCrewModel } from './crew-model.js';
import { poseRunner, reach, resetRunner } from './crew-motion.js';
import { createWingHandlingLine } from './wing-handling-line.js';
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
  name: side < 0 ? '左フレーム' : '右フレーム', side, x: side * .28,
  aft: 2.08, gripY: boomHeight, gripZ: 1.92, boom: true,
}));
const starterRoles = [catcherRoles[0], ...frameStarters, catcherRoles[2], catcherRoles[3]];
// Illustrative reaction time between wheel lift and the two wing handlers
// letting go together with the frame and tail starters after the push tapers.
const wingReleaseDelay = 1;
const start = new THREE.Vector3(), target = new THREE.Vector3(), pole = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0), localGrip = new THREE.Matrix4();

function poseMember(member, speed, dt, hold, modelBase, action, progress, weight = 0) {
  const { role, root } = member;

  if (hold && !role.wing) {
    root.updateMatrix();
    localGrip.copy(root.matrix).invert().multiply(modelBase.matrix);
  }
  if (!member.lastRoot) resetRunner(member);
  if (hold) {
    for (const arm of member.arms) {
      const { sign, grip } = arm;
      if (role.wing) grip.set(sign * .07, 1.33 + sign * .035, -.26);
      else if (role.name === 'テール' || role.boom) grip.set(role.side * .045, role.gripY - .03, role.gripZ + sign * .13).applyMatrix4(localGrip);
      else grip.set(sign * .027, role.gripY + sign * .055, role.gripZ).applyMatrix4(localGrip);
    }
  }
  poseRunner(member, speed, dt, action, progress, weight, 0, 0, hold);
  for (const arm of member.arms) {
    const sign = arm.sign;
    start.set(sign * .186, .45, 0).applyMatrix4(member.torso.matrix);
    target.copy(arm.freeHand);
    if (hold) {
      target.lerp(arm.grip, hold);
      if (hold >= 1) (arm.lastGrip ??= new THREE.Vector3()).copy(target);
    } else if (action === 'Release' && arm.lastGrip) {
      // Recoil relative to the departing runner. The aircraft continues ahead.
      target.lerp(arm.lastGrip, 1 - smoothstep(progress, 0, .45));
    }
    reach(arm, start, target, pole.set(sign * .85, -1, .05));
    arm.end.rotation.set(-.15 * (1 - hold), sign * (role.wing ? .90 : .48) * hold, sign * .19 * hold);
  }
}

export function wingLineAnchor(target, sample, station, modelBase) {
  const side = station < 0 ? 'left' : 'right';
  const bend = (sample.wing?.[side + 'Tip'] ?? 0) * wingBendShape('ren', Math.abs(station) / 16.1);
  return target.set(station, renSparHeight(station) + bend, 0).applyMatrix4(modelBase.matrix);
}

function runnerLineAnchor(member, sample, station, modelBase) {
  wingLineAnchor(target, sample, station, modelBase);
  return target.sub(member.root.position).applyAxisAngle(up, -member.root.rotation.y).divideScalar(member.scale);
}

function move(member, x, forward, seconds, turn) {
  const position = member.root.position;
  const dx = x - position.x, df = forward + position.z;
  const distance = Math.hypot(dx, df);
  if (turn && distance > .001) turnTo(member, -Math.atan2(dx, df), seconds);
  position.set(x, 0, -forward);
  return seconds ? distance / seconds : 0;
}

function turnTo(member, heading, seconds) {
  const delta = heading - member.root.rotation.y;
  member.root.rotation.y += clamp(Math.atan2(Math.sin(delta), Math.cos(delta)), -5 * seconds, 5 * seconds);
}

export function createRunwayCrew(crewModel, van) {
  const group = new THREE.Group();
  group.name = '富士川の地上班';
  const members = createCrewMembers(crewModel, 'ren', starterRoles.length + catcherRoles.length * catcherStations.length);
  const starters = members.slice(0, starterRoles.length), catchers = members.slice(starterRoles.length);
  const car = createRunwaySupportCar(van);
  group.add(...members.map(member => member.root), car.group);
  const waitingModels = new Map();
  for (const [i, member] of members.entries()) {
    const catcherIndex = i - starterRoles.length;
    const role = catcherIndex < 0 ? starterRoles[i] : catcherRoles[catcherIndex % catcherRoles.length];
    member.role = role;
    if (!role.wing) {
      member.scale *= 1.055;
      member.root.scale.setScalar(member.scale);
    }
    for (const arm of member.arms) arm.end.name = arm.sign < 0 ? '左手' : '右手';
    member.root.name = role.name + (catcherIndex < 0 ? 'スターター' : 'キャッチャー');
    if (role.wing) member.line = createWingHandlingLine(crewModel, member);
    if (catcherIndex < 0) continue;
    if (member.line) member.line.mesh.visible = false;
    member.station = catcherStations[Math.floor(catcherIndex / catcherRoles.length)];
    member.root.name += '・' + member.station + 'm';
    poseMember(member, 0, 0, 0);
    if (!waitingModels.has(member.phase)) waitingModels.set(member.phase, waitingCrewModel(member));
    member.waiting = waitingModels.get(member.phase).clone();
    member.waiting.name = member.root.name + '・待機';
    member.waiting.scale.copy(member.root.scale);
    group.add(member.waiting);
  }

  let last, receiver, wingRelease, initialForward, carSpeed = 0;
  let starterRight, starterHeading;
  function reset(sample) {
    initialForward = sample.forward;
    starterRight = sample.right;
    starterHeading = sample.heading;
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
      if (member.line) member.line.mesh.visible = false;
      member.waiting.visible = true;
    }
    for (const member of members) {
      resetRunner(member);
      member.catchAge = 0;
      member.releaseAnchor = null;
      for (const arm of member.arms) arm.lastGrip = null;
    }
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
        wingRelease = { at, speed: sample.groundSpeed, forward: sample.liftOffForward + (sample.forward - sample.liftOffForward) * fraction };
      }
    }
    if (!wingRelease && sample.liftOffAt == null && sample.starterReleasedAt != null && sample.groundSpeed < .05) {
      wingRelease = { at: elapsed, speed: 0, forward: sample.forward };
    }
    if (!wingRelease || elapsed - wingRelease.at <= dt && dt < .5) {
      starterRight = sample.right;
      starterHeading = sample.heading;
    }
    const cos = Math.cos(starterHeading), sin = Math.sin(starterHeading);
    for (const member of starters) {
      const { side, x, aft, wing } = member.role;
      const release = wingRelease?.forward;
      const free = release != null;
      const age = free ? Math.max(0, elapsed - wingRelease.at) : 0;
      const relax = smoothstep(age, 0, .65);
      const coast = (wingRelease?.speed ?? 0) * 1.1 * (1 - Math.exp(-age / 1.1));
      const follow = Math.min(Math.max(0, sample.forward - (release ?? sample.forward)),
        5.8 * Math.min(age, 16) + 4 * (1 - Math.exp(-Math.max(0, age - 16))));
      const along = (free ? (wing ? follow : coast) : 0) - aft;
      const outward = wing ? Math.min(5.8, age * .68) : Math.min(19 - Math.abs(x), Math.max(0, age - .35) * 2.7);
      const lateral = x + side * outward;
      const right = starterRight + lateral * cos + along * sin;
      const forward = (release ?? sample.forward) - lateral * sin + along * cos;
      if (!free) member.root.rotation.y = -starterHeading + (wing ? 0 : side * .92);
      const speed = move(member, right, forward, dt, free);
      const action = free ? 'Release' : 'Push';
      const weight = free ? 1 - smoothstep(age, .50, .90)
        : (member.role.name === 'テール' ? .25 : .53 + .47 * smoothstep(sample.starterForceN, 0, 90));
      poseMember(member, speed, dt, free ? 0 : 1, modelBase, action, free ? relax : null, weight);
      if (wing) {
        member.line.mesh.visible = !free || age < .55;
        if (member.line.mesh.visible) {
          if (!free || !member.releaseAnchor) {
            (member.releaseAnchor ??= new THREE.Vector3()).copy(runnerLineAnchor(member, sample, x, modelBase));
          }
          member.line.pose(member.releaseAnchor, smoothstep(age, 0, .55), speed);
        }
      }
    }
  }

  function approach(sample, dt, modelBase) {
    for (const member of catchers) {
      const { side, stationOffset } = member.role;
      const waiting = waitingCatcher(member.station, side, stationOffset, sample.forward);
      const jogging = waiting.forward > member.station + stationOffset && waiting.forward < member.station + stationOffset + 18;
      const runner = sample.catchers?.station === member.station
        ? sample.catchers[member.role.key ?? (side < 0 ? 'left' : 'right')] : null;
      const position = runner ?? waiting;
      const speed = move(member, position.right, position.forward, dt, true);
      member.root.visible = Boolean(runner) || jogging;
      member.waiting.visible = !member.root.visible;
      member.waiting.position.copy(member.root.position);
      if (member.root.visible) poseMember(member, speed, dt, 0, modelBase);
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
      const station = side * wingGripSpan;
      target.set(role.wing ? station : role.x, 0, role.wing ? .28 : role.aft).applyMatrix4(modelBase.matrix);
      const person = sample.catchers?.[role.wing ? (side < 0 ? 'left' : 'right') : role.key];
      const x = slow ? target.x : side * catcherVerge;
      const forward = slow ? -target.z : sample.forward + 6 + role.stationOffset;
      const dx = x - root.position.x, df = forward + root.position.z;
      const distance = Math.hypot(dx, df);
      const fraction = Math.min(1, dt * catcherRunSpeed / (distance || 1));
      const speed = move(member, person ? person.right : root.position.x + dx * fraction,
        person ? person.forward : -root.position.z + df * fraction, dt, !person?.holding && distance > 1.35);
      const hold = person ? Number(person.holding) : slow ? 1 - smoothstep(distance, .35, 1) : 0;
      const remaining = Math.hypot(target.x - root.position.x, target.z - root.position.z);
      const reaching = !hold ? 1 - smoothstep(remaining, .25, 1.35) : 0;
      if (hold || reaching) turnTo(member, -sample.heading + (role.wing ? 0 : side * .92), dt);
      member.catchAge = hold ? member.catchAge + dt : 0;
      const absorb = clamp(member.catchAge / .65, 0, 1);
      poseMember(member, speed, dt, hold || reaching * .65, modelBase, 'Catch', absorb,
        hold ? .65 + .35 * smoothstep(speed, .1, 2) : reaching);
      if (role.wing) {
        member.line.mesh.visible = hold > .95;
        if (member.line.mesh.visible) member.line.pose(runnerLineAnchor(member, sample, station, modelBase), 0, speed);
      }
    }
  }

  function followCar(sample, phase, dt) {
    if (dt <= 0) return;
    // Stay behind the tail on the aircraft's track. Keep the rear team and
    // the waiting catchers clear even if the aircraft stops just after launch.
    const collecting = phase === 'landed' && sample.catchers?.tail.holding && sample.catchers?.frame.holding;
    const gap = collecting ? 20 : initialForward - 2.7;
    const desiredX = clamp(sample.right, -12.5, 12.5);
    let desiredForward = sample.forward - gap;
    for (const member of members) {
      const here = member.root.position;
      if (Math.abs(here.x - desiredX) < 2.4 && -here.z > -car.group.position.z)
        desiredForward = Math.min(desiredForward, -here.z - 4.5);
    }
    const room = Math.max(0, desiredForward + car.group.position.z);
    // Match the aircraft on the runway. After the crew secure the stationary
    // plane the driver can approach at walking speed, still behind the tail.
    const targetSpeed = collecting ? Math.min(1.6, room / 1.2) : Math.min(11, sample.groundSpeed + room / 2);
    const nextSpeed = carSpeed + clamp(targetSpeed - carSpeed, -2.4 * dt, 1.8 * dt);
    const step = Math.min(room, (carSpeed + nextSpeed) * .5 * dt);
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
    followCar(sample, phase, dt);
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
