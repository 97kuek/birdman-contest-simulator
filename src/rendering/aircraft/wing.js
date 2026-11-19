import * as THREE from 'three';
import { rigHalfWing } from './wing-flex.js';
import { BASE_DESIGN } from '../../domain/flight.js';
import { RADIANS_PER_DEGREE } from '../../domain/units.js';
import { addRigidAssembly, finishGeometry, lineSegments, mesh, surfacePatch } from './mesh-parts.js';

const HALF_SPAN = BASE_DESIGN.span / 2;
const ROOT_HEIGHT = 0.555;
const SECTION_DIVISIONS = 16;
const CHORD_STATIONS = [
  [0, 1.009], [0.6, 1.009], [3.2, 0.938], [5.8, 0.821],
  [7.8, 0.673], [9.2, 0.587], [10.6, 0.519], [11.9, 0.423], [HALF_SPAN, 0.250],
];

function chordAt(station) {
  for (let i = 1; i < CHORD_STATIONS.length; i++) {
    const [end, chord] = CHORD_STATIONS[i];
    if (station <= end) {
      const [start, oldChord] = CHORD_STATIONS[i - 1];
      return THREE.MathUtils.lerp(oldChord, chord, (station - start) / (end - start));
    }
  }
  return CHORD_STATIONS[CHORD_STATIONS.length - 1][1];
}

// The root and tip use approximated camber and thickness envelopes.
// The Torica drawing provides silhouettes rather than machine-readable Kamuy/Kimera coordinates.
function wingPoint(station, chordFraction, upper, side, scale, incidence) {
  const thickness = THREE.MathUtils.lerp(0.128, 0.145, station / HALF_SPAN);
  const camber = THREE.MathUtils.lerp(0.044, 0.032, station / HALF_SPAN);
  const t = chordFraction;
  const halfHeight = 5 * thickness * (
    0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t ** 2 + 0.2843 * t ** 3 - 0.1036 * t ** 4
  );
  const c = chordAt(station);
  const offset = (4 * camber * t * (1 - t) + (upper ? halfHeight : -halfHeight)) * c;
  const washout = 1.7 * THREE.MathUtils.clamp((station - 10.6) / 1.3, 0, 1);
  const angle = (incidence - washout) * RADIANS_PER_DEGREE;
  const alongChord = (t - 0.35) * c;
  const bentHeight = Math.tan(4 * RADIANS_PER_DEGREE) * THREE.MathUtils.clamp(station - 4.5, 0, 4)
    + Math.tan(12 * RADIANS_PER_DEGREE) * Math.max(0, station - 8.5);
  const tip = THREE.MathUtils.clamp((station - 11.9) / 0.65, 0, 1);
  return [
    side * station * scale,
    ROOT_HEIGHT + bentHeight * scale + offset * Math.cos(angle) - alongChord * Math.sin(angle),
    0.10 * tip + alongChord * Math.cos(angle) + offset * Math.sin(angle),
  ];
}

// Ribs keep their section shape. Between ribs the unsupported trailing covering
// settles slightly toward the mean line. The depth is an optical approximation.
const RIB_PITCH = 0.15;

function distanceFromRib(station) {
  const rib = station / RIB_PITCH;
  return Math.abs(rib - Math.round(rib));
}

function buildWingStructure(group, stations, side, scale, incidence, label, materials) {
  const tube = [], tubeIndices = [], webs = [], webIndices = [];
  const sides = 10;
  for (const [i, station] of stations.entries()) {
    const top = wingPoint(station, 0.35, true, side, scale, incidence);
    const bottom = wingPoint(station, 0.35, false, side, scale, incidence);
    const radius = (top[1] - bottom[1]) * 0.41;
    const y = (top[1] + bottom[1]) / 2, z = (top[2] + bottom[2]) / 2;
    for (let j = 0; j < sides; j++) {
      const angle = j * 2 * Math.PI / sides;
      tube.push(top[0], y + radius * Math.cos(angle), z + radius * Math.sin(angle));
      const a = i * sides + j, b = i * sides + (j + 1) % sides;
      if (i) tubeIndices.push(a - sides, b - sides, a, a, b - sides, b);
    }
    if (distanceFromRib(station) > 0.001) continue;
    const base = webs.length / 3;
    for (const [j, u] of [0.09, 0.22, 0.35, 0.53, 0.72, 0.90, 0.99].entries()) {
      const upper = wingPoint(station, u, true, side, scale, incidence);
      const lower = wingPoint(station, u, false, side, scale, incidence);
      const clearance = Math.min(0.0018, (upper[1] - lower[1]) / 5);
      upper[1] -= clearance;
      lower[1] += clearance;
      webs.push(...upper, ...lower);
      const a = base + j * 2;
      if (j) webIndices.push(a - 2, a - 1, a, a, a - 1, a + 1);
    }
  }
  mesh(group, finishGeometry(tube, tubeIndices), materials.carbon, label + '-tapered-spar');
  mesh(group, finishGeometry(webs, webIndices), materials.rib, label + '-rib-webs');

  // The dark spar end shows through the end rib in the transport photograph.
  // This inset stays flush with the measured wingtip.
  const top = wingPoint(HALF_SPAN, 0.35, true, side, scale, incidence);
  const bottom = wingPoint(HALF_SPAN, 0.35, false, side, scale, incidence);
  const tip = [], faces = [], paint = [];
  const lip = new THREE.Color('#606d68'), bore = new THREE.Color('#25302e');
  for (const radius of [0, 0.32, 0.42]) {
    for (let j = 0; j < 12; j++) {
      const a = j * Math.PI / 6, r = (top[1] - bottom[1]) * radius;
      tip.push(top[0], (top[1] + bottom[1]) / 2 + r * Math.cos(a), (top[2] + bottom[2]) / 2 + r * Math.sin(a));
      const color = radius === 0.42 ? lip : bore;
      paint.push(color.r, color.g, color.b);
      const i = tip.length / 3 - 1, next = j === 11 ? i - 11 : i + 1;
      if (radius) faces.push(i - 12, i, next, i - 12, next, next - 12);
    }
  }
  mesh(group, finishGeometry(tip, faces, paint), materials.endPaint, label + '-spar-end');
}

export function addWing(parent, side, scale, incidence, materials) {
  const group = new THREE.Group();
  parent.add(group);
  const vertices = [], colors = [], leading = [], trailing = [], seams = [];
  const sections = new Set([0, 4.5, 8.5, HALF_SPAN, ...CHORD_STATIONS.map(([x]) => x)]);
  for (let halfBay = 1; halfBay * RIB_PITCH / 2 < HALF_SPAN; halfBay++) {
    sections.add(Number((halfBay * RIB_PITCH / 2).toFixed(4)));
  }
  const stations = [...sections].sort((a, b) => a - b);
  const top = new THREE.Color('#fafaf1'), underside = new THREE.Color('#dce6de');
  const cap = new THREE.Color('#c1cbbd'), color = new THREE.Color();
  const n = SECTION_DIVISIONS * 2;
  for (const [i, station] of stations.entries()) {
    const bay = Math.sin(Math.PI * station / RIB_PITCH) ** 2;
    for (let j = 0; j < n; j++) {
      const upper = j <= n / 2;
      const u = (1 - Math.cos(j * 2 * Math.PI / n)) / 2;
      const point = wingPoint(station, u, upper, side, scale, incidence);
      const aft = THREE.MathUtils.clamp((u - 0.35) / 0.65, 0, 1);
      point[1] -= (upper ? 1 : -1) * 0.007 * chordAt(station) * bay * Math.sin(Math.PI * aft);
      vertices.push(...point);
      color.copy(upper ? top : underside).lerp(cap, 0.14 * (1 - bay) * Math.sin(Math.PI * aft));
      colors.push(color.r, color.g, color.b);

      const a = i * n + j, b = i * n + (j + 1) % n;
      if (!i) continue;
      const midChord = (1 - Math.cos((j + 0.5) * 2 * Math.PI / n)) / 2;
      const faces = midChord <= 0.36 ? leading : trailing;
      if (side > 0) faces.push(a - n, b - n, a, a, b - n, b);
      else faces.push(a - n, a, b - n, a, b, b - n);
    }
    if (distanceFromRib(station) < 0.001 && station > 0) {
      // A cap on the upper and lower aft panels, with the D-box left smooth.
      for (const upper of [true, false]) {
        let start = wingPoint(station, 0.35, upper, side, scale, incidence);
        for (const u of [0.50, 0.68, 0.85, 1]) {
          const end = wingPoint(station, u, upper, side, scale, incidence);
          seams.push(...start, ...end);
          start = end;
        }
      }
    }
    if (i === stations.length - 1) {
      const base = i * n;
      for (let j = 1; j < n - 1; j++) {
        if (side > 0) leading.push(base, base + j, base + j + 1);
        else leading.push(base, base + j + 1, base + j);
      }
    }
  }
  const label = side > 0 ? 'right' : 'left';
  const geometry = finishGeometry(vertices, [...leading, ...trailing], colors);
  geometry.addGroup(0, leading.length, 0);
  geometry.addGroup(leading.length, trailing.length, 1);
  mesh(group, geometry, [materials.film, materials.aftFilm], label + '-wing-skin');
  lineSegments(group, seams, '#7d8877', 0.42, label + '-rib-caps');
  const markings = new THREE.Group();
  markings.name = label + '-wing-markings';
  for (const upper of [true, false]) {
    for (const [band, material] of [side > 0 ? materials.mint : materials.gold, side > 0 ? materials.gold : materials.mint].entries()) {
      surfacePatch(markings, 'root-sweep', 36, 2, (u, v) => {
        const t = (1 - Math.cos(u * Math.PI)) / 2;
        const center = 0.23 + 0.65 * (1 - t) + 0.16 * Math.sin(2 * Math.PI * t);
        const width = (band ? 0.07 : 0.34) * (0.36 + 0.64 * Math.sin(Math.PI * t));
        const station = center + (band ? 0.26 : 0) + (v - 0.5) * width;
        const pt = wingPoint(station, t, upper, side, scale, incidence);
        pt[1] += (upper ? 1 : -1) * 0.0018;
        return pt;
      }, material);
    }
  }
  addRigidAssembly(group, markings);
  buildWingStructure(group, stations.filter(station => station === HALF_SPAN ||
    distanceFromRib(station) < 0.001 ||
    CHORD_STATIONS.some(([x]) => x === station) || station === 8.5), side, scale, incidence, label, materials);
  return rigHalfWing(group, side, 'ryukai', scale * HALF_SPAN, scale * .60, station => {
    const top = wingPoint(station / scale, .35, true, side, scale, incidence);
    const bottom = wingPoint(station / scale, .35, false, side, scale, incidence);
    return top.map((v, i) => (v + bottom[i]) / 2);
  });
}
