import { wingFoldDirection } from '../../domain/wing-contact.js';

// The same four Blender shape keys drive the mesh and the contact hull.
export function bindWingFlex(root) {
  const halves = [[], []];
  root.traverse(part => {
    if (part.isMesh && part.userData.wingSide) halves[Number(part.userData.wingSide > 0)].push(part);
  });
  return sample => {
    const flying = sample.t !== undefined;
    const wing = flying || sample.rampTravel !== undefined ? sample.wing : undefined;
    for (const [i, meshes] of halves.entries()) {
      const side = i ? 'right' : 'left';
      const tip = wing?.[side + 'Tip'] ?? (flying ? meshes[0].userData.referenceTip : 0);
      const twist = wing?.[side + 'Twist'] ?? 0;
      const fold = flying ? wingFoldDirection(wing, side) : 0;
      for (const mesh of meshes) {
        const weights = mesh.morphTargetInfluences;
        weights[0] = tip;
        weights[1] = twist;
        weights[2] = Math.max(0, fold);
        weights[3] = Math.max(0, -fold);
      }
    }
  };
}
