import { MathUtils } from 'three';
import { BASE_DESIGN } from '../domain/flight.js';
import { loadAircraftTemplate } from './aircraft/model.js';
import { bindWingFlex } from './aircraft/wing-flex.js';
import { bindGliderPilot } from './aircraft/glider-pilot.js';
import { pilotLaunchWeight } from './aircraft/pilot-launch.js';

const template = await loadAircraftTemplate('ryukai');

// Apply a design trial to the authored sections about each local spar datum.
// Flight, bending, collision and replay then use the same adjusted coordinates.
function adjustWing(mesh, spanFactor, incidence) {
  const geometry = mesh.geometry.clone();
  mesh.geometry = geometry;
  const position = geometry.attributes.position;
  const [, twist, up, down] = geometry.morphAttributes.position;
  const c = Math.cos(incidence), s = Math.sin(incidence);
  const innerSlope = Math.tan(MathUtils.degToRad(4));
  const outerSlope = Math.tan(MathUtils.degToRad(12));
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), station = Math.abs(x);
    const rise = innerSlope * MathUtils.clamp(station - 4.5, 0, 4)
      + outerSlope * Math.max(0, station - 8.5);
    const axisZ = .10 * MathUtils.clamp((station - 11.9) / .65, 0, 1);
    const y = position.getY(i) - .555 - rise, z = position.getZ(i) - axisZ;
    position.setXYZ(i, x*spanFactor, .555+rise*spanFactor+y*c-z*s, axisZ+z*c+y*s);
    const dy = twist.getY(i), dz = twist.getZ(i);
    twist.setXYZ(i, 0, dy*c-dz*s, dz*c+dy*s);
    for (const fold of [up, down]) fold.setXYZ(i, fold.getX(i)*spanFactor, fold.getY(i)*spanFactor, 0);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

export function createAircraft(span = BASE_DESIGN.span, incidence = BASE_DESIGN.incidence) {
  if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(incidence)) {
    throw new RangeError('Wing span must be positive and incidence must be finite.');
  }
  const root = template.clone();
  if (span !== BASE_DESIGN.span || incidence !== BASE_DESIGN.incidence) {
    root.traverse(mesh => {
      if (mesh.isMesh && mesh.userData.wingSide) {
        adjustWing(mesh, span/BASE_DESIGN.span, MathUtils.degToRad(incidence-BASE_DESIGN.incidence));
      }
    });
  }
  const flex = bindWingFlex(root);
  const pilot = bindGliderPilot(root, 'ryukai');
  const doors = root.getObjectByName('pilot-pod').morphTargetInfluences;
  root.userData.poseMechanisms = sample => {
    flex(sample);
    const weight = pilotLaunchWeight(sample);
    pilot(sample, weight);
    const angle = 1.42 * MathUtils.smoothstep(weight, .02, .36);
    doors[0] = 1-Math.cos(angle);
    doors[1] = Math.sin(angle);
  };
  return root;
}
