import * as THREE from 'three';
import { deckHeight } from './launch-deck.js';
import { lakeReflectionLayer, sunDirection } from './lake.js';

// A readable moonlit training scene. Lamp positions and moon bearing are artistic settings.
export function createDaylight({ scene, skyLight, directLight, platform, landscape, lake }) {
  const moonDirection = new THREE.Vector3(-0.72, 0.25, -0.65).normalize();
  const landscapeTint = new THREE.Color('#617a99');
  const terrainMaterials = new Map();
  landscape.traverse(part => {
    if (part.material?.isMeshBasicMaterial && !terrainMaterials.has(part.material))
      terrainMaterials.set(part.material, part.material.color.clone());
  });
  const lamps = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: '#33424c', roughness: .65 });
  const lens = new THREE.MeshBasicMaterial({ color: '#fff1ce' });
  const poleShape = new THREE.CylinderGeometry(.035, .055, 2.0, 8);
  const lensShape = new THREE.BoxGeometry(.43, .26, .10);
  for (const side of [-1, 1]) {
    const height = deckHeight(12);
    const pole = new THREE.Mesh(poleShape, frame);
    pole.position.set(side * 5.75, height + 1.0, 12);
    lamps.add(pole);
    const panel = new THREE.Mesh(lensShape, lens);
    panel.position.copy(pole.position).y += 1;
    panel.rotation.set(-.42, -side * .45, 0);
    lamps.add(panel);
    const light = new THREE.PointLight(0xffe5bd, 42, 23, 2);
    light.position.copy(panel.position);
    lamps.add(light);
  }
  lamps.traverse(part => part.layers.enable(lakeReflectionLayer));
  platform.add(lamps);

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
    lamps.visible = night;
  };
}
