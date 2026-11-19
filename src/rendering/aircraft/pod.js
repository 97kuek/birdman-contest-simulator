import * as THREE from 'three';
import { addCockpit } from './cockpit.js';
import { lettering } from './lettering.js';
import { finishGeometry, lineSegments, mesh, surfacePatch } from './mesh-parts.js';

// Circumferential sections lofted along the pod. +Z points toward the tail.
const POD_SECTIONS = [
  [-1.45, 0.015, 0.18, 0.24], [-1.37, 0.103, 0.09, 0.34], [-1.21, 0.176, 0.05, 0.44],
  [-0.96, 0.218, 0.025, 0.54], [-0.65, 0.24, 0.012, 0.60], [-0.32, 0.25, 0.008, 0.62],
  [0.0, 0.25, 0.005, 0.615], [0.34, 0.244, 0.000, 0.602], [0.72, 0.20, 0.045, 0.57],
  [1.04, 0.141, 0.12, 0.55], [1.31, 0.072, 0.25, 0.52], [1.45, 0.033, 0.35, 0.49],
];

function podPoint(z, angle) {
  let hi = POD_SECTIONS.findIndex(section => section[0] >= z);
  if (hi < 0) hi = POD_SECTIONS.length - 1;
  const a = POD_SECTIONS[Math.max(0, hi - 1)], b = POD_SECTIONS[hi];
  const lambda = b[0] > a[0] ? (z - a[0]) / (b[0] - a[0]) : 0;
  const halfWidth = THREE.MathUtils.lerp(a[1], b[1], lambda);
  const bottom = THREE.MathUtils.lerp(a[2], b[2], lambda);
  const top = THREE.MathUtils.lerp(a[3], b[3], lambda);
  const rounded = value => Math.sign(value) * Math.abs(value) ** 0.75;
  return [
    halfWidth * rounded(Math.cos(angle)),
    0.5 * (top + bottom + (top - bottom) * rounded(Math.sin(angle))),
    z,
  ];
}

function podSide(z, heightAngle, side, lift = 0.002) {
  const point = podPoint(z, side > 0 ? heightAngle : Math.PI - heightAngle);
  point[0] += side * lift;
  return point;
}

function addPodLivery(group, m) {
  // Paint follows the curved substrate. Disc radii are measured along its
  // surface rather than using separate balls protruding from the fuselage.
  const dots = [
    [0.22, -0.88, 0.034], [0.32, -0.69, 0.025], [0.44, -0.91, 0.052],
    [0.54, -0.61, 0.031], [0.67, -0.82, 0.04], [0.72, -0.41, 0.055],
    [0.82, -0.10, 0.033], [0.88, -0.66, 0.044], [0.96, 0.24, 0.053],
    [1.03, -0.29, 0.030], [1.11, 0.60, 0.027], [1.14, 0.10, 0.034],
  ];
  const dotPositions = [], dotIndices = [], dotColors = [];
  const palette = ['#26aebc','#f0b651','#f47b3e','#68c6cc'].map(color => new THREE.Color(color));
  const id = lettering('竜海');
  for (const side of [-1, 1]) {
    surfacePatch(group, 'pod-wave', 36, 1, (u, v) => {
      const z = -0.27 + 1.33 * u;
      const curl = 0.13 + 0.33 * Math.sin(2 * Math.PI * (u + 0.025)) + 0.44 * u ** 3;
      const width = 0.32 * Math.sin(Math.PI * u) ** 0.7;
      return podSide(z, curl + (v - 0.5) * width, side);
    }, m.mint);
    surfacePatch(group, 'pod-name', 12, 4, (u, v) =>
      podSide(-0.27 + (side < 0 ? u : 1 - u) * 0.81, -0.28 + 0.74 * v, side, 0.005), id, true);
    for (const [i, [z, angle, radius]] of dots.entries()) {
      const start = dotPositions.length / 3, color = palette[i % palette.length];
      const top = podPoint(z, Math.PI / 2)[1], bottom = podPoint(z, -Math.PI / 2)[1];
      for (let j = -1; j < 16; j++) {
        const a = j * 2 * Math.PI / 16;
        const depth = j < 0 ? z : z + radius * Math.cos(a);
        const latitude = j < 0 ? angle : angle + 2 * radius * Math.sin(a) / (top - bottom);
        dotPositions.push(...podSide(depth, latitude, side));
        dotColors.push(color.r, color.g, color.b);
        if (j >= 0) dotIndices.push(start, start + j + 1, start + (j + 1) % 16 + 1);
      }
    }
  }
  mesh(group, finishGeometry(dotPositions, dotIndices, dotColors), m.paint, 'pod-painted-bubbles');
}

export function addPod(group, materials) {
  let doors;
  for (const [start, end, material, name] of [
    [-1.45, -0.40, materials.glass, 'clear-nose'],
    [-0.40, 1.45, materials.white, 'pilot-pod'],
  ]) {
    const stations = [start, ...POD_SECTIONS.map(row => row[0]).filter(z => z > start && z < end), end];
    const vertices = [], indices = [], doorFaces = [];
    for (const [i, z] of stations.entries()) {
      for (let j = 0; j < 40; j++) {
        vertices.push(...podPoint(z, 2 * Math.PI * j / 40));
        const a = 40 * i + j, b = 40 * i + (j + 1) % 40;
        if (i) {
          const legOpening = name === 'pilot-pod' && z > -.32 && z <= .72 && j >= 25 && j < 35;
          const faces = [a - 40, b - 40, a, a, b - 40, b];
          if (legOpening) doorFaces.push({side: j < 30 ? -1 : 1, faces});
          else indices.push(...faces);
        }
      }
    }
    const endRing = name === 'clear-nose' ? 0 : (stations.length - 1) * 40;
    for (let j = 1; j < 39; j++) {
      if (name === 'clear-nose') indices.push(endRing, endRing + j + 1, endRing + j);
      else indices.push(endRing, endRing + j, endRing + j + 1);
    }
    // The three-view depicts an opening below the running pilot and a smooth
    // closed belly in the glide. The split and rotation axes are inferred.
    // Duplicate boundary vertices so the rest of the shell stays rigid.
    const cosine = new Array(vertices.length).fill(0), sine = new Array(vertices.length).fill(0);
    const copies = new Map();
    for (const {side,faces} of doorFaces) {
      for (const source of faces) {
        const key = side * (source+1);
        if (!copies.has(key)) {
          copies.set(key,vertices.length/3);
          const x=vertices[source*3], y=vertices[source*3+1], z=vertices[source*3+2];
          const hinge = podPoint(z, (side < 0 ? 25 : 35)*Math.PI/20);
          const dx=x-hinge[0], dy=y-hinge[1];
          vertices.push(x,y,z);
          cosine.push(-dx,-dy,0);
          sine.push(-side*dy,side*dx,0);
        }
        indices.push(copies.get(key));
      }
    }
    const geometry=finishGeometry(vertices, indices);
    if (doorFaces.length) {
      geometry.morphTargetsRelative=true;
      geometry.morphAttributes.position=[cosine,sine].map(data=>new THREE.Float32BufferAttribute(data,3));
    }
    const part=mesh(group,geometry,material,name);
    if (doorFaces.length) doors=part;
    if (name === 'clear-nose') {
      part.castShadow = false;
      part.renderOrder = 3;
    }
  }
  const trim = [];
  for (const z of [-0.96, -0.40]) {
    for (let i = 0; i < 48; i++) trim.push(...podPoint(z, i * Math.PI / 24), ...podPoint(z, (i + 1) * Math.PI / 24));
  }
  for (const angle of [-0.58, 0.92, Math.PI + 0.58, Math.PI - 0.92]) {
    for (let z = -1.45; z < -0.401; z += 0.05) {
      trim.push(...podPoint(z, angle), ...podPoint(Math.min(z + 0.05, -0.40), angle));
    }
  }
  lineSegments(group, trim, '#777f73', 0.55, 'canopy-seams');
  addCockpit(group, materials);
  addPodLivery(group, materials);
  return weight=>{
    const angle=1.42*THREE.MathUtils.smoothstep(weight,.02,.36);
    doors.morphTargetInfluences[0]=1-Math.cos(angle);
    doors.morphTargetInfluences[1]=Math.sin(angle);
  };
}
