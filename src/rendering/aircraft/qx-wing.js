import * as THREE from 'three';
import { finishGeometry, mesh } from './mesh-parts.js';

// Projected half span, chord and additional deflection under steady lift, in metres.
// Panel lengths and chords come from the team's QX-25 three-view. The extra
// bend between the measured root and tip is interpolated from its front view.
const stations = [
  [0, 1.06, 0], [0.80, 1.06, 0], [2.45, 1.06, .018], [5.15, .96, .10],
  [7.699, .73, .33], [8.40, .674, .42], [9.932, .55, .67],
  [12.016, .40, 1.05], [13.058, .35, 1.234],
];
const span = stations.at(-1)[0];
const radians = Math.PI / 180;
function sampleStation(x) {
  const i = stations.findIndex(row => row[0] >= x);
  const start = stations[Math.max(0, i - 1)], end = stations[i];
  const ratio = end[0] === start[0] ? 0 : (x - start[0]) / (end[0] - start[0]);
  return {
    chord: THREE.MathUtils.lerp(start[1], end[1], ratio),
    flex: THREE.MathUtils.lerp(start[2], end[2], ratio),
  };
}

// Inboard ribs are at 150 mm pitch and the outboard bays widen to 300 mm.
const ribs = [0];
for (let x = .15; x < 5.55; x += .15) ribs.push(Number(x.toFixed(3)));
for (let x = 5.55; x < span; x += .30) ribs.push(Number(x.toFixed(3)));
ribs.push(span);
const sections = [...new Set([...ribs, ...ribs.slice(1).map((x, i) => (x + ribs[i]) / 2),
  ...stations.map(s => s[0])])].sort((a, b) => a - b);

function sectionPoint(x, t, upper, side) {
  const { chord, flex } = sampleStation(x);
  const angle = (4.2 - 2.2 * THREE.MathUtils.smoothstep(x, 5.15, span)) * radians;
  // Approximate the team's illustrated cambered profiles. Their coordinates
  // are unpublished. The front and underside share a closed trailing edge.
  const depth = 5 * THREE.MathUtils.lerp(.145, .134, x / span) * (
    .2969 * Math.sqrt(t) - .1260 * t - .3516 * t ** 2 + .2843 * t ** 3 - .1036 * t ** 4);
  const arch = 4 * (.052 - .009 * x / span) * t * (1 - t);
  const h = chord * (arch + (upper ? depth : -depth));
  const z = chord * (t - .365);
  return [side * x, .105 + Math.max(0, x - 7.5) * Math.tan(7 * radians) + flex +
    h * Math.cos(angle) - z * Math.sin(angle), z * Math.cos(angle) + h * Math.sin(angle)];
}

function flexMesh(group, vertices, faces, material, name) {
  const geom = finishGeometry(vertices, faces);
  const folded = [];
  for (let i = 0; i < vertices.length; i += 3) {
    folded.push(0, -sampleStation(Math.abs(vertices[i])).flex, 0);
  }
  geom.morphTargetsRelative = true;
  geom.morphAttributes.position = [new THREE.Float32BufferAttribute(folded, 3)];
  return mesh(group, geom, material, name);
}

function skin(group, side, aft, materials) {
  const vertices = [], faces = [];
  const chordSteps = aft ? 5 : 17;
  for (const upper of [true, false]) {
    const base = vertices.length / 3;
    for (const [i, x] of sections.entries()) {
      for (let j = 0; j <= chordSteps; j++) {
        const t = aft ? .75 + .25 * j / chordSteps : .75 * (1 - Math.cos(Math.PI * j / chordSteps)) / 2;
        const point = sectionPoint(x, t, upper, side);
        if (aft && !ribs.includes(x)) {
          point[1] -= (upper ? 1 : -1) * .003 * Math.sin(Math.PI * j / chordSteps);
        }
        vertices.push(...point);
        const a = base + i * (chordSteps + 1) + j;
        const b = a - chordSteps - 1;
        if (i && j) {
          if (upper === (side > 0)) faces.push(b - 1, a, a - 1, b - 1, b, a);
          else faces.push(b - 1, a - 1, a, b - 1, a, b);
        }
      }
    }
  }
  return flexMesh(group, vertices, faces, aft ? materials.film : materials.ivory,
    side + (aft ? '-trailing-film' : '-leading-shell'));
}

function addRibs(group, side, m) {
  const vertices = [], faces = [], edge = [], edgeFaces = [];
  for (const [i, x] of ribs.entries()) {
    const start = vertices.length / 3;
    const first = (i === ribs.length - 1) ? 0 : .747;
    for (let j = 0; j <= 12; j++) {
      const t = first + (1 - first) * (1 - Math.cos(Math.PI * j / 12)) / 2;
      vertices.push(...sectionPoint(x, t, true, side), ...sectionPoint(x, t, false, side));
      const a = start + 2 * j;
      if (j) faces.push(a - 2, a - 1, a, a - 1, a + 1, a);
    }
    // Narrow blue rib caps are visible through the transparent aft covering.
    for (const upper of [false, true]) {
      const base = edge.length / 3;
      for (const t of [.752, .85, .94, .995]) {
        for (const dx of [-.0035, .0035]) {
          const point = sectionPoint(THREE.MathUtils.clamp(x + dx, 0, span), t, upper, side);
          point[1] += upper ? .0007 : -.0007;
          edge.push(...point);
        }
        const n = edge.length / 3 - 2;
        if (n > base) edgeFaces.push(n - 2, n - 1, n, n - 1, n + 1, n);
      }
    }
  }
  return [flexMesh(group, vertices, faces, m.rib, side + '-rib-webs'),
    flexMesh(group, edge, edgeFaces, m.rib, side + '-rib-caps')];
}

export function addQxWing(root, m) {
  const group = new THREE.Group();
  group.name = 'main-wing';
  root.add(group);
  const bending = [];
  for (const side of [-1, 1]) {
    bending.push(skin(group, side, false, m), skin(group, side, true, m), ...addRibs(group, side, m));
    // The flying wires are internal on this cantilever wing. The aft member is
    // visible against the sky through the last quarter of the wing chord.
    const vertices = [], indices = [];
    for (const [i, x] of sections.entries()) {
      for (const t of [.990, 1]) vertices.push(...sectionPoint(x, t, false, side));
      const n = i * 2;
      if (i) indices.push(n - 2, n - 1, n, n - 1, n + 1, n);
    }
    bending.push(flexMesh(group, vertices, indices, m.trailing, side + '-trailing-member'));
  }
  return onDeck => { for (const part of bending) part.morphTargetInfluences[0] = onDeck; };
}
