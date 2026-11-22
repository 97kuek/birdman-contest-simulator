import * as THREE from 'three';

// The Blender cord runs along local +Z, exported as glTF +Y. Bend its
// authored cross sections onto the path without stretching their diameter.
export function createWingHandlingLine(model, member) {
  const source = model.getObjectByName('WingHandlingLine');
  const rest = source.geometry.getAttribute('position');
  const rows = new Map();
  for (let i = 0; i < rest.count; i++) {
    const y = rest.getY(i);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(i);
  }
  const bounds = source.geometry.boundingBox;
  const rings = [...rows].sort(([a], [b]) => a - b).map(([y, indices]) => ({
    fraction: (y - bounds.min.y) / (bounds.max.y - bounds.min.y), indices, center: new THREE.Vector3(),
  }));
  const geometry = source.geometry.clone();
  const position = geometry.getAttribute('position').setUsage(THREE.DynamicDrawUsage);
  const normal = geometry.getAttribute('normal').setUsage(THREE.DynamicDrawUsage);
  const restNormal = source.geometry.getAttribute('normal');
  const mesh = new THREE.Mesh(geometry, source.material);
  mesh.name = '翼の保持索';
  mesh.castShadow = true;
  member.root.add(mesh);

  const points = Array.from({ length: 5 }, () => new THREE.Vector3());
  const path = new THREE.CatmullRomCurve3(points);
  const tangent = new THREE.Vector3(), across = new THREE.Vector3(), radial = new THREE.Vector3();
  const direction = new THREE.Vector3(), previous = new THREE.Vector3(), turn = new THREE.Quaternion();
  const radius = Math.hypot(Math.max(-bounds.min.x, bounds.max.x), Math.max(-bounds.min.z, bounds.max.z));
  // All guide points are in the runner's frame. After a handoff the wing
  // end folds down beside the upper palm while the other end hangs free.
  function pose(anchor, release, speed) {
    const [tip, slack, upper, lower, tail] = points;
    upper.copy(member.arms[1].end.position);
    lower.copy(member.arms[0].end.position);
    direction.set(upper.x, upper.y - .52, upper.z + .12);
    tip.lerpVectors(anchor, direction, release);
    slack.lerpVectors(tip, upper, .5);
    slack.y -= .045 + .10 * release;
    slack.z += .045 + .10 * release;
    tail.copy(lower);
    tail.y -= .25;
    tail.z += .025 + .045 * Math.min(1, speed / 4);

    geometry.boundingBox.makeEmpty();
    for (const ring of rings) {
      path.getPoint(ring.fraction, ring.center);
      geometry.boundingBox.expandByPoint(ring.center);
    }
    geometry.boundingBox.expandByScalar(radius / member.scale);
    geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
    for (const [i, ring] of rings.entries()) {
      const before = rings[Math.max(0, i - 1)], after = rings[Math.min(i + 1, rings.length - 1)];
      tangent.subVectors(after.center, before.center).normalize();
      // Transport the cross section through the turn at the hands without
      // flipping the tracer when the rope happens to point straight aft.
      if (i === 0) {
        across.set(1, 0, 0);
        if (Math.abs(tangent.x) > .9) across.set(0, 0, 1);
        across.addScaledVector(tangent, -tangent.dot(across)).normalize();
      } else across.applyQuaternion(turn.setFromUnitVectors(previous, tangent));
      previous.copy(tangent);
      radial.crossVectors(across, tangent);
      for (const j of ring.indices) {
        direction.copy(ring.center).addScaledVector(across, rest.getX(j) / member.scale)
          .addScaledVector(radial, rest.getZ(j) / member.scale);
        position.setXYZ(j, direction.x, direction.y, direction.z);
        direction.copy(across).multiplyScalar(restNormal.getX(j)).addScaledVector(tangent, restNormal.getY(j))
          .addScaledVector(radial, restNormal.getZ(j));
        normal.setXYZ(j, direction.x, direction.y, direction.z);
      }
    }
    position.needsUpdate = normal.needsUpdate = true;
  }

  return { mesh, pose };
}
