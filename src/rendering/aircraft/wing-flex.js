import * as THREE from 'three';
import { wingFoldDirection } from '../../domain/wing-contact.js';
import { wingBendShape, wingTwistShape } from '../../domain/wing-structure.js';

// Geometry is built in the unloaded frame. GPU morph deltas are also the
// collision model's coefficients, so every coating, rib and spar moves together.
export function rigHalfWing(group, side, aircraftId, halfSpan, rootStation, sparAt, referenceTip = 0) {
  const stations = new Map();
  const moving = [];
  group.traverse(part => {
    if (!part.geometry) return;
    const geometry = part.geometry, position = geometry.attributes.position;
    const deltas = Array.from({length: 4}, () => new Float32Array(3 * position.count));
    for (let i = 0; i < position.count; i++) {
      const station = Math.min(halfSpan, Math.abs(position.getX(i)));
      let section = stations.get(station);
      if (!section) {
        const fraction = station / halfSpan;
        section = { bend: wingBendShape(aircraftId, fraction), twist: wingTwistShape(fraction), spar: sparAt(station) };
        stations.set(station, section);
      }
      const offset = 3 * i;
      deltas[0][offset + 1] = section.bend;
      // First-order section rotation about the spar. Positive twist lifts the nose (-Z).
      deltas[1][offset + 1] = -(position.getZ(i) - section.spar[2]) * section.twist;
      deltas[1][offset + 2] = (position.getY(i) - section.spar[1]) * section.twist;
      // Draw the failed wing folding at its root attachment. The 60° angle
      // illustrates the terminal pose, independently of the overload criterion.
      const arm = Math.max(0, station - rootStation);
      deltas[2][offset] = side * arm * (Math.cos(Math.PI / 3) - 1);
      deltas[2][offset + 1] = arm * Math.sin(Math.PI / 3);
      deltas[3][offset] = deltas[2][offset];
      deltas[3][offset + 1] = -deltas[2][offset + 1];
    }
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = deltas.map(values => new THREE.BufferAttribute(values, 3));
    if (geometry.attributes.normal) {
      const probe = new THREE.BufferGeometry();
      probe.setIndex(geometry.index);
      geometry.morphAttributes.normal = deltas.map((delta, index) => {
        const step = index >= 2 ? 1 : .05;
        probe.setAttribute('position', new THREE.Float32BufferAttribute(position.array.map((v, i) => v + step * delta[i]), 3));
        probe.computeVertexNormals();
        return new THREE.BufferAttribute(probe.attributes.normal.array.map((v, i) => (v - geometry.attributes.normal.array[i]) / step), 3);
      });
      probe.dispose();
    }
    // Outboard panels move beyond their rest-pose bounding spheres.
    part.frustumCulled = false;
    part.updateMorphTargets();
    part.userData.wingSide = side;
    part.userData.referenceTip = referenceTip;
    moving.push(part);
  });
  const key = side > 0 ? 'right' : 'left';
  return sample => {
    const wing = sample.wing;
    const tip = sample.t === undefined ? 0 : wing?.[key + 'Tip'] ?? referenceTip;
    const twist = sample.t === undefined ? 0 : wing?.[key + 'Twist'] ?? 0;
    const fold = sample.t === undefined ? 0 : wingFoldDirection(wing, key);
    for (const part of moving) {
      const weights = part.morphTargetInfluences;
      weights[0] = tip;
      weights[1] = twist;
      weights[2] = Number(fold > 0);
      weights[3] = Number(fold < 0);
    }
  };
}
