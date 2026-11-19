import { bodyLoft, createCrewHead } from './crew-model.js';
import { createChaseCourse } from './chase-course.js';
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
    if (color !== undefined) {
      const colors = new Float32Array(shape.attributes.position.count * 3);
      tint.set(color);
      for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
      shape.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
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

  // Helm, throttle quadrant and padded seat are dimensioned around the seated driver.
  // Recessed binnacle faces the driver. Bright needles and bezels remain legible at deck distance.
  box([.42,.914,.012],[.47,.09,.028],rubber);
  for (const x of [.32,.45]) {
    oval([x,.925,.032],[.046,.039,.009],steel);
    oval([x,.925,.042],[.038,.032,.005],'#243441');
    rod([x,.925,.047],[x+.016,.942,.048],.0025,'#f4ac55');
  }
  for (const x of [.54,.573]) oval([x,.914,.031],[.008,.008,.006],'#e9b766');
  const hub = [.41, .82, .055];
  oval(hub, [.035, .032, .034], steel);
  for (const angle of [.55, 2.60, 4.72]) {
    const rise = .113 * Math.sin(angle);
    rod(hub, [hub[0] + .113 * Math.cos(angle), hub[1] + rise * Math.cos(.42),
      hub[2] - rise * Math.sin(.42)], .008, steel);
  }
  box([.64, .77, .13], [.08, .09, .13], navy);
  rod([.64, .79, .14], [.64, .87, .10], .012, steel);
  oval([.64, .87, .10], [.024, .022, .032], rubber);
  box([.4, .40, .60], [.31, .42, .32], liner);
  oval([.4, .62, .60], [.25, .055, .22], '#35495b');
  oval([.4, .77, .77], [.235, .17, .045], '#35495b');

  const skin = '#b78264', jacket = '#f07832', webbing = '#26323b', tape = '#dedfc8';
  const body = (rows, x, z, color) => add(bodyLoft(rows).translate(x, 0, z), color);
  body([[.63,.15,.12],[.75,.16,.125],[.92,.19,.13],[1.10,.207,.12],[1.16,.09,.082]], .40,.55,'#40576a');
  body([[.76,.165,.14],[.83,.18,.15],[1.03,.21,.146],[1.11,.204,.122],[1.127,.12,.09]], .40,.55,jacket);
  for (const y of [.80,.91]) {
    body([[y,.193,.155],[y+.026,.193,.155]], .40,.55,webbing);
    box([.40,y+.013,.392], [.047,.033,.012], '#859095');
  }
  for (const sign of [-1,1]) {
    oval([.40+sign*.113,1.09,.54],[.067,.086,.139],jacket);
    box([.40+sign*.118,1.048,.428],[.061,.035,.018],tape);
    box([.40+sign*.118,1.044,.671],[.064,.035,.015],tape);
    oval([.4+sign*.11,.63,.50],[.105,.09,.17],navy);
    const knee = [.4+sign*.125,.53,.22], ankle = [.4+sign*.14,.245,.25];
    rod([.4+sign*.11,.64,.50], knee,.077,navy);
    oval(knee,[.076,.075,.073],navy);
    rod(knee,ankle,.057,navy);
    oval([ankle[0],.225,.185],[.065,.044,.122],rubber);
    oval([ankle[0],.2,.18],[.067,.019,.123],'#b7c2be');
    const shoulder = [.4+sign*.19,1.07,.51], elbow = [.4+sign*.218,.88,.37];
    const wrist = sign < 0 ? [.317,.875,.077] : [.642,.889,.135];
    rod(shoulder,elbow,.060,'#40576a');
    oval(shoulder,[.07,.072,.073],'#40576a');
    oval(elbow,[.055,.052,.054],skin);
    rod(elbow,wrist,.038,skin);
    oval(wrist,[.039,.025,.045],skin);
    for (let finger=0; finger<4; finger++) {
      oval([wrist[0]+(finger-1.5)*.012,wrist[1]-.010,wrist[2]-.029],[.007,.016,.023],skin);
    }
    oval([wrist[0]-sign*.028,wrist[1]-.009,wrist[2]-.010],[.012,.018,.022],skin);
  }
  oval([.40,1.17,.53],[.061,.085,.063],skin);
  const head = createCrewHead(skin, '#332b26');
  add(head.geometry.rotateY(-.12).translate(.40,1.294,.518));
  oval([.40,1.394,.529],[.111,.069,.124],'#e1dfcf');
  oval([.40,1.371,.423],[.101,.013,.086],navy);
  // Stitch line, lifejacket zip and radio on the shoulder.
  rod([.4,.79,.392],[.4,1.07,.409],.006,webbing);
  box([.54,.99,.425],[.045,.071,.024],webbing);
  rod([.556,1.021,.426],[.56,1.084,.428],.004,rubber);

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
  const hull = new THREE.Group();
  group.add(hull);
  const finish = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .65 });
  for (const [name, geometry] of [['船体', hullGeometry()], ['甲板・乗員・船外機', deckFittings()]]) {
    const mesh = new THREE.Mesh(geometry, finish);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    hull.add(mesh);
  }
  const windscreen = new THREE.Mesh(
    new THREE.PlaneGeometry(.50, .265),
    new THREE.MeshStandardMaterial({ color: '#a6ccce', transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide }),
  );
  windscreen.name = '操舵席の風防';
  windscreen.rotation.x = -Math.atan2(.05, .26);
  windscreen.position.set(.42, 1.10, -.375);
  hull.add(windscreen);
  const eye = new THREE.Object3D();
  eye.name = '前部観測席';
  eye.position.set(-.65, 1.53, -.85);
  group.add(eye);

  const positionAt = createChaseCourse();
  function update(samples, time, waveTime, firstLand, stopTime) {
    const state = positionAt(samples, time, firstLand, stopTime);
    group.position.set(state.right, 0, -state.forward);
    group.rotation.y = -state.heading;
    // The observation camera rides the mean water level. Only the hull rides the swell.
    hull.position.y = .009 * Math.sin(waveTime * .72);
    const heel = Math.atan(state.turn * state.speed / 9.81) * .48;
    hull.rotation.set(.003 * Math.sin(waveTime * .58), 0, -heel + .004 * Math.sin(waveTime * .66));
    return state.speed;
  }
  return { group, eye, update };
}
