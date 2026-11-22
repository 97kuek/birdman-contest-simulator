import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { propTurnsPerCrank } from '../../domain/ren-practice.js';
import { loadAircraftTemplate, matchingParts } from './model.js';
import { bindWingFlex } from './wing-flex.js';

const template = await loadAircraftTemplate('ren');

function bindPedals(root) {
  const crank = root.getObjectByName('pedal-crank');
  const [pedals, hips, thighs, calves, knees, ankles] = [
    'pedal', 'cycling-hip', 'cycling-thigh', 'cycling-calf', 'cycling-knee', 'cycling-ankle',
  ].map(name => matchingParts(root, name));
  const pilot = crank.parent;
  const meanPitch = (pedals[0].rotation.x + pedals[1].rotation.x) / 2;
  const legs = pedals.map((pedal, i) => ({
    pedal, hip: hips[i].position, thigh: thighs[i], calf: calves[i], knee: knees[i], ankle: ankles[i],
    pitchAmplitude: pedal.rotation.x - meanPitch,
  }));
  const foot = new THREE.Vector3(), delta = new THREE.Vector3(), bendDirection = new THREE.Vector3();
  const thighAxis = new THREE.Vector3(), shinAxis = new THREE.Vector3();
  const x = new THREE.Vector3(), z = new THREE.Vector3(), basis = new THREE.Matrix4();
  function orient(bone, axis) {
    // Use the bone roll authored in Blender, keeping the patella facing away from the seat.
    z.set(0, -axis.z, axis.y).normalize();
    x.crossVectors(axis, z);
    bone.quaternion.setFromRotationMatrix(basis.makeBasis(x, axis, z));
  }
  return crankAngle => {
    // The top of the crank moves toward the nose (-Z). The pedal bearing
    // lets the shoe pitch gently instead of turning over with the crank.
    crank.rotation.x = -crankAngle;
    for (const { pedal, hip, thigh, calf, knee, ankle, pitchAmplitude } of legs) {
      pedal.rotation.x = crankAngle + meanPitch + pitchAmplitude * Math.cos(crankAngle);
      pilot.worldToLocal(ankle.getWorldPosition(foot));
      delta.subVectors(foot, hip);
      const span = delta.length();
      const femur = thigh.userData.jointLength, tibia = calf.userData.jointLength;
      const along = (femur ** 2 - tibia ** 2 + span ** 2) / (2 * span);
      const bend = Math.sqrt(Math.max(0, femur ** 2 - along ** 2));
      bendDirection.set(0, -delta.z, delta.y).normalize();
      knee.position.copy(hip).addScaledVector(delta, along / span).addScaledVector(bendDirection, bend);
      thigh.position.copy(hip).lerp(knee.position, .5);
      calf.position.copy(knee.position).lerp(foot, .5);
      orient(thigh, thighAxis.subVectors(knee.position, hip).normalize());
      orient(calf, shinAxis.subVectors(foot, knee.position).normalize());
      orient(knee, delta.addVectors(thighAxis, shinAxis).normalize());
    }
  };
}

export function createRenAircraft() {
  const root = clone(template);
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
