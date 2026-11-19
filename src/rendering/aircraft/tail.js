import * as THREE from 'three';
import { lettering } from './lettering.js';
import { addRigidAssembly, finishGeometry, lineSegments, mesh, surfacePatch } from './mesh-parts.js';

function finPoint(stations, y, u, side, lift) {
  const i = Math.max(1, stations.findIndex(row => row[0] >= y));
  const [ay, al, at] = stations[i - 1], [by, bl, bt] = stations[i];
  const ratio = (y - ay) / (by - ay);
  const leading = THREE.MathUtils.lerp(al, bl, ratio), trailing = THREE.MathUtils.lerp(at, bt, ratio);
  const thickness = 0.052 * (trailing - leading) * Math.sqrt(4 * u * (1 - u)) * (1.35 - 0.65 * u);
  return [side * (thickness + lift), y, THREE.MathUtils.lerp(leading, trailing, u)];
}

export function addStabilizer(group, stations, vertical, materials) {
  const vertices = [], indices = [], ribs = [], colors = [];
  const skin = new THREE.Color('#f5f3e6');
  const edging = new THREE.Color('#e6d39c');
  const count = 32;
  for (const [i, row] of stations.entries()) {
    const [axis, leading, trailing] = row;
    const ring = [];
    for (let j = 0; j < count; j++) {
      const a = j * 2 * Math.PI / count;
      const u = (1 - Math.cos(a)) / 2;
      const thickness = 0.052 * (trailing - leading) * Math.sin(a) * (1.35 - 0.65 * u);
      const z = THREE.MathUtils.lerp(leading, trailing, u);
      const point = vertical ? [thickness, axis, z] : [axis, 0.726 + thickness, z];
      vertices.push(...point);
      ring.push(point);
      const color = !vertical && u > 0.95 ? edging : skin;
      colors.push(color.r, color.g, color.b);
      const current = i * count + j, next = i * count + (j + 1) % count;
      if (i > 0) {
        if (vertical) indices.push(current - count, current, next - count, current, next, next - count);
        else indices.push(current - count, next - count, current, current, next - count, next);
      }
    }
    for (let j = 0; j < count; j++) ribs.push(...ring[j], ...ring[(j + 1) % count]);
    if (i === 0 || i === stations.length - 1) {
      // Give the end plate flat normals independent of the surrounding skin.
      const base = vertices.length / 3;
      if (i === stations.length - 1) {
        for (const pt of ring) {
          vertices.push(...pt);
          colors.push(skin.r, skin.g, skin.b);
        }
      }
      const cap = i ? base : 0;
      for (let j = 1; j < count - 1; j++) {
        if (i) indices.push(cap, cap + j, cap + j + 1);
        else indices.push(cap, cap + j + 1, cap + j);
      }
    }
  }
  if (vertical) {
    const mark = lettering('TORICA');
    const paint = new THREE.Group();
    paint.name = 'fin-paint';
    for (const side of [-1, 1]) {
      for (const high of [false, true]) {
        surfacePatch(paint, 'fin-sweep', 24, 8, (u, v) => {
          const y = high ? 1.46 + 0.344 * u : 0.66 + 0.56 * u;
          const breadth = high ? 0.24 * Math.sin(Math.PI * u) ** 0.58 : 0.31 * Math.sin(Math.PI * u) ** 0.8;
          const center = high ? 0.12 + 0.14 * u * u : 0.13 + 0.28 * (1 - u) ** 2;
          return finPoint(stations, y, center + (v - 0.5) * breadth, side, 0.0017);
        }, high ? materials.gold : materials.mint);
      }
      surfacePatch(group, 'fin-lettering', 18, 3, (u, v) =>
        finPoint(stations, 0.977 + u * 0.62, 0.36 + (side > 0 ? v : 1 - v) * 0.31, side, 0.002),
      mark, true);
    }
    addRigidAssembly(group, paint);
  }
  mesh(group, finishGeometry(vertices, indices, colors), materials.film, vertical ? 'rudder' : 'horizontal-tail');
  lineSegments(group, ribs, '#a5a895', 0.5, vertical ? 'rudder-ribs' : 'stabilizer-ribs');
}
