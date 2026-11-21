import * as THREE from 'three';
import { propTurnsPerCrank } from '../../domain/ren-practice.js';
import { loadAircraftTemplate, matchingParts } from './model.js';
import { bindWingFlex } from './wing-flex.js';

const template = await loadAircraftTemplate('ren');

function bindPedals(root) {
  const crank = root.getObjectByName('pedal-crank');
  const [thighs, calves, shoes, knees] = ['cycling-thigh', 'cycling-calf', 'cycling-shoe', 'cycling-knee']
    .map(name => matchingParts(root, name));
  const legs = thighs.map((thigh, i) => ({ side: i ? 1 : -1, thigh, calf: calves[i], shoe: shoes[i], kneecap: knees[i] }));
  const up = new THREE.Vector3(0, 1, 0), hip = new THREE.Vector3(), foot = new THREE.Vector3();
  const knee = new THREE.Vector3(), delta = new THREE.Vector3();
  function limb(part, a, b) {
    part.position.copy(a).lerp(b, .5);
    delta.subVectors(b, a);
    part.scale.y = delta.length() / 2 + .018;
    part.quaternion.setFromUnitVectors(up, delta.normalize());
  }
  return crankAngle => {
    // +Z is aft. A rising crank at its top must travel toward the nose (-Z).
    const angle = -crankAngle;
    crank.rotation.x = angle;
    for (const { side, thigh, calf, shoe, kneecap } of legs) {
      hip.set(.112 * side, .169, -.08);
      foot.set(.112 * side, crank.position.y + side * .166 * Math.cos(angle),
        crank.position.z + side * .166 * Math.sin(angle) + .065);
      const dy = foot.y - hip.y;
      const dz = foot.z - hip.z;
      const span = Math.hypot(dy, dz);
      // Fit equal length femur and tibia, bending toward the windscreen.
      const bend = Math.sqrt(Math.max(0, .48 ** 2 - span ** 2 / 4));
      knee.copy(hip).lerp(foot, .5);
      knee.y -= bend * dz / span;
      knee.z += bend * dy / span;
      kneecap.position.copy(knee);
      limb(thigh, hip, knee);
      limb(calf, knee, foot);
      shoe.position.copy(foot);
      shoe.position.z -= .048;
      shoe.rotation.x = Math.PI / 2 - .38;
    }
  };
}

export function createRenAircraft() {
  const root = template.clone();
  const poseWing = bindWingFlex(root), poseLegs = bindPedals(root);
  const rotor = root.getObjectByName('propeller');
  const elevator = root.getObjectByName('elevator-hinge'), rudder = root.getObjectByName('rudder-hinge');
  root.getObjectByName('pilot').userData.setBodyOffset = () => {};
  root.userData.poseMechanisms = sample => {
    poseWing(sample);
    const angle = sample.propellerAngle ?? 0;
    rotor.rotation.z = angle;
    poseLegs(sample.crankAngle ?? angle / propTurnsPerCrank);
    elevator.rotation.x = -THREE.MathUtils.degToRad(sample.elevatorDeg ?? 0);
    rudder.rotation.y = THREE.MathUtils.degToRad(sample.rudderDeg ?? 0);
  };
  root.userData.poseMechanisms({});
  return root;
}
