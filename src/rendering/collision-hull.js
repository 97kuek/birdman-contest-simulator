import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import * as THREE from 'three';
import { wingContactTree } from '../domain/wing-contact.js';
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
  const left = [], right = [], referenceWing = [], bodyPlanar = [];
  function collect(part, transform, vertices = fixed) {
    if (part.name === 'pilot' || part.userData.excludeFromHull) return;
    if (part.isMesh) {
      const attr = part.geometry.attributes.position;
      for (let i = 0; i < attr.count; i++) {
        point.fromBufferAttribute(attr, i).applyMatrix4(transform);
        const side = part.userData.wingSide;
        if (side) {
          const [bend, twist, fold] = part.geometry.morphAttributes.position;
          const vertex = [point.z, point.y - CG_HEIGHT, point.x, bend.getY(i),
            twist.getZ(i), twist.getY(i), fold.getX(i), fold.getY(i)];
          (side < 0 ? left : right).push(vertex);
          point.y += part.userData.referenceTip * bend.getY(i);
          referenceWing.push(point.clone());
        } else {
          vertices.push(point.clone());
          bodyPlanar.push([point.z, point.y - CG_HEIGHT]);
        }
        points.push([point.z, point.y - CG_HEIGHT]);
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
  const coordinates = p => [p.z, p.y - CG_HEIGHT, p.x];
  hull.fixed = corners(fixed.concat(referenceWing)).map(coordinates);
  hull.bodyFixed = corners(fixed).map(coordinates);
  hull.bodyPlanar = hull2D(bodyPlanar);
  if (left.length && right.length) {
    // Shore crossing tracks the leading edge at the outermost rib.
    const tip = points => points.reduce((a, b) =>
      Math.abs(b[2]) > Math.abs(a[2]) || (b[2] === a[2] && b[0] < a[0]) ? b : a);
    hull.wingTips = { left: tip(left), right: tip(right) };
    hull.wings = { left: wingContactTree(left), right: wingContactTree(right) };
  }
  hull.fin = corners(fin).map((p) => [p.z, p.y - CG_HEIGHT, p.x]);
  hull.hingeZ = hinge.position.z;
  hull.spatial = [...hull.fixed, ...hull.fin];
  if (elevatorHinge) {
    hull.elevator = corners(elevator).map(p => [p.z, p.y - CG_HEIGHT, p.x]);
    hull.elevatorHingeZ = elevatorHinge.position.z;
    hull.elevatorHingeUp = elevatorHinge.position.y - CG_HEIGHT;
    hull.spatial.push(...hull.elevator);
  }
  hull.bodySpatial = hull.bodyFixed.concat(hull.fin, hull.elevator ?? []);
  return hull;
}
