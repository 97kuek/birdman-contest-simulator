import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import * as THREE from 'three';
import { CG_HEIGHT, hull2D } from '../domain/flight.js';

export function modelHull(model) {
  // Compose only aircraft-local transforms so a previous landing pose cannot
  // change hull vertices through floating point cancellation in world space.
  const hinge = model.getObjectByName('rudder-hinge');
  const elevatorHinge = model.getObjectByName('elevator-hinge');
  const point = new THREE.Vector3(),
    points = [],
    fixed = [],
    fin = [],
    elevator = [];
  function collect(part, transform, vertices = fixed) {
    if (part.name === 'pilot') return; // Interior pose cannot affect first water contact.
    if (part.isMesh) {
      const attr = part.geometry.attributes.position;
      for (let i = 0; i < attr.count; i++) {
        point.fromBufferAttribute(attr, i).applyMatrix4(transform);
        points.push([point.z, point.y - CG_HEIGHT]);
        vertices.push(point.clone());
      }
    }
    for (const child of part.children) {
      if (child.matrixAutoUpdate) child.updateMatrix();
      const moving = child === hinge || child === elevatorHinge;
      const local = moving ? new THREE.Matrix4().makeTranslation(child.position) : child.matrix;
      const group = child === hinge ? fin : child === elevatorHinge ? elevator : vertices;
      collect(child, new THREE.Matrix4().multiplyMatrices(transform, local), group);
    }
  }
  collect(model, new THREE.Matrix4());
  const hull = hull2D(points);
  function corners(points) {
    const shell = new ConvexHull().setFromPoints(points);
    return [
      ...new Set(
        shell.faces.flatMap((face) => [
          face.edge.head().point,
          face.edge.next.head().point,
          face.edge.prev.head().point,
        ]),
      ),
    ];
  }
  hull.fixed = corners(fixed).map((p) => [p.z, p.y - CG_HEIGHT, p.x]);
  hull.fin = corners(fin).map((p) => [p.z, p.y - CG_HEIGHT, p.x]);
  hull.hingeZ = hinge.position.z;
  hull.spatial = [...hull.fixed, ...hull.fin];
  if (elevatorHinge) {
    hull.elevator = corners(elevator).map(p => [p.z, p.y - CG_HEIGHT, p.x]);
    hull.elevatorHingeZ = elevatorHinge.position.z;
    hull.elevatorHingeUp = elevatorHinge.position.y - CG_HEIGHT;
    hull.spatial.push(...hull.elevator);
  }
  return hull;
}
