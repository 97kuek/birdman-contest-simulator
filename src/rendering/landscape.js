import { addFlatlandDetail } from './terrain/flatland.js';
import { terrainAssets } from './terrain/assets.js';
import { loadVenueModel } from './authored-models.js';

// Approximate the mean haze density along the sightline. Lake-level air keeps
// the full scene density, while the upper part of a distant slope rises above it.
function addLakeHaze(group) {
  const materials = new Set();
  group.traverse(part => {
    const material = part.material;
    if (material?.userData.lakeHaze) materials.add(material);
  });
  for (const material of materials) {
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', `#include <fog_vertex>
        #ifdef FOG_EXP2
        float height = (modelMatrix * vec4(transformed, 1.0)).y;
        float meanHeight = 0.5 * (max(height, 0.0) + max(cameraPosition.y, 0.0));
        vFogDepth *= 0.18 + 0.82 / (1.0 + meanHeight / 110.0);
        #endif`);
    };
  }
}

/** Local metres relative to launch: east +X, south +Z, lake surface Y=0. */
export async function addLandscape(scene) {
  const assets = terrainAssets('terrain');
  const [group, bounds, mask, landMask, shoreRings] = await Promise.all([
    loadVenueModel('biwa-scenery'), assets.json('bounds.json'),
    assets.texture('shallows.png'), assets.texture('land-mask.png'), assets.json('flight-shore.json'),
  ]);
  let photo;
  group.traverse(part => {
    if (part.material?.userData.sourceImage === 'terrain/matsubara.webp') photo = part.material.map;
  });
  if (!photo) throw new Error('Biwa scenery is missing the Matsubara aerial photograph');
  group.userData.shoreRings = shoreRings;
  group.userData.shallows = { photo, mask, bounds: bounds.shallows, landMask, landBounds: bounds.land };
  addLakeHaze(group);
  await addFlatlandDetail(group, 'terrain');
  scene.add(group);
  return group;
}
