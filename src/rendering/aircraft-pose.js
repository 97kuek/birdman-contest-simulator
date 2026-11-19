import * as THREE from 'three';
import { CG_HEIGHT } from '../domain/flight.js';

import { RADIANS_PER_DEGREE as radians } from '../domain/units.js';
const pilotTravelMetres = 0.47;

export function createAircraftPose({ modelBase, aircraft, crew, view, moveCamera, display }) {
  const rudder = aircraft.getObjectByName('rudder-hinge');
  const { setBodyOffset } = aircraft.getObjectByName('pilot').userData;
  const pilotBody = aircraft.getObjectByName('pilot-weight-shift');
  function pose(s) {
    display.update(s);
    const old = modelBase.getWorldPosition(new THREE.Vector3());
    const { right, forward, heading } = s;
    setBodyOffset(pilotTravelMetres * (s.shift ?? 0));
    rudder.rotation.y = (s.rudderDeg ?? 0) * radians;
    modelBase.rotation.set(s.pitch, -heading, -(s.bank ?? 0), 'YXZ');
    const offset = new THREE.Vector3(0, -CG_HEIGHT, 0).applyEuler(modelBase.rotation);
    modelBase.position.set(right, s.height, -forward).add(offset);
    if (view() === 'aircraft') moveCamera(modelBase.getWorldPosition(new THREE.Vector3()).sub(old));
  }
  function placeOnDeck(launch, sample) {
    crew.update(launch, 0);
    pose(sample);
  }
  function capture() {
    return {
      position: modelBase.position.clone(),
      rotation: modelBase.rotation.clone(),
      sample: display.sample,
      rudder: rudder.rotation.y,
      pilotZ: pilotBody.position.z,
    };
  }
  function restore(snapshot) {
    modelBase.position.copy(snapshot.position);
    modelBase.rotation.copy(snapshot.rotation);
    rudder.rotation.y = snapshot.rudder;
    setBodyOffset(snapshot.pilotZ);
    display.update(snapshot.sample);
  }
  return { pose, placeOnDeck, capture, restore };
}
