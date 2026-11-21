import * as THREE from 'three';
import { terrainAssets } from './terrain/assets.js';
import { inBounds, matsubaraGround, terrainMesh } from './terrain/surface.js';
import { shorelineBuildings } from './terrain/buildings.js';
import { riverBridges } from './terrain/bridges.js';
import { shorelineTrees } from './terrain/trees.js';

async function readLayer(layer, assets) {
  const [elevations, photo] = await Promise.all([
    assets.elevations(layer, layer.name + '.bin.gz'),
    layer.name === 'basin' ? null : assets.photo(layer.name + '.webp', 4),
  ]);
  return { layer, elevations, photo };
}

function containsOutline(bounds, outline) {
  for (let i = 0; i < outline.length; i += 2) {
    if (!inBounds(outline[i], outline[i + 1], bounds)) return false;
  }
  return true;
}

/** Local metres relative to the launch, east +X, south +Z, lake surface Y=0. */
export async function addLandscape(scene) {
  const assets = terrainAssets('terrain');
  const [assetsByLayer, objects, detail, detailBuffer, detailPhoto, shallowsMask, facades, landMask, shoreRings] = await Promise.all([
    assets.json('index.json').then(layers => Promise.all(layers.map(layer => readLayer(layer, assets)))),
    assets.json('shoreline.json'), assets.json('matsubara.json'), assets.buffer('matsubara.bin.gz'),
    assets.photo('matsubara.webp', 4), assets.texture('shallows.png'),
    assets.photo('facades.jpg', 4), assets.texture('land-mask.png'), assets.json('flight-shore.json'),
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
  group.userData.shoreRings = shoreRings;
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
