import * as THREE from 'three';
import { inBounds, matsubaraGround, terrainMesh } from './terrain/surface.js';
import { shorelineBuildings } from './terrain/buildings.js';
import { riverBridges } from './terrain/bridges.js';
import { shorelineTrees } from './terrain/trees.js';

function assetUrl(name) {
  return new URL(`./terrain/${name}`, document.baseURI);
}

async function fetchTerrain(name, suffix = '') {
  const response = await fetch(assetUrl(name + suffix));
  if (!response.ok) throw new Error(`Terrain asset ${name}: ${response.status}`);
  return response;
}

async function readMetadata(name) {
  const response = await fetchTerrain(name);
  return response.json();
}

async function readGrid(name) {
  const response = await fetchTerrain(name, '.gz');
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Some static hosts already decode .gz through the Content-Encoding header.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.buffer;
  if (typeof DecompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }
  const { gunzipSync } = await import('three/addons/libs/fflate.module.js');
  return gunzipSync(bytes).buffer;
}

async function loadPhoto(loader, name) {
  const photo = await loader.loadAsync(assetUrl(name).href);
  photo.colorSpace = THREE.SRGBColorSpace;
  photo.anisotropy = 4;
  return photo;
}

async function readLayer(layer, loader) {
  const [buffer, photo] = await Promise.all([
    readGrid(layer.name + '.bin'),
    layer.name === 'basin' ? null : loadPhoto(loader, layer.name + '.webp'),
  ]);
  if (buffer.byteLength !== layer.width * layer.height * 2) {
    throw new Error(`Invalid elevation grid: ${layer.name}`);
  }
  return { layer, elevations: new Int16Array(buffer), photo };
}

function containsOutline(bounds, outline) {
  for (let i = 0; i < outline.length; i += 2) {
    if (!inBounds(outline[i], outline[i + 1], bounds)) return false;
  }
  return true;
}

/** Local metres relative to the launch, east +X, south +Z, lake surface Y=0. */
export async function addLandscape(scene) {
  const loader = new THREE.TextureLoader();
  const [assetsByLayer, objects, detail, detailBuffer, detailPhoto, shallowsMask, facades, landMask] = await Promise.all([
    readMetadata('index.json').then(layers => Promise.all(layers.map(layer => readLayer(layer, loader)))),
    readMetadata('shoreline.json'), readMetadata('matsubara.json'), readGrid('matsubara.bin'),
    loadPhoto(loader, 'matsubara.webp'), loader.loadAsync(assetUrl('shallows.png').href),
    loadPhoto(loader, 'facades.jpg'), loader.loadAsync(assetUrl('land-mask.png').href),
  ]);
  facades.wrapS = THREE.RepeatWrapping;

  const parts = [];
  for (const { layer, elevations, photo } of assetsByLayer) {
    parts.push(terrainMesh(layer, elevations, photo, parts.at(-1)));
  }
  const group = new THREE.Group();
  group.name = 'Lake Biwa · Matsubara';
  group.add(...parts.map(p => p.mesh));
  const shore = parts.find(p => p.layer.name === 'shore');
  group.add(matsubaraGround(detail, detailBuffer, detailPhoto, shore), riverBridges(detail, detailPhoto));
  group.userData.shallows = {
    photo: detailPhoto, mask: shallowsMask, bounds: detail.bounds, landMask, landBounds: shore.layer.bounds,
  };
  const close = [], distant = [];
  for (const building of objects.buildings) {
    const bucket = containsOutline(detail.bounds, building[2]) ? close : distant;
    bucket.push(building);
  }
  group.add(shorelineBuildings(close, detail.bounds, detailPhoto, facades));
  group.add(shorelineBuildings(distant, shore.layer.bounds, shore.photo, facades));
  const beyondDetail = objects.trees.filter(([x, , z]) => !inBounds(x, z, detail.bounds));
  group.add(shorelineTrees(beyondDetail.concat(detail.trees)));
  scene.add(group);
  return group;
}
