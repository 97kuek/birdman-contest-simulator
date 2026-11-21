import * as THREE from 'three';
import { sunDirection } from './lake.js';

// A readable moonlit training scene. Lamp positions and moon bearing are artistic settings.
export function createDaylight({ scene, skyLight, directLight, platform, landscape, lake }) {
  const moonDirection = new THREE.Vector3(-0.72, 0.25, -0.65).normalize();
  const landscapeTint = new THREE.Color('#617a99');
  const terrainMaterials = new Map();
  landscape.traverse(part => {
    if (part.material?.isMeshBasicMaterial && !terrainMaterials.has(part.material))
      terrainMaterials.set(part.material, part.material.color.clone());
  });
  const lamps = [], lenses = new Map();
  platform.traverse(part => {
    if (part.isPointLight) lamps.push(part);
    if (part.userData.platformRole === 'lampLens') {
      part.material = part.material.clone();
      lenses.set(part.material, part.material.emissiveIntensity);
    }
  });

  let current;
  return function setNight(night) {
    if (current === night) return;
    current = night;
    const direction = night ? moonDirection : sunDirection;
    lake.setNight(night, direction);
    directLight.position.copy(direction).multiplyScalar(60);
    directLight.color.setHex(night ? 0xb9d8ff : 0xffffff);
    directLight.intensity = night ? .82 : 2.1;
    skyLight.color.setHex(night ? 0xb6d2ff : 0xfffaf0);
    skyLight.groundColor.setHex(night ? 0x687c91 : 0xb5cfcf);
    skyLight.intensity = night ? .68 : 2.15;
    scene.background.setHex(night ? 0x516b83 : 0xb7d6de);
    scene.fog.color.setHex(night ? 0x506983 : 0xd2dfda);
    for (const [material, dayColor] of terrainMaterials) {
      material.color.copy(dayColor);
      if (night) material.color.multiply(landscapeTint);
    }
    for (const lamp of lamps) lamp.visible = night;
    for (const [material, intensity] of lenses) material.emissiveIntensity = night ? intensity : 0;
  };
}
