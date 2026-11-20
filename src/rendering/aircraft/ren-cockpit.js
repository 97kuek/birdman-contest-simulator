import * as THREE from 'three';
import { createCrewHead } from '../crew-model.js';
import { addRigidAssembly, bentTube, box, ellipsoid, mesh, rod, surfacePatch } from './mesh-parts.js';

// Station, half-width, keel and roof. The side elevation is taken from the
// report's cockpit construction drawing. Cross sections and glazing are lofts.
const pod = [
  [-1.59, .01, .042, .070], [-1.54, .10, -.035, .18], [-1.38, .22, -.16, .36],
  [-1.03, .29, -.245, .56], [-.68, .327, -.289, .72], [-.30, .344, -.311, .89],
  [.05, .347, -.32, .985], [.45, .322, -.35, 1.013], [.71, .286, -.36, 1.01],
  [.95, .238, -.13, .966], [1.20, .165, .12, .885], [1.36, .085, .41, .798], [1.395, .008, .68, .721],
];
const windshieldStart = 3, windshieldEnd = 8;
function shellPoint(index, angle) {
  const [z, w, bottom, top] = pod[index];
  return [w * Math.cos(angle), (top + bottom + (top - bottom) * Math.sin(angle)) / 2, z];
}

export function addRenCockpit(root, m) {
  const fixed = new THREE.Group();
  fixed.name = 'ren-cockpit-frame';
  const seam = .48;
  for (const [a, b] of [[0, windshieldStart], [windshieldStart, windshieldEnd], [windshieldEnd, pod.length - 1]]) {
    for (const [first, last, upper] of [[seam, Math.PI - seam, true], [Math.PI - seam, 2 * Math.PI + seam, false]]) {
      const glass = upper && a === windshieldStart;
      const panel = surfacePatch(root, glass ? 'windshield' : 'foam-fairing', 32, b - a, (u, v) =>
        shellPoint(a + Math.round(v * (b - a)), first + u * (last - first)), glass ? m.glass : m.foam);
      if (glass) panel.castShadow = false;
    }
  }
  for (const i of [windshieldStart, 6, windshieldEnd]) {
    const arc = Array.from({ length: 17 }, (_, k) => shellPoint(i, seam + (Math.PI - 2 * seam) * k / 16));
    bentTube(fixed, arc, .007, m.trim, 'glazing-frame');
  }
  for (const angle of [seam, Math.PI - seam]) {
    bentTube(fixed, pod.slice(windshieldStart, windshieldEnd + 1).map((_, k) => shellPoint(k + windshieldStart, angle)),
      .007, m.trim, 'glazing-sill');
  }
  // Main shaft and two load paths from the undercarriage to the boom.
  for (const [a, b, r] of [
    [[0, 1.375, -1.04], [0, -.33, -1.04], .030],
    [[0, 1.375, .72], [0, -.33, .29], .027],
    [[0, -.29, -1.04], [0, .26, .44], .023],
    [[0, -.33, .29], [0, -.03, -1.03], .024],
  ]) rod(fixed, a, b, r, m.carbon, 'cockpit-tube');
  for (const [z, y] of [[-1.04, .87], [.67, 1.13]]) {
    ellipsoid(fixed, [0, y, z], [.036, 1.38 - y, .106], m.foam, 'pylon-fairing');
  }
  for (const z of [-1.04, .29]) {
    const wheel = mesh(fixed, new THREE.TorusGeometry(.058, .014, 8, 24), m.rubber, 'wheel');
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(0, -.328, z);
    rod(fixed, [-.04, -.328, z], [.04, -.328, z], .016, m.metal, 'axle');
    for (let i = 0; i < 4; i++) {
      const y = .058 * Math.cos(i * Math.PI / 4), dz = .058 * Math.sin(i * Math.PI / 4);
      rod(fixed, [0, -.328 - y, z - dz], [0, -.328 + y, z + dz], .003, m.metal, 'spoke');
    }
  }
  ellipsoid(fixed, [0, .111, -.05], [.175, .050, .18], m.rubber, 'saddle');
  const back = ellipsoid(fixed, [0, .37, .21], [.17, .31, .038], m.rubber, 'backrest');
  back.rotation.x = .24;

  const display = new THREE.Group();
  display.name = 'cockpit-display-mount';
  display.position.set(.048, .59, -.46);
  display.rotation.x = -.25;
  root.add(display);
  box(display, [0, 0, -.012], [.165, .088, .021], m.rubber, 'instrument-case');
  rod(fixed, [.16, .26, -.25], [.07, .56, -.46], .007, m.carbon, 'instrument-arm');

  const pilot = new THREE.Group();
  pilot.name = 'pilot';
  // The seated pilot steers with an under-seat stick. Centre of mass is fixed.
  pilot.userData.setBodyOffset = () => {};
  root.add(pilot);
  const body = new THREE.Group();
  body.name = 'seated-pilot';
  const torso = ellipsoid(body, [0, .395, .105], [.171, .264, .112], m.jersey, 'jersey');
  torso.rotation.x = .32;
  ellipsoid(body, [0, .169, -.015], [.156, .098, .154], m.shorts, 'shorts');
  ellipsoid(body, [0, .624, .175], [.061, .067, .058], m.skin, 'neck');
  const head = createCrewHead('#c99c7d', '#363431');
  head.position.set(.028, .754, .16);
  pilot.add(head);
  ellipsoid(body, [.028, .824, .169], [.112, .087, .139], m.helmet, 'helmet');
  for (const side of [-1, 1]) {
    const shoulder = [side * .147, .521, .138];
    const elbow = [side * .163, .26, .135];
    const grip = [side * .144, .081, .015];
    rod(body, shoulder, elbow, .048, m.jersey, 'sleeve');
    rod(body, elbow, grip, .035, m.skin, 'forearm');
    ellipsoid(body, grip, [.042, .044, .043], m.skin, 'hand');
    rod(fixed, [side * .14, .03, .01], [side * .14, .12, .01], .017, m.rubber, 'control-grip');
  }
  const eye = new THREE.Object3D();
  eye.name = 'pilot-eye';
  // A slight lean and the right eye put the line of sight beside the drive tube.
  eye.position.set(.064, .758, .042);
  pilot.add(eye);
  addRigidAssembly(pilot, body);
  addRigidAssembly(root, fixed);

  // Two-link inverse kinematics keeps each shoe on its own crank pin at all
  // angles. User-visible gearing is estimated at two prop turns per crank turn.
  const crank = new THREE.Group();
  crank.name = 'pedal-crank';
  crank.position.set(0, .095, -.92);
  pilot.add(crank);
  const legs = [];
  for (const side of [-1, 1]) {
    rod(crank, [side * .087, 0, 0], [side * .087, side * .166, 0], .014, m.metal, 'crank-arm');
    rod(crank, [side * .084, side * .166, 0], [side * .146, side * .166, 0], .015, m.rubber, 'pedal');
    const parts = [];
    for (const [name, radius, length, material] of [
      ['thigh', .078, .231, m.shorts], ['calf', .048, .227, m.skin], ['shoe', .050, .102, m.rubber],
    ]) {
      parts.push(ellipsoid(pilot, [0, 0, 0], [radius, length, radius], material, 'cycling-' + name));
    }
    legs.push({ side, parts });
  }
  const up = new THREE.Vector3(0, 1, 0), hip = new THREE.Vector3(), foot = new THREE.Vector3();
  const knee = new THREE.Vector3(), delta = new THREE.Vector3();
  function limb(part, a, b) {
    part.position.copy(a).lerp(b, .5);
    delta.subVectors(b, a);
    part.scale.y = delta.length() / 2 + .018;
    part.quaternion.setFromUnitVectors(up, delta.normalize());
  }
  return propAngle => {
    const angle = propAngle / 2;
    crank.rotation.x = angle;
    for (const { side, parts: [thigh, calf, shoe] } of legs) {
      hip.set(.112 * side, .169, -.08);
      foot.set(.112 * side, crank.position.y + side * .166 * Math.cos(angle),
        crank.position.z + side * .166 * Math.sin(angle) + .065);
      const dy = foot.y - hip.y;
      const dz = foot.z - hip.z;
      const span = Math.hypot(dy, dz);
      // Fit equal length femur and tibia, bending toward the windscreen.
      const bend = Math.sqrt(Math.max(0, .48 ** 2 - span ** 2 / 4));
      knee.copy(hip).lerp(foot, .5);
      knee.y -= bend * dz / span;
      knee.z += bend * dy / span;
      limb(thigh, hip, knee);
      limb(calf, knee, foot);
      shoe.position.copy(foot);
      shoe.position.z -= .048;
      shoe.rotation.x = Math.PI / 2 - .38;
    }
  };
}
