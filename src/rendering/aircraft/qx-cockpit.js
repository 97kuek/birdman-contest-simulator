import * as THREE from 'three';
import { aircraftProfile } from '../../domain/aircraft-profiles.js';
import { pilotJumpLift, poseLaunchLegs } from './pilot-launch.js';
import { addRigidAssembly, bentTube, box, ellipsoid, rod, surfacePatch } from './mesh-parts.js';

const forwardAxis = new THREE.Vector3(0, 0, 1);
function limb(parent, a, b, radius, m, name) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const dir = end.clone().sub(start);
  const part = ellipsoid(parent, start.lerp(end, .5).toArray(),
    [radius, radius * .92, dir.length() * .5 + .011], m, name);
  part.quaternion.setFromUnitVectors(forwardAxis, dir.normalize());
  return part;
}

function joint(parent, name, x, y, z) {
  const part = new THREE.Group();
  part.name = name;
  part.position.set(x, y, z);
  parent.add(part);
  return part;
}

function pilotFigure(root, m) {
  const pilot = joint(root, 'pilot', 0, 0, 0);
  const moving = joint(pilot, 'pilot-weight-shift', 0, 0, 0);
  const torso = joint(moving, 'qx-pilot-torso', 0, .25, .04);
  const upperBody = new THREE.Group();
  upperBody.name = 'qx-flying-suit';
  ellipsoid(upperBody, [0, .018, -.28], [.161, .102, .31], m.suit, 'jersey');
  ellipsoid(upperBody, [0, -.009, -.015], [.145, .091, .153], m.pants, 'waist');
  ellipsoid(upperBody, [0, .058, -.565], [.069, .067, .104], m.skin, 'neck');
  ellipsoid(upperBody, [0, .111, -.68], [.082, .097, .084], m.skin, 'face');
  ellipsoid(upperBody, [0, .099, -.758], [.015, .017, .022], m.skin, 'nose');
  surfacePatch(upperBody, 'helmet', 32, 12, (u, v) => {
    const a = 2 * Math.PI * u, b = .007 + (1.8 + .5 * Math.sin(a)) * v;
    return [.1 * Math.cos(a) * Math.sin(b), .143 + .10 * Math.cos(b), -.661 + .112 * Math.sin(a) * Math.sin(b)];
  }, m.helmet);
  for (const sign of [-1, 1]) {
    const at = (x, y, z) => [sign*x, y, z];
    bentTube(upperBody, [at(.08, .16, -.72), at(.086, .10, -.704), at(.055, .044, -.709),
      at(.015, .032, -.706)], .006, m.carbon, 'chinstrap');
    ellipsoid(upperBody, at(.032,.128,-.756), [.013,.005,.004], m.carbon, 'eye');
    for (let i = 0; i < 3; i++) {
      ellipsoid(upperBody, at(.042,.230,-.69+i*.026), [.006,.003,.012], m.carbon, 'helmet-vent');
    }
    bentTube(upperBody, [at(.08,.104,-.48), at(.128,.110,-.36),
      at(.125,.099,-.22), at(.101,.079,-.108)], .008, m.gold, 'jersey-piping');
  }
  addRigidAssembly(torso, upperBody);
  joint(torso, 'pilot-eye', 0, .128, -.808);
  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const hip = joint(moving, 'pilot-hip', side*.083, .238, .085);
    const knee = joint(hip, 'pilot-knee', 0, 0, .395);
    limb(hip, [0,0,0], [0,0,.395], .071, m.pants, 'thigh');
    limb(knee, [0,0,0], [0,0,.37], .052, m.pants, 'calf');
    const shoe = joint(knee, 'ankle', 0, 0, .375);
    ellipsoid(shoe, [0, .008, -.045], [.043,.045,.10], m.shoe, 'running-shoe');
    box(shoe, [0, -.025,-.043], [.076,.013,.165], m.ivory, 'shoe-sole');
    legs.push({ hip, knee, shoe, side, thighLength:.395, calfLength:.375, thighAxis:0, calfAxis:0,
      standingHip:.075, footAngle:0, soleHeight:.037, rest:{height:.238,hip:.16,knee:-.56,shoe:.29} });

    const wrist = new THREE.Vector3(side * .172, .214, -.888);
    const shoulder = new THREE.Vector3(side*.131,.033,-.457);
    const upper = ellipsoid(pilot, [0,0,0], [.047,.047,1], m.suit, 'upper-arm');
    const lower = ellipsoid(pilot, [0,0,0], [.033,.033,1], m.skin, 'forearm');
    ellipsoid(pilot,[wrist.x,wrist.y,wrist.z-.017],[.025,.023,.048],m.skin,'hand');
    for (let j = 0; j < 4; j++) {
      const z = wrist.z - .035 + j * .012;
      bentTube(pilot, [[side*.190,.214,z],[side*.197,.195,z-.002],
        [side*.182,.186,z-.001],[side*.173,.192,z]], .0045, m.skin, 'finger');
    }
    arms.push({ shoulder, upper, lower, wrist });
  }

  const start = new THREE.Vector3(), elbow = new THREE.Vector3(), reach = new THREE.Vector3();
  const bend = new THREE.Vector3(), axis = new THREE.Vector3();
  function align(part, a, b) {
    axis.subVectors(b, a);
    part.scale.z = axis.length() * .5 + .011;
    part.position.copy(a).lerp(b, .5);
    part.quaternion.setFromUnitVectors(forwardAxis, axis.normalize());
  }
  function poseArms() {
    torso.updateMatrix();
    for (const { shoulder, upper, lower, wrist } of arms) {
      start.copy(shoulder).applyMatrix4(torso.matrix).add(moving.position);
      reach.subVectors(wrist, start);
      const d = reach.length();
      reach.divideScalar(d);
      const projection = THREE.MathUtils.clamp((d*d + .265**2 - .25**2) / (2*d), 0, .265);
      bend.set(Math.sign(shoulder.x) * .26, -.8, .5);
      bend.addScaledVector(reach, -bend.dot(reach)).normalize();
      elbow.copy(start).addScaledVector(reach, projection)
        .addScaledVector(bend, Math.sqrt(Math.max(0,.265**2 - projection**2)));
      align(upper, start, elbow);
      align(lower, elbow, wrist);
    }
  }
  pilot.userData.setBodyOffset = metres => {
    moving.position.z = THREE.MathUtils.clamp(metres, -.14, .14);
    poseArms();
  };
  const {deckClearance} = aircraftProfile('qx25');
  return (sample, weight) => {
    torso.rotation.x = .13 * weight;
    torso.position.y = .25 - .063 * weight + pilotJumpLift(weight);
    poseLaunchLegs(legs, sample, weight, deckClearance);
    poseArms();
  };
}

export function addQxCockpit(root, m) {
  const hardware = new THREE.Group();
  hardware.name = 'qx-cockpit';
  for (const side of [-1, 1]) {
    const at = (x,y,z) => [side*x,y,z];
    bentTube(hardware, [at(.105,.125,-1.38),at(.206,.095,-.94),at(.216,.096,-.38),
      at(.205,.117,.55),at(.135,.167,.99)], .015, m.aluminium, 'floor-longeron');
    bentTube(hardware,[at(.212,.105,-.55),at(.244,.254,-.54),at(.205,.461,-.52),
      at(.125,.515,-.50),at(0,.529,-.496)], .015, m.aluminium, 'canopy-hoop');
    rod(hardware, at(.20,.10,-.45), at(.203,.427,.20), .011, m.aluminium, 'wing-mount-diagonal');
    rod(hardware, at(.203,.427,.20), at(.181,.122,.59), .011, m.aluminium, 'aft-diagonal');
    rod(hardware, at(.17,.112,-.99), at(.17,.221,-.894), .012, m.aluminium, 'stick');
    rod(hardware, at(.17,.196,-.869), at(.17,.221,-.934), .016, m.shoe, 'stick-grip');
    bentTube(hardware, [at(.172,.113,-.99),at(.199,.099,-.66),at(.21,.096,-.43),
      at(.211,.12,.10)], .004, m.carbon, 'control-cable');
  }
  box(hardware,[0,.153,-.492],[.31,.053,.395],m.padding,'chest-rest');
  rod(hardware,[-.164,.164,.966],[.164,.164,.966],.014,m.carbon,'footrest');
  rod(hardware,[0,.101,-1.22],[0,.184,-1.265],.009,m.aluminium,'display-bracket');
  const panel = box(hardware,[0,.201,-1.27],[.16,.084,.019],m.carbon,'game-instrument-case');
  panel.rotation.x = -.30;
  const mount = joint(root, 'cockpit-display-mount', ...panel.position.toArray());
  mount.rotation.copy(panel.rotation);
  mount.translateZ(.010);
  addRigidAssembly(root, hardware);
  return pilotFigure(root, m);
}
