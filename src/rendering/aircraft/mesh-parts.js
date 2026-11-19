import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function finishGeometry(vertices, indices, colors) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function shaded(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.61, metalness: 0.06, side: THREE.DoubleSide, ...options,
  });
}

export function mesh(parent, geometry, material, name) {
  const part = new THREE.Mesh(geometry, material);
  part.name = name;
  part.castShadow = true;
  part.receiveShadow = true;
  parent.add(part);
  return part;
}

export function rod(parent, a, b, radius, material, name) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const axis = end.clone().sub(start);
  const part = mesh(parent, new THREE.CylinderGeometry(radius, radius, axis.length(), 8), material, name);
  part.position.copy(start).lerp(end, 0.5);
  part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
}

export function ellipsoid(parent, center, radii, material, name) {
  const part = mesh(parent, new THREE.SphereGeometry(1, 18, 12), material, name);
  part.position.set(...center);
  part.scale.set(...radii);
  return part;
}

export function lineSegments(parent, coordinates, color, opacity, name) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
  }));
  lines.name = name;
  parent.add(lines);
}

export function bentTube(group, points, radius, material, name) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return mesh(group, new THREE.TubeGeometry(curve, points.length * 3, radius, 6, false), material, name);
}

export function box(group, center, sizes, material, name) {
  const part = mesh(group, new THREE.BoxGeometry(...sizes), material, name);
  part.position.set(...center);
  return part;
}

// The frame, controls and pilot are rigid. Bake their local transforms so small
// fasteners and rods sharing a finish cost a single draw per material.
export function addRigidAssembly(parent, source) {
  const byMaterial = new Map();
  for (const part of source.children) {
    part.updateMatrix();
    part.geometry.applyMatrix4(part.matrix);
    part.geometry.deleteAttribute('uv');
    if (!byMaterial.has(part.material)) byMaterial.set(part.material, []);
    byMaterial.get(part.material).push(part.geometry);
  }
  for (const [material, parts] of byMaterial) {
    const geometry = mergeGeometries(parts);
    mesh(parent, geometry, material, source.name + '-' + material.name);
    parts.forEach(part => part.dispose());
  }
}

export function surfacePatch(parent, name, across, up, point, material, withUV = false) {
  const vertices = [], indices = [], uv = [];
  for (let j = 0; j <= up; j++) {
    for (let i = 0; i <= across; i++) {
      const u = i / across, v = j / up;
      vertices.push(...point(u, v));
      if (withUV) uv.push(u, v);
      const a = j * (across + 1) + i;
      if (j && i) indices.push(a - across - 2, a, a - 1, a - across - 2, a - across - 1, a);
    }
  }
  const geometry = finishGeometry(vertices, indices);
  if (withUV) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return mesh(parent, geometry, material, name);
}
