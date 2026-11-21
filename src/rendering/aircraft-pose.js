import * as THREE from 'three';
import { CG_HEIGHT } from '../domain/aircraft-dynamics.js';
import { RADIANS_PER_DEGREE as radians } from '../domain/units.js';
import { bodyShiftFromCg } from '../domain/pilot-shift.js';

export function placeAircraft(modelBase, sample) {
  modelBase.rotation.set(sample.pitch, -sample.heading, -(sample.bank ?? 0), 'YXZ');
  const position = modelBase.position.set(0, -CG_HEIGHT, 0).applyEuler(modelBase.rotation);
  position.x += sample.right;
  position.y += sample.height;
  position.z -= sample.forward;
}

export function createAircraftPose({ modelBase, aircraft, crew, view, moveCamera, display }) {
  const rudder = aircraft.getObjectByName('rudder-hinge');
  const { setBodyOffset } = aircraft.getObjectByName('pilot').userData;
  const previousPosition = new THREE.Vector3(), cameraDelta = new THREE.Vector3();
  function pose(s) {
    display.update(s);
    const tracking = view() === 'aircraft';
    if (tracking) modelBase.getWorldPosition(previousPosition);
    setBodyOffset(s.bodyShift ?? bodyShiftFromCg(s.shift ?? 0));
    aircraft.userData.poseMechanisms?.(s);
    rudder.rotation.y = (s.rudderDeg ?? 0) * radians;
    placeAircraft(modelBase, s);
    if (tracking) moveCamera(modelBase.getWorldPosition(cameraDelta).sub(previousPosition));
  }
  function placeOnDeck(launch, sample) {
    crew.update(launch, 0);
    pose(sample);
  }
  return { pose, placeOnDeck, get sample() { return display.sample; } };
}
