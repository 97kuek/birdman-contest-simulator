import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BASE_DESIGN } from '../domain/flight.js';

const attachedModes = new Set(['pilot', 'boat']);
const blendSeconds = 1.6;

export function createFlightCamera({
  canvas, facility, modelBase, aircraft, span, atWater, trackBounds, visibleTrackFraction, reduceMotion, onViewChange,
}) {
  const camera = new THREE.PerspectiveCamera(38, 1, 0.18, 56000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 2.8;
  controls.maxDistance = 4800;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.7;

  const pilotBody = aircraft.getObjectByName('pilot-weight-shift');
  const eye = new THREE.Vector3(), focus = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  const world = (x, y, z) => facility.localToWorld(new THREE.Vector3(x, y, z));
  let mode = 'aircraft', boatApproach = 0, boatTime = 0, boatTransition = null;

  function followPilot() {
    // Keep the lens just ahead of the face and move it with the prone pilot.
    eye.set(0, 0.304, -0.86 + pilotBody.position.z);
    focus.set(0, 0.304, -12 + pilotBody.position.z);
    camera.position.copy(modelBase.localToWorld(eye));
    controls.target.copy(modelBase.localToWorld(focus));
    camera.up.set(0, 1, 0).applyQuaternion(modelBase.getWorldQuaternion(orientation));
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
  }

  function followBoat() {
    const now = performance.now();
    const landed = atWater();
    boatApproach = landed ? Math.min(1, boatApproach + Math.min(100, now - boatTime) / 3500) : 0;
    boatTime = now;
    const { x, z } = modelBase.position;
    const reach = Math.max(1, 1.05 / camera.aspect);
    eye.set(x + 19 * reach, 1.65, z - 33 * reach);
    if (landed) {
      // Stay alongside the glider after contact, including on narrow displays.
      const heading = -modelBase.rotation.y;
      const scale = THREE.MathUtils.clamp(span / BASE_DESIGN.span, 0.85, 1.2);
      const side = 19 * scale, ahead = 9 * scale;
      focus.set(x + side * Math.cos(heading) + ahead * Math.sin(heading), 2.1,
        z + side * Math.sin(heading) - ahead * Math.cos(heading));
      eye.lerp(focus, THREE.MathUtils.smoothstep(boatApproach, 0, 1));
    }
    camera.position.copy(facility.localToWorld(eye));
    controls.target.copy(modelBase.localToWorld(focus.set(0, 0.45, 0)));
    camera.up.set(0, 1, 0);
    camera.lookAt(controls.target);

    if (boatTransition) {
      const from = boatTransition;
      const progress = THREE.MathUtils.smoothstep((now - from.start) / 1000, 0, blendSeconds);
      camera.position.lerp(from.eye, 1 - progress);
      camera.position.y += Math.sin(Math.PI * progress) * 1.4;
      camera.quaternion.slerp(from.rotation, 1 - progress);
      controls.target.lerp(from.focus, 1 - progress);
      camera.fov = THREE.MathUtils.lerp(from.fov, 45, progress);
      camera.updateProjectionMatrix();
      if (progress === 1) boatTransition = null;
    }
    camera.updateMatrixWorld();
  }

  function update() {
    if (mode === 'pilot') followPilot();
    else if (mode === 'boat') followBoat();
    else controls.update();
  }

  function setView(nextMode) {
    boatTransition = null;
    mode = nextMode;
    const attached = attachedModes.has(mode);
    controls.enabled = !attached;
    camera.fov = mode === 'pilot' ? 76 : attached ? 45 : 38;
    camera.near = mode === 'pilot' ? 0.02 : 0.18;
    camera.updateProjectionMatrix();
    if (!attached) {
      camera.up.set(0, 1, 0);
      if (mode === 'tracks') {
        const bounds = trackBounds();
        const forward = (bounds.far + bounds.near) / 2, right = (bounds.left + bounds.right) / 2;
        const extent = Math.max(45, bounds.far - bounds.near);
        const horizontal = Math.tan(camera.fov * Math.PI / 360) * camera.aspect;
        const distance = Math.max(35, extent * 0.59 / (horizontal * Math.max(0.32, visibleTrackFraction())));
        controls.target.copy(world(right, 4, -forward));
        camera.position.copy(world(bounds.right + distance, 4 + distance * 0.3, -forward + distance * 0.08));
      } else {
        const ratio = Math.max(1, 1.38 / camera.aspect);
        const { x, y, z } = modelBase.position;
        controls.target.copy(world(x - 0.65, y + 0.7, z - 0.2));
        camera.position.copy(world(x + 13 * ratio, y + 0.7 + 6.3 * ratio, z - 32 * ratio));
      }
    }
    update();
    onViewChange(mode, attached);
  }

  function startLandingCamera() {
    const from = {
      eye: camera.position.clone(), focus: controls.target.clone(), rotation: camera.quaternion.clone(),
      fov: camera.fov, start: performance.now(),
    };
    boatApproach = 1;
    setView('boat');
    if (!reduceMotion.matches) boatTransition = from;
  }

  function zoom(factor) {
    if (attachedModes.has(mode)) {
      camera.fov = THREE.MathUtils.clamp(camera.fov * factor, 25, 96);
      camera.updateProjectionMatrix();
      return;
    }
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance));
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }

  function moveCamera(delta) {
    camera.position.add(delta);
    controls.target.add(delta);
  }

  const north = new THREE.Vector3(), center = new THREE.Vector3();
  function compassBearing() {
    center.copy(controls.target).project(camera);
    north.copy(controls.target);
    north.z -= 1;
    north.project(camera);
    return Math.atan2((north.x - center.x) * camera.aspect, north.y - center.y);
  }

  return { camera, view: () => mode, setView, update, zoom, startLandingCamera, moveCamera, compassBearing };
}
