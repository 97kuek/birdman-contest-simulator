import { BASE_DESIGN, CG_HEIGHT } from '../domain/flight.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const attachedModes = new Set(['pilot', 'boat', 'car']);
const blendSeconds = 1.6;
// In the Fujikawa cockpit film the far runway sits about 40% down the frame.
const runwayGazeDepression = THREE.MathUtils.degToRad(8);
const overviewScale = aspect => Math.max(1, 1.38 / aspect);

export function createFlightCamera({
  canvas, facility, modelBase, aircraft, boat, waterContact = () => false, trackBounds, preparing = () => true, visibleTrackFraction, reduceMotion, onViewChange,
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

  let mode = 'aircraft', hasView = false, transition = null;
  let framingSpan = BASE_DESIGN.span, runwayOverview = false, pilotEye, displayMount;
  function setAircraft(model) {
    pilotEye = model.getObjectByName('pilot-eye');
    displayMount = model.getObjectByName('cockpit-display-mount');
    const span = model.userData.wingSpan ?? BASE_DESIGN.span;
    if (hasView && mode === 'aircraft' && span !== framingSpan) zoom(span / framingSpan);
    framingSpan = span;
  }
  setAircraft(aircraft);
  const eye = new THREE.Vector3(), focus = new THREE.Vector3(), panelBottom = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  const horizonUp = new THREE.Vector3(0, 1, 0);
  const world = (x, y, z) => facility.localToWorld(new THREE.Vector3(x, y, z));
  let attachedZoom = 1, baseLens = 76;
  let viewportAspect = camera.aspect, carCameraMount;

  function setAttachedLens(degrees) {
    baseLens = degrees;
    const fov = THREE.MathUtils.clamp(baseLens * attachedZoom, (mode === 'car' || (mode === 'boat' && waterContact())) ? 5 : 25, 96);
    if (transition) transition.destinationFov = fov;
    else if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  function followPilot() {
    // Keep the lens just ahead of the face and move it with the prone pilot.
    modelBase.worldToLocal(pilotEye.getWorldPosition(eye));
    focus.copy(eye);
    focus.z -= 11.14;
    const shortLandscape = canvas.clientHeight > 0 && canvas.clientHeight <= 500 && camera.aspect > 1;
    const narrowPortrait = camera.aspect <= 1 && canvas.clientWidth <= 600;
    setAttachedLens(shortLandscape ? 48 : 76);
    let gazeDepression = runwayOverview ? runwayGazeDepression : 0;
    if (shortLandscape || narrowPortrait) {
      // Keep the lower edge of the physical LCD above touch controls and credits.
      // Only the gaze follows the panel. Its size still changes with eye distance.
      modelBase.worldToLocal(displayMount.localToWorld(panelBottom.set(0, -.042, 0)));
      const angleToPanel = Math.atan2(eye.y - panelBottom.y, eye.z - panelBottom.z);
      const screenLimit = shortLandscape ? .72 : .42;
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      gazeDepression = Math.max(gazeDepression, angleToPanel - Math.atan(screenLimit * Math.tan(halfFov)));
    }
    focus.y -= (eye.z - focus.z) * Math.tan(gazeDepression);
    camera.position.copy(modelBase.localToWorld(eye));
    controls.target.copy(modelBase.localToWorld(focus));
    camera.up.set(0, 1, 0).applyQuaternion(modelBase.getWorldQuaternion(orientation));
    if (waterContact()) {
      // A flooding cockpit can submerge or roll through vertical. Keep the
      // observer above the ripples, looking over the nose until the boat takes over.
      camera.position.y = Math.max(.65, camera.position.y);
      const ahead = controls.target.sub(camera.position);
      const horizontal = Math.hypot(ahead.x, ahead.z);
      ahead.y = THREE.MathUtils.clamp(ahead.y, -.08 * horizontal, .20 * horizontal);
      controls.target.add(camera.position);
      camera.up.copy(horizonUp);
    }
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
  }

  function followCar() {
    carCameraMount.getWorldPosition(camera.position);
    // Keep the horizon and dashboard steady. The lens turns with the vehicle.
    controls.target.copy(carCameraMount.localToWorld(focus.set(0, -.55, -24)));
    setAttachedLens(THREE.MathUtils.lerp(75, 54, THREE.MathUtils.smoothstep(camera.aspect, .55, 1.5)));
    camera.up.copy(horizonUp);
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
  }

  function followBoat() {
    boat.eye.getWorldPosition(camera.position);
    controls.target.copy(modelBase.localToWorld(focus.set(0, CG_HEIGHT, 0)));
    if (waterContact()) {
      // Frame the waterline and exposed wing from above the rail/helmsman,
      // even when the flooded fuselage's CG is well below the surface.
      camera.position.y = Math.max(camera.position.y, 1.85);
      controls.target.y = Math.max(.45, controls.target.y);
      const distance = camera.position.distanceTo(controls.target);
      const subjectWidth = framingSpan / .60;
      const fit = 2 * Math.atan(subjectWidth / (2 * Math.max(1, distance) * camera.aspect));
      setAttachedLens(THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(fit), 5, 88));
      controls.target.y -= distance * Math.tan(THREE.MathUtils.degToRad(baseLens / 2)) * .18;
      camera.up.copy(horizonUp);
      camera.lookAt(controls.target);
      camera.updateMatrixWorld();
      return;
    }
    // Leave the glider above centre, with some of the gunwale and water in the foreground.
    const range = Math.hypot(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
    // Hold the horizon through small height changes while keeping a climbing glider in shot.
    const aboveEye = controls.target.y - camera.position.y;
    const deadband = Math.min(1.8, range * .075);
    controls.target.y = camera.position.y - range * .065 +
      Math.sign(aboveEye) * Math.max(0, Math.abs(aboveEye) - deadband);
    // Widen the shot while alongside; a longer lens keeps a distant launch legible.
    const landscape = THREE.MathUtils.smoothstep(camera.aspect, 0.55, 1.3);
    const closeLens = THREE.MathUtils.lerp(73, 59, landscape);
    const distantLens = THREE.MathUtils.lerp(47, 38, landscape);
    setAttachedLens(THREE.MathUtils.lerp(closeLens, distantLens, THREE.MathUtils.smoothstep(range, 35, 100)));
    camera.up.set(0, 1, 0);
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
  }

  function captureView() {
    return {
      eye: camera.position.clone(), focus: controls.target.clone(), rotation: camera.quaternion.clone(),
      fov: camera.fov,
    };
  }

  function blendView() {
    if (!transition) return;
    const { from, start, destinationFov } = transition;
    const progress = THREE.MathUtils.smoothstep((performance.now() - start) / 1000, 0, blendSeconds);
    camera.position.lerp(from.eye, 1 - progress);
    camera.position.y += Math.sin(Math.PI * progress) * 1.4;
    if (mode === 'boat' && waterContact()) {
      camera.position.y = Math.max(.65, camera.position.y);
      camera.lookAt(controls.target);
    }
    camera.quaternion.slerp(from.rotation, 1 - progress);
    controls.target.lerp(from.focus, 1 - progress);
    camera.fov = THREE.MathUtils.lerp(from.fov, destinationFov, progress);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    if (progress === 1) transition = null;
  }

  function update() {
    if (mode === 'pilot') followPilot();
    else if (mode === 'boat') followBoat();
    else if (mode === 'car') followCar();
    else if (transition?.orbit) {
      // Rebuild the destination each frame before blending the outgoing boat view.
      camera.position.copy(transition.orbit.eye);
      controls.target.copy(transition.orbit.focus);
      camera.lookAt(controls.target);
      camera.updateMatrixWorld();
    } else controls.update();
    blendView();
  }

  function setView(nextMode) {
    const changingBoat = hasView && nextMode !== mode && (nextMode === 'boat' || mode === 'boat');
    const from = changingBoat && !reduceMotion.matches ? captureView() : null;
    transition = null;
    hasView = true;
    mode = nextMode;
    const attached = attachedModes.has(mode);
    controls.enabled = !attached;
    attachedZoom = 1;
    const wideRunway = runwayOverview && mode === 'aircraft' && viewportAspect < .85 && preparing();
    camera.fov = mode === 'pilot' ? 76 : wideRunway ? 86 : 38;
    camera.near = mode === 'pilot' || mode === 'car' ? 0.02 : 0.18;
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
      } else if (runwayOverview) {
        // Look north over the departure crew, with the complete span and the
        // support car in the part of the viewport left open by flight setup.
        // During starts and catches, look across the boom so both handlers show.
        const room = Math.max(.35, visibleTrackFraction());
        const distance = 43 / (2 * Math.tan(camera.fov * Math.PI / 360) * camera.aspect * room);
        const { x, y, z } = modelBase.position;
        const side = preparing() ? -.26 : -.32, rise = preparing() ? .11 : .19;
        controls.target.copy(world(x, y + .9, z));
        camera.position.copy(world(x + side * distance, y + .9 + rise * distance, z + distance));
      } else {
        const ratio = overviewScale(viewportAspect) * framingSpan / BASE_DESIGN.span;
        const { x, y, z } = modelBase.position;
        controls.target.copy(world(x - 0.65, y + 0.7, z - 0.2));
        camera.position.copy(world(x + 13 * ratio, y + 0.7 + 6.3 * ratio, z - 32 * ratio));
      }
    }
    update();
    if (from) {
      transition = { from, start: performance.now(), destinationFov: camera.fov, orbit: attached ? null : captureView() };
      blendView();
    }
    onViewChange(mode, attached);
  }

  function startLandingCamera() {
    if (mode !== 'boat') setView('boat');
  }

  function zoom(factor) {
    transition = null;
    if (attachedModes.has(mode)) {
      camera.fov = THREE.MathUtils.clamp(camera.fov * factor, (mode === 'car' || (mode === 'boat' && waterContact())) ? 5 : 25, 96);
      attachedZoom = camera.fov / baseLens;
      camera.updateProjectionMatrix();
      return;
    }
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance));
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }

  function setAspect(aspect) {
    const factor = overviewScale(aspect) / overviewScale(viewportAspect);
    viewportAspect = aspect;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    if (!hasView || mode !== 'aircraft' || factor === 1) return;
    if (runwayOverview) return setView('aircraft');
    // Fit the wing span after rotation while retaining the user's orbit and zoom.
    if (transition?.orbit) {
      const { eye, focus } = transition.orbit;
      eye.sub(focus).multiplyScalar(factor).add(focus);
    } else zoom(factor);
  }

  function moveCamera(delta) {
    camera.position.add(delta);
    controls.target.add(delta);
    if (transition?.orbit) {
      transition.orbit.eye.add(delta);
      transition.orbit.focus.add(delta);
    }
  }

  function setSite(site) {
    facility = site.facility;
    modelBase = site.modelBase;
    camera.far = site.far ?? 56000;
    runwayOverview = Boolean(site.runwayOverview);
    carCameraMount = site.supportCar?.getObjectByName('chase-car-camera');
    setAircraft(site.aircraft);
    setView('aircraft');
  }

  return { camera, setSite, setAircraft, view: () => mode, setView, setAspect, update, zoom, startLandingCamera, moveCamera };
}
