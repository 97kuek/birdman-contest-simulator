import * as THREE from 'three';
import { addRigidAssembly, ellipsoid, mesh, rod, shaded, surfacePatch } from './mesh-parts.js';
import { addRenWing, addRenTail } from './ren-surfaces.js';
import { addRenCockpit } from './ren-cockpit.js';

const radius = 1.55;
const shaftY = 1.375;
const hubZ = -2.18;

function addPropeller(root, m) {
  const rotor = new THREE.Group();
  rotor.name = 'propeller';
  rotor.position.set(0, shaftY, hubZ);
  // Only the swept disk contributes to the collision hull, even if the hull
  // is rebuilt during a replay with the blades in a different position.
  rotor.userData.excludeFromHull = true;
  root.add(rotor);
  for (const side of [-1, 1]) {
    // Twisted two-blade balsa/film propeller; blade sections are illustrative.
    surfacePatch(rotor, 'propeller-blade', 20, 30, (u, v) => {
      const r = .049 + (radius - .049) * v;
      const chord = .017 + .19 * Math.sin(Math.PI * v) ** .75 * (1 - .43 * v);
      const twist = (40 - 30 * v) * Math.PI / 180;
      const theta = u * Math.PI * 2;
      const across = .5 * chord * Math.cos(theta);
      const thick = .065 * chord * Math.sin(theta);
      return [
        side * (across * Math.cos(twist) + thick * Math.sin(twist)),
        side * r,
        across * Math.sin(twist) - thick * Math.cos(twist),
      ];
    }, m.blade);
  }
  const disk = mesh(root, new THREE.CylinderGeometry(radius, radius, .14, 96), m.carbon, 'propeller-swept-disk');
  disk.rotation.x = Math.PI / 2;
  disk.position.copy(rotor.position);
  disk.visible = false;
  const fixed = new THREE.Group();
  fixed.name = 'drive-shaft';
  rod(fixed, [0, shaftY, hubZ], [0, shaftY, 6.34], .055, m.carbon, 'boom');
  ellipsoid(fixed, [0, shaftY, hubZ - .035], [.059, .059, .125], m.foam, 'spinner');
  for (const z of [-1.04, 0, .46, 2.23, 5.3, 6.1]) {
    rod(fixed, [0, shaftY, z - .021], [0, shaftY, z + .021], .059, m.metal, 'shaft-collar');
  }
  for (const z of [0, .45, 5.3]) {
    rod(fixed, [0, shaftY, z], [0, 1.56, z], .021, m.metal, 'spar-mount');
  }
  addRigidAssembly(root, fixed);
  return rotor;
}

// Windnauts 2022–23 report, pp. 8–9, 20–21. Aircraft axes are +Z aft,
// +Y up, with the origin under the primary wing spar, as in the glider models.
export function createRenAircraft() {
  const root = new THREE.Group();
  root.name = '聯';
  root.userData.wingSpan = 32.2;
  const m = {
    foam: shaded('#f2f2e8'), plank: shaded('#b4d7d3'),
    film: shaded('#d6e7df', { transparent: true, opacity: .30, roughness: .26, depthWrite: false }),
    glass: shaded('#bedde2', { transparent: true, opacity: .20, roughness: .15, depthWrite: false }),
    carbon: shaded('#2d3438'), trim: shaded('#727d79'), rib: shaded('#c3d2c9'),
    wire: shaded('#767d7b', { metalness: .5 }), metal: shaded('#b7bdb8', { metalness: .4 }),
    blade: shaded('#292939'), rubber: shaded('#303438'), jersey: shaded('#334258'),
    shorts: shaded('#242e3b'), skin: shaded('#c99c7d'), helmet: shaded('#e7e9e0'),
  };
  for (const [name, material] of Object.entries(m)) material.name = name;
  addRenWing(root, m);
  const { elevator, rudder } = addRenTail(root, m);
  const poseLegs = addRenCockpit(root, m);
  const rotor = addPropeller(root, m);
  root.userData.poseMechanisms = sample => {
    const angle = sample.propellerAngle ?? 0;
    rotor.rotation.z = angle;
    poseLegs(angle);
    elevator.rotation.x = -THREE.MathUtils.degToRad(sample.elevatorDeg ?? 0);
    rudder.rotation.y = THREE.MathUtils.degToRad(sample.rudderDeg ?? 0);
  };
  root.userData.poseMechanisms({});
  return root;
}
