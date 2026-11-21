import { terrainAssets } from './terrain/assets.js';
import { loadVenueModel } from './authored-models.js';

/** Local metres relative to launch: east +X, south +Z, lake surface Y=0. */
export async function addLandscape(scene) {
  const assets = terrainAssets('terrain');
  const [group, bounds, photo, mask, landMask, shoreRings] = await Promise.all([
    loadVenueModel('biwa-scenery'), assets.json('bounds.json'), assets.photo('matsubara.webp', 4),
    assets.texture('shallows.png'), assets.texture('land-mask.png'), assets.json('flight-shore.json'),
  ]);
  // The shallows shader uses the original (bottom-left) map orientation.
  group.userData.shoreRings = shoreRings;
  group.userData.shallows = { photo, mask, bounds: bounds.shallows, landMask, landBounds: bounds.land };
  scene.add(group);
  return group;
}
