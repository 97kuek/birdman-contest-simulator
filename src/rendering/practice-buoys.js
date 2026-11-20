import * as THREE from 'three';
import { practiceBuoys } from '../domain/ren-practice.js';

export function createPracticeBuoys() {
  const group = new THREE.Group();
  const orange = new THREE.MeshStandardMaterial({ color: '#ff6321' });
  const white = new THREE.MeshStandardMaterial({ color: '#fffbea' });
  const base = new THREE.CylinderGeometry(.85, 1.15, .9, 16);
  const pillar = new THREE.CylinderGeometry(.40, .67, 2.3, 16);
  const band = new THREE.CylinderGeometry(.52, .55, .24, 16);
  const flag = new THREE.ConeGeometry(.42, .85, 16);
  for (const [index, { right, forward }] of practiceBuoys.entries()) {
    const buoy = new THREE.Group();
    for (const [geometry, material, y] of [[base, orange, .22], [pillar, orange, 1.65], [flag, white, 3.2]]) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = y;
      buoy.add(mesh);
    }
    for (let stripe = 0; stripe <= index; stripe++) {
      const marker = new THREE.Mesh(band, white);
      marker.position.y = 1.73 + stripe * .30;
      buoy.add(marker);
    }
    buoy.position.set(right, 0, -forward);
    group.add(buoy);
  }
  group.visible = false;
  return group;
}
