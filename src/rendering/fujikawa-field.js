import * as THREE from 'three';
import { loadVenueModel } from './authored-models.js';
import { createAircraftPose } from './aircraft-pose.js';
import { createCockpitDisplay } from './aircraft/display.js';
import { createRenAircraft } from './aircraft/ren-model.js';
import { loadAircraftTemplate } from './aircraft/model.js';
import { modelHull } from './collision-hull.js';
import { createSkyDome } from './sky.js';
import { createRunwayCrew } from './runway-crew.js';
import { addFujikawaTerrain } from './fujikawa-terrain.js';

export async function createFujikawaField(crewModel, cameraRig, describe) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.FogExp2(0xcad7d8, 0.000018);
  const sky = new THREE.HemisphereLight(0xfffaf0, 0xc4c7ad, 1.9);
  const sun = new THREE.DirectionalLight(0xfff4db, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 140 });
  sun.shadow.normalBias = .015;
  scene.add(sky, sun, sun.target);
  const [terrain, van, template] = await Promise.all([
    addFujikawaTerrain(scene),
    loadVenueModel('chase-van'), loadAircraftTemplate('ren'),
  ]);
  const { facility, landscape, riverTime } = terrain;
  const lightOffset = new THREE.Vector3(-35, 62, 28);
  const skyUniforms = { nightScene: { value: 0 }, sunlight: { value: lightOffset.clone().normalize() },
    clockTime: { value: 0 }, meanWind: { value: 1 }, windAngle: { value: 0 }, gust: { value: 0 } };
  const skyDome = createSkyDome(skyUniforms, .52);
  scene.add(skyDome);
  const terrainColours = new Map();
  landscape.traverse(part => {
    if (part.material?.isMeshBasicMaterial) terrainColours.set(part.material, part.material.color.clone());
  });
  const aircraft = createRenAircraft(template);
  const hull = modelHull(aircraft);
  const modelBase = new THREE.Group();
  modelBase.add(aircraft);
  const crew = createRunwayCrew(crewModel, van);
  facility.add(modelBase, crew.group);
  let stoppedAt, stoppedSeconds;
  const runway = facility.userData.runway;
  const display = createCockpitDisplay(aircraft, {
    aircraftId: 'ren', describe, runway, northInCourse: -THREE.MathUtils.degToRad(runway.trueBearingDegrees),
  });
  const { pose } = createAircraftPose({ modelBase, aircraft, view: cameraRig.view, moveCamera: cameraRig.moveCamera, display });
  const tint = new THREE.Color(0x7185a1);
  let period;
  function setWeather(weather) {
    const next = weather.split('-')[0];
    if (period === next) return;
    period = next;
    const night = next === 'night';
    skyUniforms.nightScene.value = night ? 1 : 0;
    scene.background.setHex(night ? 0x334960 : 0xb8d9ef);
    scene.fog.color.setHex(night ? 0x4b6079 : 0xcad7d8);
    sky.intensity = night ? .65 : 1.9;
    sky.color.setHex(night ? 0xb5cfff : 0xfffaf0);
    sun.color.setHex(night ? 0xb0cef8 : 0xfff4db);
    sun.intensity = night ? .9 : 2.3;
    for (const [material, colour] of terrainColours) {
      material.color.copy(colour);
      if (night) material.color.multiply(tint);
    }
  }
  return {
    facility, modelBase, aircraft, display, scene, far: 65000, runwayOverview: true,
    hull, supportCar: crew.supportCar, answer: crew.answer,
    get supportCarSpeed() { return crew.supportCarSpeed; },
    get wingFollowersReleased() { return crew.wingFollowersReleased; },
    setWeather,
    pose(sample, phase = 'ready', seconds = 0) {
      pose(sample);
      crew.update(sample, phase, seconds, modelBase);
      stoppedAt = phase === 'landed' ? performance.now() : null;
      stoppedSeconds = seconds;
      modelBase.getWorldPosition(sun.target.position);
      sun.position.copy(sun.target.position).add(lightOffset);
    },
    update(now) {
      riverTime.value = now / 1000;
      skyDome.position.copy(cameraRig.camera.position);
      skyUniforms.clockTime.value = now / 1000;
      if (stoppedAt == null) return;
      const seconds = Math.min(30, Math.max(0, (now - stoppedAt) / 1000));
      crew.update(display.sample, 'landed', stoppedSeconds + seconds, modelBase);
      if (seconds === 30) stoppedAt = null;
    },
  };
}
