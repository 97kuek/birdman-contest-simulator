import * as THREE from 'three';
import { addRigidAssembly, rod, surfacePatch } from './mesh-parts.js';

import { renSparHeight } from '../../domain/ren-wing.js';

const lerp = THREE.MathUtils.lerp;
const radians = Math.PI / 180;

// Windnauts 2023 three-view, p.20. Chords at the spars' panel joints, in metres.
const wingStations = [[0, 1.053], [4.6, 1.053], [8.7, .859], [12.7, .768], [16.1, .471]];
function wingPoint(x, t, upper, side) {
  const index = Math.max(1, wingStations.findIndex(([station]) => station >= x));
  const [xa, ca] = wingStations[index - 1];
  const [xb, cb] = wingStations[index];
  const chord = lerp(ca, cb, (x - xa) / (xb - xa));
  // Continuous cambered proxy for DAE21/31/modified 41. The free-flight
  // front elevation already includes both built-in dihedral and elastic bend.
  const angle = lerp(3.9, 1.8, x / 16.1) * radians;
  const profile = .13 * 5 * (.2969 * Math.sqrt(t) - .126 * t - .3516 * t * t + .2843 * t ** 3 - .1036 * t ** 4);
  const depth = (.045 * 4 * t * (1 - t) + (upper ? profile : -profile)) * chord;
  const aft = (t - .38) * chord;
  return [
    side * x,
    renSparHeight(x) + depth * Math.cos(angle) - aft * Math.sin(angle),
    aft * Math.cos(angle) + depth * Math.sin(angle),
  ];
}

export function addRenWing(root, m) {
  const wing = new THREE.Group();
  wing.name = 'main-wing';
  root.add(wing);
  for (const side of [-1, 1]) {
    const frame = new THREE.Group();
    frame.name = 'wing-frame-' + side;
    for (const [i, [xa]] of wingStations.slice(0, -1).entries()) {
      const xb = wingStations[i + 1][0];
      const bays = Math.round((xb - xa) / .25);
      for (const [start, end, material] of [[0, .38, m.plank], [.38, 1, m.film]]) {
        for (const upper of [true, false]) {
          const panel = surfacePatch(wing, 'wing-panel', 12, bays, (u, v) => {
            const t = lerp(start, end, (1 - Math.cos(u * Math.PI)) / 2);
            return wingPoint(lerp(xa, xb, v), t, upper, side);
          }, material);
          if (material === m.film) panel.castShadow = false;
        }
      }
      for (let k = 0; k <= bays; k++) {
        if (i && k === 0) continue;
        const x = lerp(xa, xb, k / bays);
        surfacePatch(frame, 'foam-rib', 12, 1, (u, v) => {
          const t = x === 16.1 ? u : lerp(.37, 1, u);
          const p = wingPoint(x, t, false, side);
          p[1] = lerp(p[1], wingPoint(x, t, true, side)[1], v);
          return p;
        }, m.rib);
      }
      for (let k = 0; k < bays; k++) {
        const a = lerp(xa, xb, k / bays);
        // Leave the tube cap inside the foam tip.
        const b = Math.min(16.09, lerp(xa, xb, (k + 1) / bays));
        const spar = x => {
          const top = wingPoint(x, .38, true, side);
          const bottom = wingPoint(x, .38, false, side);
          top[1] = (top[1] + bottom[1]) / 2;
          return top;
        };
        rod(frame, spar(a), spar(b), lerp(.052, .017, a / 16.1), m.carbon, 'spar');
        rod(frame, wingPoint(a, 1, true, side), wingPoint(b, 1, true, side), .006, m.trim, 'trailing-edge');
      }
    }
    addRigidAssembly(wing, frame);
    const anchor = wingPoint(8.4, .38, false, side);
    rod(root, [side * .05, -.27, .1], anchor, .002, m.wire, 'flying-wire');
  }
}

// Both NACA 0009 tailplanes rotate together with their spars, at quarter chord.
function tailSurface(parent, m, span, chordAt, vertical, centerHeight) {
  const point = (station, t, upper) => {
    const chord = chordAt(Math.abs(station) / (span / 2));
    const thickness = 5 * .09 * chord * (.2969 * Math.sqrt(t) - .126 * t - .3516 * t * t + .2843 * t ** 3 - .1036 * t ** 4);
    const out = (upper ? 1 : -1) * thickness, z = (t - .25) * chord;
    return vertical ? [out, centerHeight + station, z] : [station, out, z];
  };
  const frame = new THREE.Group();
  frame.name = 'tail-frame';
  const bays = vertical ? 12 : 14;
  for (const [first, last, mat] of [[0, .25, m.plank], [.25, 1, m.film]]) {
    for (const upper of [false, true]) {
      const skin = surfacePatch(parent, 'tail-skin', 12, bays, (u, v) =>
        point((v - .5) * span, lerp(first, last, (1 - Math.cos(Math.PI * u)) / 2), upper), mat);
      if (mat === m.film) skin.castShadow = false;
    }
  }
  rod(frame, point(-span / 2, .25, false), point(span / 2, .25, false), .015, m.carbon, 'spar');
  for (let i = 0; i <= bays; i++) {
    const s = (i / bays - .5) * span;
    surfacePatch(frame, 'tail-rib', 12, 1, (u, v) => {
      const a = point(s, u, true), b = point(s, u, false);
      return a.map((value, j) => lerp(value, b[j], v));
    }, m.rib);
    if (i < bays) rod(frame, point(s, 1, true), point(s + span / bays, 1, true), .005, m.trim, 'trailing-edge');
  }
  addRigidAssembly(parent, frame);
}

export function addRenTail(root, m) {
  const elevator = new THREE.Group();
  elevator.name = 'elevator-hinge';
  elevator.position.set(0, 1.53, 5.30);
  root.add(elevator);
  tailSurface(elevator, m, 3.38, u => lerp(.685, .452, u ** 1.6), false, 0);
  const rudder = new THREE.Group();
  rudder.name = 'rudder-hinge';
  rudder.position.z = 6.10;
  root.add(rudder);
  tailSurface(rudder, m, 2.90, u => lerp(.81, .635, u ** 1.3), true, 2.29);
  return { elevator, rudder };
}
