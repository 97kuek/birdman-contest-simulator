import * as THREE from 'three';
import { BASE_DESIGN } from '../domain/flight.js';
import { addWing } from './aircraft/wing.js';
import { addPod } from './aircraft/pod.js';
import { addStabilizer } from './aircraft/tail.js';
import { addRigidAssembly, box, finishGeometry, mesh, rod, shaded, surfacePatch } from './aircraft/mesh-parts.js';

function addInstruments(group, materials) {
  const assembly = new THREE.Group();
  assembly.name = 'pitot';
  // Thin, faired upright and forward arm carry the pressure tube and two
  // perpendicular vanes. Their placement follows the detail on the three-view.
  surfacePatch(group, 'mast-fairing', 12, 1, (u, v) => {
    const a = u * 2 * Math.PI;
    return [0.018 * Math.sin(a), 0.609 + 0.409 * v, -0.117 + 0.046 * Math.cos(a) - 0.014 * v];
  }, materials.white);
  box(assembly, [0, 1.019, -0.259], [0.038, 0.035, 0.321], materials.white, 'forward-arm');
  rod(assembly, [0, 1.021, -0.403], [0, 1.021, -0.535], 0.006, materials.frame, 'pressure-tube');
  rod(assembly, [-0.042, 1.021, -0.417], [0.042, 1.021, -0.417], 0.006, materials.carbon, 'vane-bearing');
  rod(assembly, [0, 0.979, -0.445], [0, 1.065, -0.445], 0.005, materials.frame, 'vane-axis');
  const blades = [
    [0.024, 1.019, -0.451], [0.07, 1.019, -0.384], [0.019, 1.019, -0.401],
    [0, 1.037, -0.451], [0, 1.085, -0.389], [0, 1.034, -0.401],
  ];
  mesh(group, finishGeometry(blades.flat(), [0, 1, 2, 3, 4, 5]), materials.gold, 'flow-angle-vanes');
  addRigidAssembly(group, assembly);
}

export function createAircraft(span = BASE_DESIGN.span, incidence = BASE_DESIGN.incidence) {
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(incidence)) {
    throw new RangeError('Wing span must be positive and incidence must be finite.');
  }
  const root = new THREE.Group();
  root.name = 'Ryukai';
  const materials = {
    film: shaded(0xffffff, { vertexColors: true, roughness: 0.34, metalness: 0.035 }),
    aftFilm: shaded(0xffffff, { vertexColors: true, roughness: 0.48, metalness: 0.02,
      transparent: true, opacity: 0.82, depthWrite: false, side: THREE.FrontSide }),
    endPaint: shaded(0xffffff, { vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    rib: shaded('#d0c7a7'), paint: shaded(0xffffff, { vertexColors: true, roughness: 0.5 }),
    white: shaded('#f2f1e7'),
    glass: shaded('#b0d5da', { transparent: true, opacity: 0.20, depthWrite: false, roughness: 0.09, side: THREE.FrontSide }),
    frame: shaded('#b4b29a', { metalness: 0.45 }),
    mint: shaded('#159e8f'), gold: shaded('#efc142'),
    carbon: shaded('#394848'), skin: shaded('#c59370'), helmet: shaded('#335266'), suit: shaded('#306986'),
  };
  for (const [name, material] of Object.entries(materials)) material.name = name;
  const wing = new THREE.Group();
  wing.name = 'main-wing';
  root.add(wing);
  const spanScale = span / BASE_DESIGN.span;
  for (const side of [-1, 1]) addWing(wing, side, spanScale, incidence, materials);
  addPod(root, materials);
  rod(root, [0, 0.49, 1.04], [0, 0.54, 3.67], 0.043, materials.white, 'tail-boom');
  for (const z of [1.44, 2.68, 3.43]) {
    const y = THREE.MathUtils.lerp(0.49, 0.54, (z - 1.04) / 2.63);
    rod(root, [0, y, z - 0.018], [0, y, z + 0.018], 0.046, materials.carbon, 'boom-collar');
  }
  const mount = new THREE.Group();
  mount.name = 'tail-linkage';
  for (const side of [-1, 1]) {
    const x = 0.028 * side;
    rod(mount, [x, 0.556, 2.96], [x, 0.719, 3.071], 0.013, materials.carbon, 'forward-pylon');
    rod(mount, [x, 0.719, 3.071], [x, 0.56, 3.162], 0.013, materials.frame, 'aft-brace');
    rod(mount, [x, 0.551, 3.42], [x, 0.684, 3.57], 0.010, materials.frame, 'rudder-link');
  }
  rod(mount, [-0.064, 0.696, 3.071], [0.064, 0.696, 3.071], 0.017, materials.gold, 'stabilizer-bearing');
  addRigidAssembly(root, mount);
  const tailStations = [];
  for (let i = -8; i <= 8; i++) {
    const u = Math.abs(i / 8);
    tailStations.push([i / 8 * 1.61, 2.748 + u ** 1.4 * 0.10, 3.348 - 0.07 * u]);
  }
  addStabilizer(root, tailStations, false, materials);
  const hinge=new THREE.Group();
  hinge.name='rudder-hinge';
  hinge.position.z=3.57; // Approximate upright pivot at the modelled tail linkage.
  root.add(hinge);
  const fin=new THREE.Group();
  fin.position.z=-hinge.position.z;
  hinge.add(fin);
  addStabilizer(fin, [
    [0.53, 3.42, 3.61], [0.65, 3.36, 3.89], [0.83, 3.36, 4.00],
    [1.05, 3.41, 4.025], [1.26, 3.47, 4.05], [1.48, 3.50, 4.09],
    [1.67, 3.55, 4.11], [1.79, 3.59, 4.10], [1.83, 3.63, 4.07],
  ], true, materials);
  addInstruments(root, materials);
  return root;
}
