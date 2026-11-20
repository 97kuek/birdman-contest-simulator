import * as THREE from 'three';
import { addServiceVehicles } from './fujikawa-service-area.js';
import { surfaceHeight, terrainMesh } from './terrain/surface.js';
import { fieldLandmarks } from './fujikawa-landmarks.js';
import { runwayVerge } from './fujikawa-verges.js';

function asset(name) {
  return new URL(`./fujikawa/${name}`, document.baseURI).href;
}

async function fetchAsset(name) {
  const response = await fetch(asset(name));
  if (!response.ok) throw new Error(`Fujikawa terrain ${name}: ${response.status}`);
  return response;
}

async function loadLayer(layer, loader) {
  const [buffer, photo] = await Promise.all([
    fetchAsset(layer.name + '.bin').then(response => response.arrayBuffer()),
    loader.loadAsync(asset(layer.name + '.webp')),
  ]);
  if (buffer.byteLength !== layer.width * layer.height * 2) {
    throw new Error(`Invalid Fujikawa elevation grid: ${layer.name}`);
  }
  photo.colorSpace = THREE.SRGBColorSpace;
  photo.anisotropy = 8;
  // The shared mesh builder expects decimetres. These grids store 20 cm steps.
  const elevations = Float32Array.from(new Int16Array(buffer), height => height * 2);
  return { layer, elevations, photo };
}

function addMountainHaze(material) {
  // The humid coastal plain loses more contrast than the summit above it.
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float coastalHaze;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float distanceFromField = length(position.xz);
        coastalHaze = (0.20 * smoothstep(1600.0, 6500.0, distanceFromField)
          + 0.26 * smoothstep(6500.0, 28000.0, distanceFromField))
          * exp(-max(position.y, 0.0) / 2100.0);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float coastalHaze;')
      .replace('#include <fog_fragment>', `#include <fog_fragment>
        #ifdef USE_FOG
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, coastalHaze);
        #endif`);
  };
}

function addSurfaceDetail(material, detail, waterMask, clock) {
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.anisotropy = 8;
  material.onBeforeCompile = shader => {
    shader.uniforms.riverMask = { value: waterMask };
    shader.uniforms.riverTime = clock;
    shader.uniforms.grassDetail = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 groundMetres;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ngroundMetres = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 groundMetres;\nuniform sampler2D grassDetail;\nuniform sampler2D riverMask;\nuniform float riverTime;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float grass = smoothstep(0.018, 0.085, sampledDiffuseColor.g - sampledDiffuseColor.b);
        float blades = texture2D(grassDetail, groundMetres / 4.2).r - 0.5;
        float patches = texture2D(grassDetail, groundMetres.yx / 19.3).r - 0.5;
        diffuseColor.rgb *= mix(vec3(1.0),vec3(.72,.85,.48),grass);
        diffuseColor.rgb *= 1.0 + grass * (blades * 0.90 + patches * 0.25);
        float mask = texture2D(riverMask, vMapUv).r;
        if (mask > .01) {
          vec2 p = groundMetres;
          float t = riverTime;
          float wave = sin(p.y * .61 - t * 1.8 + sin(p.x * .18)) + .5 * sin(dot(p, vec2(.75,.92)) - t * 1.3);
          vec3 look = normalize(cameraPosition - vec3(p.x, 0.0, p.y));
          float grazing = pow(1.0 - clamp(abs(look.y),0.0,1.0), 4.0);
          float attenuation = 1.0 / (1.0 + 4.0 * length(fwidth(p)));
          vec3 water = mix(vec3(.035,.105,.10), vec3(.27,.44,.51), grazing);
          water += attenuation * (.022 * wave + .10 * smoothstep(.98,1.45,wave));
          diffuseColor.rgb = mix(diffuseColor.rgb, water * diffuse, mask * .87);
        }`);
  };
}

// The JTSB's site sketch places the windsock about 100 m inland of mid-runway.
function createWindsock() {
  const marker = new THREE.Group();
  marker.name = '滑走路中央西側の吹き流し';
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.04, .075, 4.7, 8),
    new THREE.MeshStandardMaterial({ color: 0xb6b3a6, roughness: .9 }));
  mast.position.y = 2.35;
  marker.add(mast);
  const fabric = [0xd75531, 0xeae3ce].map(color =>
    new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
  const axis = new THREE.Vector3(.82, -.20, .53).normalize();
  const taper = [0.40, 0.35, 0.29, 0.23, 0.17, 0.12];
  for (let i = 0; i < 5; i++) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(taper[i+1], taper[i], .52, 12, 1, true),
      fabric[i % 2]);
    band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    band.position.copy(axis).multiplyScalar((i+.5)*.52);
    band.position.y += 4.65;
    marker.add(band);
  }
  marker.position.set(-105, 0, -425);
  return marker;
}

/** North-up terrain and a runway frame: +X right, −Z northbound, Y=0 on the pavement. */
export async function addFujikawaTerrain(scene) {
  const { layers, runway, fuji } = await (await fetchAsset('layers.json')).json();
  const loader = new THREE.TextureLoader();
  const landscape = new THREE.Group();
  landscape.name = '富士川河口・駿河湾・富士山';
  landscape.position.y = -runway.elevation;
  const [layerData, pavementPhoto, grassDetail, peak, trees, shrubs, canopy, mown, scrub, vergePlants, waterMask] = await Promise.all([
    Promise.all(layers.map(layer => loadLayer(layer, loader))),
    loader.loadAsync(asset('pavement.webp')),
    loader.loadAsync(asset('grass-detail.webp')),
    loadLayer(fuji, loader),
    fetchAsset('trees.json').then(response => response.json()),
    loader.loadAsync(asset('shrubs.png')), loader.loadAsync(asset('canopy.png')),
    loader.loadAsync(asset('mown-grass.webp')), loader.loadAsync(asset('scrub-surface.webp')),
    loader.loadAsync(asset('verge-plants.webp')), loader.loadAsync(asset('river-water.png')),
  ]);
  const riverTime = { value: 0 };
  let parent;
  const surfaces = {};
  for (const item of layerData) {
    parent = terrainMesh(item.layer, item.elevations, item.photo, parent);
    if (item.layer.name === 'runway') addSurfaceDetail(parent.mesh.material, grassDetail, waterMask, riverTime);
    else addMountainHaze(parent.mesh.material);
    landscape.add(parent.mesh);
    surfaces[item.layer.name] = parent;
  }
  const summit = terrainMesh(peak.layer, peak.elevations, peak.photo, surfaces.mountains);
  addMountainHaze(summit.mesh.material);
  landscape.add(summit.mesh, fieldLandmarks(surfaces.runway, surfaces.river, trees, { shrubs, canopy }));
  landscape.add(runwayVerge(surfaces.runway, runway, mown, scrub, vergePlants, grassDetail));
  const facility = new THREE.Group();
  facility.name = '富士川滑空場 RWY 36';
  facility.position.set(runway.southThreshold[0], 0, runway.southThreshold[1]);
  facility.rotation.y = -THREE.MathUtils.degToRad(runway.trueBearingDegrees);
  facility.userData.runway = runway;
  addServiceVehicles(facility, (x, z) => surfaceHeight(surfaces.runway, x, z) - runway.elevation);

  // Put the pavement under the same day/night tint as the surrounding photography.
  const runwayDetail = new THREE.Group();
  runwayDetail.position.set(facility.position.x, runway.elevation, facility.position.z);
  runwayDetail.rotation.copy(facility.rotation);
  landscape.add(runwayDetail);
  pavementPhoto.colorSpace = THREE.SRGBColorSpace;
  pavementPhoto.anisotropy = 16;
  const pavementGeometry = new THREE.PlaneGeometry(runway.width, runway.length);
  const pavement = new THREE.Mesh(pavementGeometry, new THREE.MeshBasicMaterial({
    map: pavementPhoto, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }));
  pavement.name = '富士川滑空場の舗装と標示';
  pavement.rotation.x = -Math.PI / 2;
  pavement.position.set(0, .018, -runway.length / 2);
  runwayDetail.add(pavement, createWindsock());

  const pavementShadow = new THREE.Mesh(pavementGeometry,
    new THREE.ShadowMaterial({ opacity: 0.32, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  pavementShadow.name = '滑走路面の影';
  pavementShadow.receiveShadow = true;
  pavementShadow.rotation.x = -Math.PI / 2;
  pavementShadow.position.set(0, .035, -runway.length / 2);
  facility.add(pavementShadow);
  scene.add(landscape, facility);
  return { landscape, facility, riverTime };
}
