import * as THREE from 'three';
import { CG_HEIGHT } from '../domain/flight.js';

import { RADIANS_PER_DEGREE as radians } from '../domain/units.js';
import { bodyShiftFromCg } from '../domain/pilot-shift.js';

export function createAircraftPose({ modelBase, aircraft, crew, view, moveCamera, display }) {
  const rudder = aircraft.getObjectByName('rudder-hinge');
  const { setBodyOffset } = aircraft.getObjectByName('pilot').userData;
  const old = new THREE.Vector3(), offset = new THREE.Vector3();
  function pose(s) {
    display.update(s);
    const tracking = view() === 'aircraft';
    if (tracking) modelBase.getWorldPosition(old);
    const { right, forward, heading } = s;
    setBodyOffset(s.bodyShift ?? bodyShiftFromCg(s.shift ?? 0));
    aircraft.userData.poseMechanisms?.(s);
    rudder.rotation.y = (s.rudderDeg ?? 0) * radians;
    modelBase.rotation.set(s.pitch, -heading, -(s.bank ?? 0), 'YXZ');
    offset.set(0, -CG_HEIGHT, 0).applyEuler(modelBase.rotation);
    modelBase.position.set(right, s.height, -forward).add(offset);
    if (tracking) moveCamera(modelBase.getWorldPosition(offset).sub(old));
  }
  function placeOnDeck(launch, sample) {
    crew.update(launch, 0);
    pose(sample);
  }
  return { pose, placeOnDeck, get sample() { return display.sample; } };
}
