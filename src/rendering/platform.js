import { createPlatformContact } from './platform-contact.js';

// Scale the authored gangway about its deck end. Use those same transformed
// vertices for collision, including the handrails and diagonal scaffold tubes.
export function createPlatform({ shoreDistance = 100 } = {}, model) {
  const platform = model.clone();
  const gangway = platform.children.find(part => part.userData.platformRole === 'gangway');
  const { rearStation, shoreStation } = gangway.userData;
  gangway.scale.z *= (Math.max(rearStation + 8, shoreDistance) - rearStation) / (shoreStation - rearStation);
  platform.updateMatrixWorld(true);
  const contact = createPlatformContact();
  platform.traverse(part => {
    if (part.userData.marking || part.userData.platformRole === 'cloth') return;
    if (part.isMesh) contact.addMesh(part);
  });
  platform.userData.contact = contact.forAircraft;
  return platform;
}
