import * as THREE from 'three';
import { windAt } from '../domain/weather.js';
import { deckHeight } from './launch-deck.js';

// The Nagoya AirCraft photograph shows flags beside the rear working deck.
// Placement, fabric and response below are visual estimates, in metres.
export function createPlatformFlag() {
  const group = new THREE.Group();
  group.name = 'プラットフォームの風見旗';
  group.position.set(-7.6, deckHeight(15) - .5, 15);
  const poleHeight = 4.1;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.035, .055, poleHeight, 8),
    new THREE.MeshStandardMaterial({color: '#c6cece', metalness: .4, roughness: .54}));
  pole.position.y = poleHeight / 2;
  group.add(pole);
  const length = 1.9, depth = .72, strips = 12;
  const geometry = new THREE.PlaneGeometry(length, depth, strips, 1);
  const points = geometry.getAttribute('position');
  points.setUsage(THREE.DynamicDrawUsage);
  const colors = [];
  const gold = new THREE.Color('#ffcf22'), vermilion = new THREE.Color('#e83934');
  for (let i = 0; i < points.count; i++) {
    const stripe = (i % (strips + 1)) / strips;
    (stripe < .47 || stripe > .74 ? gold : vermilion).toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, poleHeight - .5, 0), length + depth);
  const cloth = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({vertexColors: true, side: THREE.DoubleSide}));
  group.add(cloth);
  const focus = new THREE.Object3D();
  focus.position.y = poleHeight - depth / 2;
  group.add(focus);

  function update(weather, gustOffset, windTime, fabricTime) {
    const wind = windAt(weather, {right: group.position.x, forward: -group.position.z, height: group.position.y + poleHeight, gustOffset}, windTime);
    const x = -(wind.crosswind ?? 0), z = wind.headwind;
    const speed = Math.hypot(x, z), stretch = speed / Math.hypot(speed, .65);
    const dirX = speed ? x / speed : 0, dirZ = speed ? z / speed : 1;
    for (let i = 0; i < points.count; i++) {
      const u = (i % (strips + 1)) / strips;
      const ripple = .095 * stretch * u * Math.sin(u * 11 - fabricTime * (4 + Math.min(speed, 4)));
      const reach = u * length * (.09 + .91 * stretch);
      const drop = u ** 1.25 * length * Math.sqrt(1 - stretch ** 2);
      points.setXYZ(i, dirX * reach + dirZ * ripple, poleHeight - (i > strips ? depth : 0) - drop,
        dirZ * reach - dirX * ripple);
    }
    points.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  return { group, focus, update };
}
