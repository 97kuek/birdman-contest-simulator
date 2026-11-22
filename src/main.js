import * as THREE from 'three';
import { FlightSession } from './application/flight-session.js';
import { isOnPavement } from './domain/runway-support.js';
import { createShoreline } from './domain/shoreline.js';
import { WIND_GRID_SIZE } from './domain/lake-breeze.js';
import { WEATHER, windAt } from './domain/weather.js';
import { byId } from './presentation/dom.js';
import { setupFlightSound } from './presentation/flight-sound.js';
import { selectedWeather, setupTrials } from './presentation/flight-screen.js';
import { bindViewerControls, setupViewerShell, showCameraMode, trackViewportFraction } from './presentation/viewer-shell.js';
import { createAircraftPose } from './rendering/aircraft-pose.js';
import { createCockpitDisplay } from './rendering/aircraft/display.js';
import { createDaylight } from './rendering/daylight.js';
import { createPracticeBuoys } from './rendering/practice-buoys.js';
import { createChaseBoat } from './rendering/chase-boat.js';
import { modelHull } from './rendering/collision-hull.js';
import { loadAuthoredModel, loadVenueModel } from './rendering/authored-models.js';
import { createLaunchCrew } from './rendering/crew.js';
import { createFlightCamera } from './rendering/flight-camera.js';
import { createFlightTrail } from './rendering/flight-trail.js';
import { addLakeAndSky, lakeReflectionLayer, sunDirection } from './rendering/lake.js';
import { addLandscape } from './rendering/landscape.js';
import { deckHeight } from './rendering/launch-deck.js';
import { createFlagInset } from './presentation/flag-inset.js';
import { createPlatformFlag } from './rendering/platform-flag.js';
import { createPlatform } from './rendering/platform.js';

setupViewerShell();
const sound = setupFlightSound();
const host = byId('canvas-host');
const status = byId('loading');
const drawWindOffset = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 * WIND_GRID_SIZE;

function release(group) {
  const geometries = new Set(), materials = new Set();
  group.traverse(part => {
    if (part.geometry) geometries.add(part.geometry);
    if (part.material) {
      for (const material of [].concat(part.material)) materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

function enableReflection(group) {
  group.traverse(part => part.layers.enable(lakeReflectionLayer));
}

async function start() {
  const renderer = new THREE.WebGLRenderer({
    antialias: true, alpha: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance',
  });
  host.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', '機体と松原湖岸の3Dモデル。ドラッグで回転、ホイールで拡大縮小');
  const compact = matchMedia('(pointer:coarse) and (max-width:1000px)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, compact ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb7d6de);
  scene.fog = new THREE.FogExp2(0xd2dfda, 0.00009);
  const ambient = new THREE.HemisphereLight(0xfffaf0, 0xb5cfcf, 2.15);
  ambient.layers.enable(lakeReflectionLayer);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
  sun.position.copy(sunDirection).multiplyScalar(60);
  sun.layers.enable(lakeReflectionLayer);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 0.5, far: 120 });
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.normalBias = 0.017;
  sun.shadow.bias = -0.00022;
  scene.add(sun);

  const lake = addLakeAndSky(scene, compact);
  const facility = new THREE.Group();
  facility.rotation.y = THREE.MathUtils.degToRad(65);
  scene.add(facility);
  const [platformModel, buoyModel, crewModel, boatModel, { createAircraft }, { createQx25Aircraft }, { createRenAircraft }, landscape] = await Promise.all([
    loadVenueModel('biwa-platform'), loadAuthoredModel('practice-buoy'),
    loadAuthoredModel('ground-crew'), loadVenueModel('chase-boat'),
    import('./rendering/aircraft.js'), import('./rendering/aircraft/qx25.js'), import('./rendering/aircraft/ren.js'),
    addLandscape(scene),
  ]);
  const platform = createPlatform({ shoreDistance: 168 }, platformModel);
  const flag = createPlatformFlag(platform);
  const flagInset = createFlagInset(byId('flag-inset'));
  facility.add(platform);
  enableReflection(platform);
  platform.traverse(part => {
    if (part.isMesh) {
      part.receiveShadow = true;
      part.castShadow = true;
    }
  });
  const toricaCrew = createLaunchCrew(crewModel);
  let crew = toricaCrew;
  enableReflection(crew.group);
  facility.add(crew.group);
  const modelBase = new THREE.Group();
  modelBase.position.set(0, deckHeight(3) + 0.04, 3);
  facility.add(modelBase);
  const ryukai = createAircraft();
  let aircraft = ryukai;
  enableReflection(aircraft);
  modelBase.add(aircraft);

  let trials, setNight, firstLand, current, field, fieldPromise;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const marks = createPracticeBuoys(buoyModel);
  facility.add(marks);
  enableReflection(marks);
  const boat = createChaseBoat(boatModel);
  facility.add(boat.group);
  enableReflection(boat.group);
  boat.update(null, 0, 0);
  const cameraRig = createFlightCamera({
    canvas: renderer.domElement, facility, modelBase, aircraft, boat, reduceMotion, waterContact: () => trials?.cameraAtWater,
    trackBounds: () => trials.trackBounds, preparing: () => !byId('flight-settings').hidden, visibleTrackFraction: () => trackViewportFraction(host), onViewChange: showCameraMode,
  });
  bindViewerControls(host, renderer, cameraRig);
  const motorPosition = new THREE.Vector3(), wheelPosition = new THREE.Vector3();
  let last = 0, sceneTime = 0, lastImpactRun;
  const impactDirection = new THREE.Vector3(), impactPoint = new THREE.Vector3();
  renderer.setAnimationLoop(now => {
    if (now - last < 30) return;
    if (last && !document.hidden) sceneTime += (now - last) / 1000;
    last = now;
    trials?.tick(now);
    if (field) {
      field.update(now);
      cameraRig.update();
      const { sample, instruments } = field.display;
      const camera = cameraRig.camera;
      field.supportCar.getWorldPosition(motorPosition);
      camera.worldToLocal(motorPosition);
      field.modelBase.getWorldPosition(wheelPosition);
      sound.update(trials.soundPhase, sample, instruments, cameraRig.view(), Infinity, 0, {
        wheelSpeed: trials.soundPhase === 'run' ? sample.groundSpeed : 0,
        wheelRange: camera.position.distanceTo(wheelPosition),
        wheelLoad: isOnPavement(sample.right, sample.forward) ? sample.wheelLoad ?? 0 : 0,
        carOnPavement: isOnPavement(field.supportCar.position.x, -field.supportCar.position.z),
        carPosition: motorPosition, carSpeed: field.supportCarSpeed,
      }, camera.position.distanceTo(wheelPosition));
      renderer.render(field.scene, cameraRig.camera);
      return;
    }
    const visualTime = reduceMotion.matches ? 0 : trials?.waveTime() ?? sceneTime;
    const route = trials?.boatRoute(now) ?? {};
    const boatSpeed = boat.update(route.samples, route.time, visualTime, firstLand, route.stopTime);
    lake.setWake(boat.wakeOrigin, THREE.MathUtils.smoothstep(boatSpeed, 0.4, 6));
    cameraRig.update();
    if (trials) {
      boat.engineOrigin.getWorldPosition(motorPosition);
      const range = cameraRig.camera.position.distanceTo(motorPosition);
      sound.update(trials.soundPhase, current.display.sample, current.display.instruments, cameraRig.view(), range, boatSpeed, null,
        cameraRig.camera.position.distanceTo(modelBase.getWorldPosition(wheelPosition)));
    }
    const weatherMode = trials?.weather ?? selectedWeather();
    const weather = WEATHER[weatherMode];
    const period = weather.period ?? 'day';
    if (document.body.dataset.period !== period) document.body.dataset.period = period;
    setNight?.(period === 'night');
    const sample = current?.display.sample;
    const windTime = sample?.windTime ?? sample?.t ?? 0;
    const airflow = flag.update(weatherMode, sample?.gustOffset ?? 0, windTime, visualTime);
    flagInset(trials?.showFlag, flag, airflow, sample?.heading ?? 0);
    const age = reduceMotion.matches ? -1 : trials?.contactAge(now) ?? -1;
    const run = trials?.contactRun;
    if (age >= 0 && run && run !== lastImpactRun) {
      const contact = run.samples.at(-1);
      impactDirection.set(Math.sin(contact.track), 0, -Math.cos(contact.track)).transformDirection(facility.matrixWorld);
      facility.localToWorld(impactPoint.set(run.contactRight, 0, -run.contactForward));
      lake.touch(impactPoint, impactDirection, Math.abs(contact.verticalSpeed));
      lastImpactRun = run;
    }
    const fluctuation = !weather.field && weather.gustSpeed ? windAt(weatherMode, 150, windTime).headwind - weather.lakeWindSpeed : 0;
    const angle = Math.atan2(weather.field?.cross ?? weather.crosswind ?? 0, weather.field?.head ?? weather.headwind ?? 1);
    lake.update(cameraRig.camera, visualTime, weather.lakeWindSpeed, fluctuation, angle, weather.field, windTime, facility.rotation.y,
      sample?.gustOffset ?? 0, age);
    renderer.render(scene, cameraRig.camera);
  });

  enableReflection(landscape);
  setNight = createDaylight({ scene, skyLight: ambient, directLight: sun, platform, landscape, lake });
  lake.setShallows(landscape.userData.shallows);
  firstLand = createShoreline(landscape.userData.shoreRings, facility.rotation.y);
  const { view, setView, startLandingCamera, moveCamera } = cameraRig;
  const fleet = new Map();
  const aircraftFactories = { ryukai: () => ryukai, qx25: createQx25Aircraft, ren: createRenAircraft };
  function selectAircraft(id) {
    marks.visible = id === 'ren';
    let entry = fleet.get(id);
    if (!entry) {
      const model = aircraftFactories[id]();
      if (model !== ryukai) enableReflection(model);
      const teamCrew = id === 'ryukai' ? toricaCrew : createLaunchCrew(crewModel, id);
      if (teamCrew !== toricaCrew) enableReflection(teamCrew.group);
      const hull = modelHull(model);
      const session = new FlightSession(hull, selectedWeather(), drawWindOffset, firstLand, id, platform.userData.contact(hull));
      const display = createCockpitDisplay(model, {
        aircraftId: id, northInCourse: facility.rotation.y,
        describe: text => renderer.domElement.setAttribute('aria-description', text),
      });
      const aircraftPose = createAircraftPose({ modelBase, aircraft: model, crew: teamCrew, view, moveCamera, display });
      entry = { model, crew: teamCrew, session, display, aircraftPose };
      fleet.set(id, entry);
    }
    if (aircraft !== entry.model) {
      modelBase.remove(aircraft);
      aircraft = entry.model;
      modelBase.add(aircraft);
      cameraRig.setAircraft(aircraft);
      facility.remove(crew.group);
      crew = entry.crew;
      facility.add(crew.group);
    }
    current = entry;
    entry.display.invalidate();
    return entry;
  }
  trials = setupTrials({
    ...selectAircraft('ryukai'), selectAircraft, setView, view, startLandingCamera, drawWindOffset,
    loadField() {
      fieldPromise ??= Promise.all([import('./rendering/fujikawa-field.js'), import('./application/runway-trial.js')])
        .then(async ([{ createFujikawaField }, { createRunwayTrial }]) => {
          const site = await createFujikawaField(crewModel, cameraRig, text => renderer.domElement.setAttribute('aria-description', text));
          return Object.assign(site, { trial: (weather, offset) => createRunwayTrial(site.hull, weather, offset, { preSpin: true }) });
        })
        .catch(error => { fieldPromise = null; throw error; });
      return fieldPromise;
    },
    useField(next) {
      field = next;
      (field ?? current).display.invalidate();
      cameraRig.setSite(field ?? { facility, modelBase, aircraft });
      const label = field ? '富士川滑空場と機体の3Dビュー' : '松原湖岸と機体の3Dビュー';
      byId('viewer').setAttribute('aria-label', label);
      renderer.domElement.setAttribute('aria-label', label + '。俯瞰視点ではドラッグで回転、ホイールで拡大縮小');
      if (field) byId('flag-inset').hidden = true;
    },
    distanceToBoat: s => Math.hypot(s.right - boat.group.position.x, s.forward + boat.group.position.z),
    crewAnswer: (side, time) => crew.answer(side, time),
    crewTime: time => crew.update(current.session.launch, time, (side, contact) => sound.step(side, contact, view())),
    playSplash: sample => sound.splash(sample),
    soundHorn: () => sound.horn(),
    makeTrail: (run, color) => createFlightTrail(run, color, { facility, release }),
    sceneSeconds: () => sceneTime,
  });
  status.hidden = true;
  host.dataset.ready = 'true';
}

start().catch(error => {
  console.error(error);
  status.textContent = '3Dシーンを読み込めませんでした。WebGL対応ブラウザで再読み込みしてください。';
});
