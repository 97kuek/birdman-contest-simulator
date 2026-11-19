import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Approximate 5.5 m open launch. The waterline is y=0 and the bow points down -Z.
// Each station specifies z, half-beam, sheer height, chine height and keel height.
const stations = [
  [-2.85, .035, .94, .72, .58], [-2.52, .41, .86, .30, .04], [-2.05, .73, .76, .04, -.18],
  [-1.35, .98, .68, -.09, -.29], [-.45, 1.09, .63, -.13, -.32], [.70, 1.10, .62, -.13, -.30],
  [1.64, 1.05, .61, -.10, -.25], [2.45, .96, .60, -.06, -.22],
];
const ivory = '#f0eee2', liner = '#d9ded9', floor = '#a4b2ae', steel = '#acbaba';
const navy = '#243f50', teal = '#247980', rubber = '#303d40';

function hullGeometry() {
  const vertices = [], colors = [];
  const tint = new THREE.Color();
  function face(a, b, c, color) {
    vertices.push(...a, ...b, ...c);
    tint.set(color);
    for (let i = 0; i < 3; i++) colors.push(tint.r, tint.g, tint.b);
  }
  const rings = stations.map(([z, beam, sheer, chine, keel]) => {
    const port = [
      [-.78 * beam, chine, z], [-.98 * beam, sheer - .22, z], [-beam, sheer - .135, z],
      [-beam, sheer - .065, z], [-beam * 1.012, sheer - .042, z], [-beam, sheer, z],
      [-.88 * beam, sheer, z], [-.76 * beam, Math.min(sheer - .12, Math.max(.18, keel + .35)), z],
    ];
    return [[0, keel, z], ...port, ...port.map(([x, y]) => [-x, y, z]).reverse()];
  });
  const finishes = [navy, ivory, teal, ivory, rubber, rubber, ivory, liner, floor, liner, ivory, rubber, rubber, ivory, teal, ivory, navy];
  for (let i = 1; i < rings.length; i++) {
    const rear = rings[i], front = rings[i - 1];
    for (let j = 0; j < rear.length; j++) {
      const next = (j + 1) % rear.length;
      face(front[j], rear[j], rear[next], finishes[j]);
      face(front[j], rear[next], front[next], finishes[j]);
    }
  }
  for (const ring of [rings[0], rings.at(-1)]) {
    const plan = ring.map(([x, y]) => new THREE.Vector2(x, y));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(plan, [])) face(ring[a], ring[b], ring[c], ivory);
  }
  // Enclosed forepeak, with an open cockpit behind it.
  for (let i = 1; i <= 2; i++) {
    const front = rings[i - 1], rear = rings[i];
    face(front[7], rear[7], rear[10], ivory);
    face(front[7], rear[10], front[10], ivory);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function deckFittings() {
  const parts = [];
  const tint = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  function add(geometry, color) {
    const shape = geometry.index ? geometry.toNonIndexed() : geometry;
    shape.deleteAttribute('uv');
    const colors = new Float32Array(shape.attributes.position.count * 3);
    tint.set(color);
    for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
    shape.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(shape);
  }
  function box(center, size, color) {
    add(new THREE.BoxGeometry(...size).translate(...center), color);
  }
  function oval(center, size, color) {
    add(new THREE.SphereGeometry(1, 16, 12).scale(...size).translate(...center), color);
  }
  function rod(a, b, radius, color) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const q = new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize());
    const middle = start.lerp(end, .5);
    add(new THREE.CylinderGeometry(radius, radius, direction.length(), 10)
      .applyQuaternion(q).translate(middle.x, middle.y, middle.z), color);
  }

  for (const sign of [-1, 1]) {
    // Bow pulpit and cockpit handrail follow the sheer of the sides.
    const rail = [[.12, 1.13, -2.70], [.57, 1.09, -2.21], [.87, .99, -1.54], [1.0, .95, -.65], [1.02, .88, .12]];
    const points = rail.map(([x, y, z]) => [sign * x, y, z]);
    for (let i = 1; i < points.length; i++) rod(points[i - 1], points[i], .021, steel);
    for (const i of [0, 2, 4]) {
      const [x, y, z] = points[i];
      rod([x * .97, y - .27, z + .04], [x, y, z], .018, steel);
    }
    const sternGrip = [[sign * .97, .62, 1.85], [sign * .97, .76, 1.79], [sign, .76, 1.10], [sign, .62, 1.06]];
    for (let i = 1; i < sternGrip.length; i++) rod(sternGrip[i - 1], sternGrip[i], .022, steel);
    for (const z of [-1.35, 1.70]) {
      const x = sign * .94;
      rod([x, .68, z - .09], [x, .68, z + .09], .026, navy);
    }
  }

  // Non-slip floor and two padded benches.
  for (const z of [-1.47, 1.66]) {
    box([0, .34, z], [1.53, .30, .39], liner);
    box([0, .51, z], [1.57, .10, .43], '#e7ddc5');
    box([0, .49, z - .20], [1.56, .032, .05], navy);
  }
  box([.42, .57, -.23], [.59, .77, .47], ivory);
  box([.42, .97, -.18], [.64, .065, .46], navy);
  const wheel = new THREE.TorusGeometry(.123, .015, 8, 24).rotateX(-.42).translate(.41, .82, .055);
  add(wheel, rubber);
  for (const x of [.17, .67]) rod([x, .97, -.35], [x, 1.23, -.40], .014, steel);

  // Helmsman in a bright buoyancy vest, seated forward of the observer.
  box([.40, .40, .57], [.45, .40, .45], liner);
  box([.40, .62, .57], [.46, .09, .46], navy);
  oval([.40, .87, .50], [.22, .31, .17], '#e77638');
  box([.40, .89, .346], [.34, .045, .035], '#404b4b');
  oval([.40, 1.26, .47], [.112, .14, .105], '#bd9074');
  oval([.40, 1.36, .475], [.125, .085, .115], '#dfdfcf');
  box([.40, 1.346, .375], [.23, .018, .13], navy);
  for (const s of [-1, 1]) {
    const x = .40 + .17 * s;
    rod([x, 1.00, .49], [x + .028 * s, .84, .33], .063, '#78969c');
    rod([x + .028 * s, .84, .33], [x, .84, .095], .045, '#bb8b6f');
    oval([x, .84, .10], [.052, .046, .061], '#bb8b6f');
    rod([.40 + .10 * s, .62, .48], [.40 + .12 * s, .54, .20], .075, navy);
    rod([.40 + .12 * s, .54, .20], [.40 + .12 * s, .22, .18], .057, navy);
  }

  // Single outboard, bracket, skeg and propeller below the waterline.
  box([0, .38, 2.49], [.41, .24, .18], rubber);
  box([0, -.06, 2.67], [.19, .87, .20], navy);
  oval([0, .51, 2.70], [.28, .33, .27], navy);
  box([0, .56, 2.937], [.32, .065, .012], '#acbcb9');
  rod([-.12, -.38, 2.78], [.12, -.51, 2.78], .031, steel);
  const buoy = new THREE.TorusGeometry(.18, .049, 10, 32).rotateY(Math.PI / 2);
  add(buoy.translate(-.84, .42, .45), '#ec763f');

  return mergeGeometries(parts);
}

export function createChaseBoat() {
  const group = new THREE.Group();
  group.name = '追走艇';
  const finish = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .65 });
  for (const [name, geometry] of [['船体', hullGeometry()], ['甲板・乗員・船外機', deckFittings()]]) {
    const mesh = new THREE.Mesh(geometry, finish);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  const windscreen = new THREE.Mesh(
    new THREE.PlaneGeometry(.50, .265),
    new THREE.MeshStandardMaterial({ color: '#a6ccce', transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide }),
  );
  windscreen.name = '操舵席の風防';
  windscreen.rotation.x = -Math.atan2(.05, .26);
  windscreen.position.set(.42, 1.10, -.375);
  group.add(windscreen);
  const eye = new THREE.Object3D();
  eye.name = '前部観測席';
  eye.position.set(-.65, 1.53, -.85);
  group.add(eye);

  const waiting = new THREE.Vector3(-15, 0, -96);
  const waitingYaw = -1.85;
  const alongside = new THREE.Vector3();
  let clock = 0;
  function update(aircraft, seconds, reducedMotion) {
    const { x, y, z } = aircraft.position;
    const yaw = aircraft.rotation.y;
    // Wait ahead of the ramp. The glider overtakes the launch, which then runs off its port quarter.
    // The route depends only on the aircraft pose, including when a replay seeks backward.
    const distance = Math.hypot(x, Math.min(0, z));
    const underway = THREE.MathUtils.smoothstep(distance, 80, 145);
    const afloat = 1 - THREE.MathUtils.smoothstep(y, 0.45, 2.5);
    const lateral = -19 + 2 * afloat, aft = 9 - afloat;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    alongside.set(x + lateral * cos + aft * sin, 0, z - lateral * sin + aft * cos);
    group.position.lerpVectors(waiting, alongside, underway);

    // If a turn takes the glider toward the waiting station, keep the boat outside the port wingtip.
    const crossTrack = (group.position.x - x) * cos - (group.position.z - z) * sin;
    const clearance = Math.max(0, crossTrack - lateral) * THREE.MathUtils.smoothstep(distance, 20, 65);
    group.position.x -= clearance * cos;
    group.position.z += clearance * sin;
    const turn = Math.atan2(Math.sin(yaw - waitingYaw), Math.cos(yaw - waitingYaw));
    group.rotation.y = waitingYaw + turn * underway;
    clock += seconds;
    group.position.y = reducedMotion ? 0 : .022 * Math.sin(clock * 1.7);
    group.rotation.x = reducedMotion ? 0 : .007 * Math.sin(clock * 1.25);
    group.rotation.z = reducedMotion ? 0 : .010 * Math.sin(clock * 1.52);
  }

  return { group, eye, update };
}
