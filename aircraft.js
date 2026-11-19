import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const RAD = Math.PI / 180;
const HALF_SPAN = 12.55;
const ROOT_HEIGHT = 0.555;
const SECTION_DIVISIONS = 16;
const CHORD_STATIONS = [
  [0, 1.009], [0.6, 1.009], [3.2, 0.938], [5.8, 0.821],
  [7.8, 0.673], [9.2, 0.587], [10.6, 0.519], [11.9, 0.423], [12.55, 0.250],
];

function chordAt(station) {
  for (let i = 1; i < CHORD_STATIONS.length; i++) {
    const [end, chord] = CHORD_STATIONS[i];
    if (station <= end) {
      const [start, oldChord] = CHORD_STATIONS[i - 1];
      return THREE.MathUtils.lerp(oldChord, chord, (station - start) / (end - start));
    }
  }
  return CHORD_STATIONS[CHORD_STATIONS.length - 1][1];
}

function finishGeometry(vertices, indices, colors) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function shaded(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.61, metalness: 0.06, side: THREE.DoubleSide, ...options,
  });
}

function mesh(parent, geometry, material, name) {
  const part = new THREE.Mesh(geometry, material);
  part.name = name;
  part.castShadow = true;
  part.receiveShadow = true;
  parent.add(part);
  return part;
}

function rod(parent, a, b, radius, material, name) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const axis = end.clone().sub(start);
  const part = mesh(parent, new THREE.CylinderGeometry(radius, radius, axis.length(), 8), material, name);
  part.position.copy(start).lerp(end, 0.5);
  part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize());
}

function ellipsoid(parent, center, radii, material, name) {
  const part = mesh(parent, new THREE.SphereGeometry(1, 18, 12), material, name);
  part.position.set(...center);
  part.scale.set(...radii);
  return part;
}

function lineSegments(parent, coordinates, color, opacity, name) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
  }));
  lines.name = name;
  parent.add(lines);
}

// The root and tip use approximated camber and thickness envelopes.
// The Torica drawing provides silhouettes rather than machine-readable Kamuy/Kimera coordinates.
function wingPoint(station, chordFraction, upper, side, scale, incidence) {
  const thickness = THREE.MathUtils.lerp(0.128, 0.145, station / HALF_SPAN);
  const camber = THREE.MathUtils.lerp(0.044, 0.032, station / HALF_SPAN);
  const t = chordFraction;
  const halfHeight = 5 * thickness * (
    0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t ** 2 + 0.2843 * t ** 3 - 0.1036 * t ** 4
  );
  const c = chordAt(station);
  const offset = (4 * camber * t * (1 - t) + (upper ? halfHeight : -halfHeight)) * c;
  const washout = 1.7 * THREE.MathUtils.clamp((station - 10.6) / 1.3, 0, 1);
  const angle = (incidence - washout) * RAD;
  const alongChord = (t - 0.35) * c;
  const bentHeight = Math.tan(4 * RAD) * THREE.MathUtils.clamp(station - 4.5, 0, 4)
    + Math.tan(12 * RAD) * Math.max(0, station - 8.5);
  const tip = THREE.MathUtils.clamp((station - 11.9) / 0.65, 0, 1);
  return [
    side * station * scale,
    ROOT_HEIGHT + bentHeight * scale + offset * Math.cos(angle) - alongChord * Math.sin(angle),
    0.10 * tip + alongChord * Math.cos(angle) + offset * Math.sin(angle),
  ];
}

// Ribs keep their section shape. Between ribs the unsupported trailing covering
// settles slightly toward the mean line. The depth is an optical approximation.
const RIB_PITCH = 0.15;

function buildWingStructure(group, stations, side, scale, incidence, label, materials) {
  const tube = [], tubeIndices = [], webs = [], webIndices = [];
  const sides = 10;
  for (const [i, station] of stations.entries()) {
    const top = wingPoint(station, 0.35, true, side, scale, incidence);
    const bottom = wingPoint(station, 0.35, false, side, scale, incidence);
    const radius = (top[1] - bottom[1]) * 0.41;
    const y = (top[1] + bottom[1]) / 2, z = (top[2] + bottom[2]) / 2;
    for (let j = 0; j < sides; j++) {
      const angle = j * 2 * Math.PI / sides;
      tube.push(top[0], y + radius * Math.cos(angle), z + radius * Math.sin(angle));
      const a = i * sides + j, b = i * sides + (j + 1) % sides;
      if (i) tubeIndices.push(a - sides, b - sides, a, a, b - sides, b);
    }
    if (Math.abs(station / RIB_PITCH - Math.round(station / RIB_PITCH)) > 0.001) continue;
    const base = webs.length / 3;
    for (const [j, u] of [0.09, 0.22, 0.35, 0.53, 0.72, 0.90, 0.99].entries()) {
      const upper = wingPoint(station, u, true, side, scale, incidence);
      const lower = wingPoint(station, u, false, side, scale, incidence);
      const clearance = Math.min(0.0018, (upper[1] - lower[1]) / 5);
      upper[1] -= clearance;
      lower[1] += clearance;
      webs.push(...upper, ...lower);
      const a = base + j * 2;
      if (j) webIndices.push(a - 2, a - 1, a, a, a - 1, a + 1);
    }
  }
  mesh(group, finishGeometry(tube, tubeIndices), materials.carbon, label + '-tapered-spar');
  mesh(group, finishGeometry(webs, webIndices), materials.rib, label + '-rib-webs');

  // The dark spar end shows through the end rib in the transport photograph.
  // This inset stays flush with the measured wingtip.
  const top = wingPoint(HALF_SPAN, 0.35, true, side, scale, incidence);
  const bottom = wingPoint(HALF_SPAN, 0.35, false, side, scale, incidence);
  const tip = [], faces = [], paint = [];
  const lip = new THREE.Color('#606d68'), bore = new THREE.Color('#25302e');
  for (const radius of [0, 0.32, 0.42]) {
    for (let j = 0; j < 12; j++) {
      const a = j * Math.PI / 6, r = (top[1] - bottom[1]) * radius;
      tip.push(top[0], (top[1] + bottom[1]) / 2 + r * Math.cos(a), (top[2] + bottom[2]) / 2 + r * Math.sin(a));
      const color = radius === 0.42 ? lip : bore;
      paint.push(color.r, color.g, color.b);
      const i = tip.length / 3 - 1, next = j === 11 ? i - 11 : i + 1;
      if (radius) faces.push(i - 12, i, next, i - 12, next, next - 12);
    }
  }
  mesh(group, finishGeometry(tip, faces, paint), materials.endPaint, label + '-spar-end');
}

function addWing(group, side, scale, incidence, materials) {
  const vertices = [], colors = [], leading = [], trailing = [], seams = [];
  const sections = new Set([0, 4.5, 8.5, HALF_SPAN, ...CHORD_STATIONS.map(([x]) => x)]);
  for (let halfBay = 1; halfBay * RIB_PITCH / 2 < HALF_SPAN; halfBay++) {
    sections.add(Number((halfBay * RIB_PITCH / 2).toFixed(4)));
  }
  const stations = [...sections].sort((a, b) => a - b);
  const top = new THREE.Color('#fafaf1'), underside = new THREE.Color('#dce6de');
  const cap = new THREE.Color('#c1cbbd'), color = new THREE.Color();
  const n = SECTION_DIVISIONS * 2;
  for (const [i, station] of stations.entries()) {
    const bay = Math.sin(Math.PI * station / RIB_PITCH) ** 2;
    for (let j = 0; j < n; j++) {
      const upper = j <= n / 2;
      const u = (1 - Math.cos(j * 2 * Math.PI / n)) / 2;
      const point = wingPoint(station, u, upper, side, scale, incidence);
      const aft = THREE.MathUtils.clamp((u - 0.35) / 0.65, 0, 1);
      point[1] -= (upper ? 1 : -1) * 0.007 * chordAt(station) * bay * Math.sin(Math.PI * aft);
      vertices.push(...point);
      color.copy(upper ? top : underside).lerp(cap, 0.14 * (1 - bay) * Math.sin(Math.PI * aft));
      colors.push(color.r, color.g, color.b);

      const a = i * n + j, b = i * n + (j + 1) % n;
      if (!i) continue;
      const midChord = (1 - Math.cos((j + 0.5) * 2 * Math.PI / n)) / 2;
      const faces = midChord <= 0.36 ? leading : trailing;
      if (side > 0) faces.push(a - n, b - n, a, a, b - n, b);
      else faces.push(a - n, a, b - n, a, b, b - n);
    }
    if (Math.abs(station / RIB_PITCH - Math.round(station / RIB_PITCH)) < 0.001 && station > 0) {
      // A cap on the upper and lower aft panels, with the D-box left smooth.
      for (const upper of [true, false]) {
        let start = wingPoint(station, 0.35, upper, side, scale, incidence);
        for (const u of [0.50, 0.68, 0.85, 1]) {
          const end = wingPoint(station, u, upper, side, scale, incidence);
          seams.push(...start, ...end);
          start = end;
        }
      }
    }
    if (i === stations.length - 1) {
      const base = i * n;
      for (let j = 1; j < n - 1; j++) {
        if (side > 0) leading.push(base, base + j, base + j + 1);
        else leading.push(base, base + j + 1, base + j);
      }
    }
  }
  const label = side > 0 ? 'right' : 'left';
  const geometry = finishGeometry(vertices, [...leading, ...trailing], colors);
  geometry.addGroup(0, leading.length, 0);
  geometry.addGroup(leading.length, trailing.length, 1);
  mesh(group, geometry, [materials.film, materials.aftFilm], label + '-wing-skin');
  lineSegments(group, seams, '#7d8877', 0.42, label + '-rib-caps');
  const markings = new THREE.Group();
  markings.name = label + '-wing-markings';
  for (const upper of [true, false]) {
    for (const [band, material] of [side > 0 ? materials.mint : materials.gold, side > 0 ? materials.gold : materials.mint].entries()) {
      surfacePatch(markings, 'root-sweep', 36, 2, (u, v) => {
        const t = (1 - Math.cos(u * Math.PI)) / 2;
        const center = 0.23 + 0.65 * (1 - t) + 0.16 * Math.sin(2 * Math.PI * t);
        const width = (band ? 0.07 : 0.34) * (0.36 + 0.64 * Math.sin(Math.PI * t));
        const station = center + (band ? 0.26 : 0) + (v - 0.5) * width;
        const pt = wingPoint(station, t, upper, side, scale, incidence);
        pt[1] += (upper ? 1 : -1) * 0.0018;
        return pt;
      }, material);
    }
  }
  addRigidAssembly(group, markings);
  buildWingStructure(group, stations.filter(station => station === HALF_SPAN ||
    Math.abs(station / RIB_PITCH - Math.round(station / RIB_PITCH)) < 0.001 ||
    CHORD_STATIONS.some(([x]) => x === station) || station === 8.5), side, scale, incidence, label, materials);
}

// Circumferential sections lofted along the pod. +Z points toward the tail.
const POD_SECTIONS = [
  [-1.45, 0.015, 0.18, 0.24], [-1.37, 0.103, 0.09, 0.34], [-1.21, 0.176, 0.05, 0.44],
  [-0.96, 0.218, 0.025, 0.54], [-0.65, 0.24, 0.012, 0.60], [-0.32, 0.25, 0.008, 0.62],
  [0.0, 0.25, 0.005, 0.615], [0.34, 0.244, 0.000, 0.602], [0.72, 0.20, 0.045, 0.57],
  [1.04, 0.141, 0.12, 0.55], [1.31, 0.072, 0.25, 0.52], [1.45, 0.033, 0.35, 0.49],
];

function podPoint(z, angle) {
  let hi = POD_SECTIONS.findIndex(section => section[0] >= z);
  if (hi < 0) hi = POD_SECTIONS.length - 1;
  const a = POD_SECTIONS[Math.max(0, hi - 1)], b = POD_SECTIONS[hi];
  const lambda = b[0] > a[0] ? (z - a[0]) / (b[0] - a[0]) : 0;
  const halfWidth = THREE.MathUtils.lerp(a[1], b[1], lambda);
  const bottom = THREE.MathUtils.lerp(a[2], b[2], lambda);
  const top = THREE.MathUtils.lerp(a[3], b[3], lambda);
  const rounded = value => Math.sign(value) * Math.abs(value) ** 0.75;
  return [
    halfWidth * rounded(Math.cos(angle)),
    0.5 * (top + bottom + (top - bottom) * rounded(Math.sin(angle))),
    z,
  ];
}

function bentTube(group, points, radius, material, name) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return mesh(group, new THREE.TubeGeometry(curve, points.length * 3, radius, 6, false), material, name);
}

function box(group, center, sizes, material, name) {
  const part = mesh(group, new THREE.BoxGeometry(...sizes), material, name);
  part.position.set(...center);
  return part;
}

// The frame, controls and pilot are rigid. Bake their local transforms so small
// fasteners and rods sharing a finish cost a single draw per material.
function addRigidAssembly(parent, source) {
  const byMaterial = new Map();
  for (const part of source.children) {
    part.updateMatrix();
    part.geometry.applyMatrix4(part.matrix);
    part.geometry.deleteAttribute('uv');
    if (!byMaterial.has(part.material)) byMaterial.set(part.material, []);
    byMaterial.get(part.material).push(part.geometry);
  }
  for (const [material, parts] of byMaterial) {
    const geometry = mergeGeometries(parts);
    mesh(parent, geometry, material, source.name + '-' + material.name);
    parts.forEach(part => part.dispose());
  }
}

function addPilot(group,m){
  const pilot=new THREE.Group(), body=new THREE.Group(), grips=new THREE.Group();
  pilot.name='pilot';body.name='prone-pilot';grips.name='pilot-grip';
  const detail={hair:shaded('#302728'),trim:shaded('#a0cbd1'),rubber:shaded('#323746'),
    lips:shaded('#ac7360'),eye:shaded('#d9c7b5'),iris:shaded('#312c2b'),
    strap:shaded('#263b46'),pants:shaded('#273442'),shell:shaded('#397088',{roughness:.35})};
  // Elliptical sections leave room for cheekbones, a tapered jaw and an open face.
  const face=[
    [.205,.019,.027,-.774],[.218,.045,.050,-.762],[.242,.064,.070,-.748],
    [.269,.078,.083,-.740],[.304,.085,.088,-.737],[.337,.083,.088,-.738],
    [.365,.076,.077,-.736],[.386,.059,.057,-.735],[.399,.019,.023,-.735],
  ];
  surfacePatch(body,'face',32,face.length-1,(u,v)=>{
    const [y,rx,rz,z]=face[Math.round(v*(face.length-1))], a=u*2*Math.PI;
    return [rx*Math.cos(a),y,z+rz*Math.sin(a)];
  },m.skin);
  ellipsoid(body,[0,.262,-.629],[.060,.067,.105],m.skin,'neck');
  ellipsoid(body,[0,.311,-.716],[.090,.096,.084],detail.hair,'hair');
  // The helmet skirt sits low at the back while the brow stays above the eyes.
  surfacePatch(body,'open-face-helmet',40,18,(u,v)=>{
    const a=2*Math.PI*u, edge=1.72+.50*Math.sin(a);
    const t=.012+v*edge;
    return [.102*Math.sin(t)*Math.cos(a),.337+.101*Math.cos(t),-.731+.113*Math.sin(t)*Math.sin(a)];
  },detail.shell);
  for(const side of [-1,1]){
    const at=(x,y,z)=>[side*x,y,z];
    ellipsoid(body,at(.079,.279,-.737),[.016,.026,.015],m.skin,'ear');
    ellipsoid(body,at(.090,.279,-.737),[.005,.015,.009],detail.lips,'ear-fold');
    const eye=ellipsoid(body,at(.034,.303,-.815),[.017,.006,.006],detail.eye,'eye');
    eye.rotation.y=-side*.28;
    ellipsoid(body,at(.034,.303,-.820),[.006,.006,.0025],detail.iris,'iris');
    bentTube(body,[at(.016,.318,-.819),at(.034,.322,-.817),at(.055,.317,-.804)],.004,detail.hair,'eyebrow');
    bentTube(body,[at(.076,.339,-.791),at(.085,.290,-.763),at(.072,.245,-.757),at(.030,.216,-.769)],.0055,detail.strap,'chin-strap');
    bentTube(body,[at(.070,.385,-.799),at(.091,.365,-.768),at(.098,.343,-.719)],.0038,detail.trim,'shell-stripe');
    for(let i=0;i<3;i++){
      const z=-.755+i*.024;
      const vent=ellipsoid(body,at(.042,.426-Math.abs(i-1)*.004,z),[.006,.004,.011],detail.rubber,'helmet-vent');
      vent.rotation.z=-side*.38;
    }
  }
  ellipsoid(body,[0,.285,-.820],[.013,.023,.017],m.skin,'nose-bridge');
  ellipsoid(body,[0,.274,-.835],[.017,.010,.010],m.skin,'nose');
  bentTube(body,[[-.021,.249,-.811],[0,.247,-.819],[.021,.249,-.811]],.0027,detail.lips,'mouth');
  const sleeves=[];
  // Follow the prone pilot silhouette along the pod, including the bent knees and shoes.
  ellipsoid(body,[0,.235,-.410],[.150,.091,.25],m.suit,'chest');
  ellipsoid(body,[0,.222,-.135],[.133,.081,.217],m.suit,'waist');
  ellipsoid(body,[0,.217,.052],[.137,.090,.172],detail.pants,'hips');
  function muscle(parent,a,b,width,depth,material,name){
    const v=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    const centre=a.map((n,i)=>(n+b[i])*.5);
    const part=ellipsoid(parent,centre,[width,depth,.5*v.length()+.014],material,name);
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),v.normalize());return part;
  }
  for(const s of [-1,1]){
    const at=(x,y,z)=>[s*x,y,z];
    bentTube(body,[at(.103,.30,-.57),at(.130,.304,-.40),at(.113,.279,-.22),at(.108,.260,-.11)],.007,detail.trim,'jersey-seam');
    muscle(body,at(.065,.204,.08),at(.075,.173,.45),.072,.074,detail.pants,'thigh');
    muscle(body,at(.075,.175,.45),at(.066,.286,.85),.050,.051,detail.pants,'calf');
    muscle(body,at(.066,.286,.84),at(.064,.279,.99),.042,.044,detail.rubber,'shoe');
    const shoulder=new THREE.Vector3(...at(.139,.246,-.46)),elbow=new THREE.Vector3(...at(.144,.169,-.648));
    const sleeve=muscle(pilot,shoulder.toArray(),elbow.toArray(),.044,.049,m.suit,'upper-arm');
    sleeves.push({sleeve,shoulder,elbow});
    // Forearms and hands stay at the grips as the shoulders shift on the chest rest.
    muscle(grips,at(.144,.168,-.634),at(.167,.210,-.792),.031,.033,m.skin,'forearm');
    muscle(grips,at(.167,.208,-.777),at(.171,.218,-.818),.024,.023,m.skin,'palm');
    for(let i=0;i<4;i++){
      const y=.207+i*.0085,z=-.79-i*.008;
      bentTube(grips,[at(.184,y,z+.004),at(.187,y,z-.013),at(.174,y,z-.021),at(.166,y,z-.015)],.0046,m.skin,'curled-finger');
    }
    muscle(grips,at(.159,.224,-.808),at(.164,.232,-.832),.009,.010,m.skin,'thumb');
  }
  const moving=new THREE.Group();moving.name='pilot-weight-shift';
  addRigidAssembly(moving,body);pilot.add(moving);
  const upper=new THREE.Vector3(),axis=new THREE.Vector3(), along=new THREE.Vector3(0,0,1);
  pilot.userData.setBodyOffset=z=>{
    moving.position.z=z;
    for(const {sleeve,shoulder,elbow} of sleeves){
      upper.copy(shoulder);upper.z+=z;
      axis.subVectors(elbow,upper);
      sleeve.position.copy(upper).lerp(elbow,.5);
      sleeve.scale.z=axis.length()*.5+.014;
      sleeve.quaternion.setFromUnitVectors(along,axis.normalize());
    }
  };
  addRigidAssembly(pilot,grips);group.add(pilot);
}

function addCockpit(group, m) {
  const hardware = new THREE.Group();
  hardware.name = 'cockpit';
  for (const side of [-1, 1]) {
    const x = 0.173 * side;
    bentTube(hardware, [[side * 0.08, 0.14, -1.34], [x, 0.10, -1.05],
      [side * 0.204, 0.096, -0.55], [side * 0.207, 0.106, 0.46]], 0.014, m.frame, 'floor-longeron');
    bentTube(hardware, [[x, 0.096, -0.78], [side * 0.20, 0.22, -0.81],
      [side * 0.185, 0.404, -0.72], [side * 0.135, 0.486, -0.62], [0, 0.51, -0.61]],
    0.015, m.mint, 'green-forward-hoop');
    bentTube(hardware, [[side * 0.20, 0.086, -0.52], [side * 0.214, 0.25, -0.54],
      [side * 0.198, 0.48, -0.50], [side * 0.103, 0.554, -0.44], [0, 0.558, -0.44]],
    0.018, m.gold, 'yellow-hoop');
    rod(hardware, [side * 0.19, 0.125, -0.43], [side * 0.17, 0.52, -0.18], 0.012, m.frame, 'diagonal-brace');
    rod(hardware, [side * 0.17, 0.52, -0.18], [side * 0.16, 0.14, 0.36], 0.013, m.frame, 'wing-mount');
    rod(hardware, [x, 0.13, -0.73], [x, 0.29, -0.87], 0.010, m.carbon, 'handgrip');
    ellipsoid(hardware, [x, 0.13, -0.74], [0.023, 0.022, 0.026], m.gold, 'pivot');

  }
  rod(hardware, [-0.173, 0.10, -0.99], [0.173, 0.10, -0.99], 0.014, m.frame, 'floor-crossmember');
  rod(hardware, [-0.165, 0.14, -0.42], [0.165, 0.14, -0.42], 0.015, m.carbon, 'rest-crossmember');
  box(hardware, [0, 0.149, -0.42], [0.26, 0.043, 0.39], m.helmet, 'prone-chest-rest');
  const panel = box(hardware, [0, 0.201, -1.042], [0.122, 0.031, 0.089], m.carbon, 'airspeed-display');
  panel.rotation.x = -0.48;
  const lens = box(hardware, [0, 0.219, -1.035], [0.089, 0.008, 0.058], m.display, 'instrument-face');
  lens.rotation.x = panel.rotation.x;
  bentTube(hardware, [[0.07, 0.176, -1.04], [0.12, 0.105, -0.92], [0.17, 0.112, -0.58],
    [0.174, 0.36, -0.49], [0.106, 0.523, -0.39]], 0.004, m.carbon, 'sensor-cable');
  addPilot(group,m);
  addRigidAssembly(group, hardware);
}

function surfacePatch(parent, name, across, up, point, material, withUV = false) {
  const vertices = [], indices = [], uv = [];
  for (let j = 0; j <= up; j++) {
    for (let i = 0; i <= across; i++) {
      const u = i / across, v = j / up;
      vertices.push(...point(u, v));
      if (withUV) uv.push(u, v);
      const a = j * (across + 1) + i;
      if (j && i) indices.push(a - across - 2, a, a - 1, a - across - 2, a - across - 1, a);
    }
  }
  const geometry = finishGeometry(vertices, indices);
  if (withUV) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return mesh(parent, geometry, material, name);
}

// Typeset identification in the host's fonts. Neither lettering nor the wave
// and bubbles below reproduce a published team logo or a photograph.
const letteringMaps = new Map();
function lettering(label) {
  if (!letteringMaps.has(label) && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#152b31';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = label === '竜海' ? 'bold 130px "Hiragino Mincho ProN","Yu Mincho",serif' : 'bold 104px Arial,sans-serif';
      ctx.fillText(label, 256, 84, 500);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      letteringMaps.set(label, texture);
    }
  }
  const map = letteringMaps.get(label);
  return new THREE.MeshBasicMaterial({
    map: map || null, visible: !!map, alphaTest: 0.35, side: THREE.FrontSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

function podSide(z, heightAngle, side, lift = 0.002) {
  const point = podPoint(z, side > 0 ? heightAngle : Math.PI - heightAngle);
  point[0] += side * lift;
  return point;
}

function addPodLivery(group, m) {
  // Paint follows the curved substrate. Disc radii are measured along its
  // surface rather than using separate balls protruding from the fuselage.
  const dots = [
    [0.22, -0.88, 0.034], [0.32, -0.69, 0.025], [0.44, -0.91, 0.052],
    [0.54, -0.61, 0.031], [0.67, -0.82, 0.04], [0.72, -0.41, 0.055],
    [0.82, -0.10, 0.033], [0.88, -0.66, 0.044], [0.96, 0.24, 0.053],
    [1.03, -0.29, 0.030], [1.11, 0.60, 0.027], [1.14, 0.10, 0.034],
  ];
  const dotPositions = [], dotIndices = [], dotColors = [];
  const palette = ['#26aebc','#f0b651','#f47b3e','#68c6cc'].map(color => new THREE.Color(color));
  const id = lettering('竜海');
  for (const side of [-1, 1]) {
    surfacePatch(group, 'pod-wave', 36, 1, (u, v) => {
      const z = -0.27 + 1.33 * u;
      const curl = 0.13 + 0.33 * Math.sin(2 * Math.PI * (u + 0.025)) + 0.44 * u ** 3;
      const width = 0.32 * Math.sin(Math.PI * u) ** 0.7;
      return podSide(z, curl + (v - 0.5) * width, side);
    }, m.mint);
    surfacePatch(group, 'pod-name', 12, 4, (u, v) =>
      podSide(-0.27 + (side < 0 ? u : 1 - u) * 0.81, -0.28 + 0.74 * v, side, 0.005), id, true);
    for (const [i, [z, angle, radius]] of dots.entries()) {
      const start = dotPositions.length / 3, color = palette[i % palette.length];
      const top = podPoint(z, Math.PI / 2)[1], bottom = podPoint(z, -Math.PI / 2)[1];
      for (let j = -1; j < 16; j++) {
        const a = j * 2 * Math.PI / 16;
        const depth = j < 0 ? z : z + radius * Math.cos(a);
        const latitude = j < 0 ? angle : angle + 2 * radius * Math.sin(a) / (top - bottom);
        dotPositions.push(...podSide(depth, latitude, side));
        dotColors.push(color.r, color.g, color.b);
        if (j >= 0) dotIndices.push(start, start + j + 1, start + (j + 1) % 16 + 1);
      }
    }
  }
  mesh(group, finishGeometry(dotPositions, dotIndices, dotColors), m.paint, 'pod-painted-bubbles');
}

function addPod(group, materials) {
  for (const [start, end, material, name] of [
    [-1.45, -0.40, materials.glass, 'clear-nose'],
    [-0.40, 1.45, materials.white, 'pilot-pod'],
  ]) {
    const stations = [start, ...POD_SECTIONS.map(row => row[0]).filter(z => z > start && z < end), end];
    const vertices = [], indices = [];
    for (const [i, z] of stations.entries()) {
      for (let j = 0; j < 40; j++) {
        vertices.push(...podPoint(z, 2 * Math.PI * j / 40));
        const a = 40 * i + j, b = 40 * i + (j + 1) % 40;
        if (i) indices.push(a - 40, b - 40, a, a, b - 40, b);
      }
    }
    const endRing = name === 'clear-nose' ? 0 : (stations.length - 1) * 40;
    for (let j = 1; j < 39; j++) {
      if (name === 'clear-nose') indices.push(endRing, endRing + j + 1, endRing + j);
      else indices.push(endRing, endRing + j, endRing + j + 1);
    }
    const part = mesh(group, finishGeometry(vertices, indices), material, name);
    if (name === 'clear-nose') {
      part.castShadow = false;
      part.renderOrder = 3;
    }
  }
  const trim = [];
  for (const z of [-0.96, -0.40]) {
    for (let i = 0; i < 48; i++) trim.push(...podPoint(z, i * Math.PI / 24), ...podPoint(z, (i + 1) * Math.PI / 24));
  }
  for (const angle of [-0.58, 0.92, Math.PI + 0.58, Math.PI - 0.92]) {
    for (let z = -1.45; z < -0.401; z += 0.05) {
      trim.push(...podPoint(z, angle), ...podPoint(Math.min(z + 0.05, -0.40), angle));
    }
  }
  lineSegments(group, trim, '#777f73', 0.55, 'canopy-seams');
  addCockpit(group, materials);
  addPodLivery(group, materials);
}

function finPoint(stations, y, u, side, lift) {
  const i = Math.max(1, stations.findIndex(row => row[0] >= y));
  const [ay, al, at] = stations[i - 1], [by, bl, bt] = stations[i];
  const ratio = (y - ay) / (by - ay);
  const leading = THREE.MathUtils.lerp(al, bl, ratio), trailing = THREE.MathUtils.lerp(at, bt, ratio);
  const thickness = 0.052 * (trailing - leading) * Math.sqrt(4 * u * (1 - u)) * (1.35 - 0.65 * u);
  return [side * (thickness + lift), y, THREE.MathUtils.lerp(leading, trailing, u)];
}

function addStabilizer(group, stations, vertical, materials) {
  const vertices = [], indices = [], ribs = [], colors = [];
  const skin = new THREE.Color('#f5f3e6');
  const edging = new THREE.Color('#e6d39c');
  const count = 32;
  for (const [i, row] of stations.entries()) {
    const [axis, leading, trailing] = row;
    const ring = [];
    for (let j = 0; j < count; j++) {
      const a = j * 2 * Math.PI / count;
      const u = (1 - Math.cos(a)) / 2;
      const thickness = 0.052 * (trailing - leading) * Math.sin(a) * (1.35 - 0.65 * u);
      const z = THREE.MathUtils.lerp(leading, trailing, u);
      const point = vertical ? [thickness, axis, z] : [axis, 0.726 + thickness, z];
      vertices.push(...point);
      ring.push(point);
      const color = !vertical && u > 0.95 ? edging : skin;
      colors.push(color.r, color.g, color.b);
      const current = i * count + j, next = i * count + (j + 1) % count;
      if (i > 0) {
        if (vertical) indices.push(current - count, current, next - count, current, next, next - count);
        else indices.push(current - count, next - count, current, current, next - count, next);
      }
    }
    for (let j = 0; j < count; j++) ribs.push(...ring[j], ...ring[(j + 1) % count]);
    if (i === 0 || i === stations.length - 1) {
      // Give the end plate flat normals independent of the surrounding skin.
      const base = vertices.length / 3;
      if (i === stations.length - 1) {
        for (const pt of ring) {
          vertices.push(...pt);
          colors.push(skin.r, skin.g, skin.b);
        }
      }
      const cap = i ? base : 0;
      for (let j = 1; j < count - 1; j++) {
        if (i) indices.push(cap, cap + j, cap + j + 1);
        else indices.push(cap, cap + j + 1, cap + j);
      }
    }
  }
  if (vertical) {
    const mark = lettering('TORICA');
    const paint = new THREE.Group();
    paint.name = 'fin-paint';
    for (const side of [-1, 1]) {
      for (const high of [false, true]) {
        surfacePatch(paint, 'fin-sweep', 24, 8, (u, v) => {
          const y = high ? 1.46 + 0.344 * u : 0.66 + 0.56 * u;
          const breadth = high ? 0.24 * Math.sin(Math.PI * u) ** 0.58 : 0.31 * Math.sin(Math.PI * u) ** 0.8;
          const center = high ? 0.12 + 0.14 * u * u : 0.13 + 0.28 * (1 - u) ** 2;
          return finPoint(stations, y, center + (v - 0.5) * breadth, side, 0.0017);
        }, high ? materials.gold : materials.mint);
      }
      surfacePatch(group, 'fin-lettering', 18, 3, (u, v) =>
        finPoint(stations, 0.977 + u * 0.62, 0.36 + (side > 0 ? v : 1 - v) * 0.31, side, 0.002),
      mark, true);
    }
    addRigidAssembly(group, paint);
  }
  mesh(group, finishGeometry(vertices, indices, colors), materials.film, vertical ? 'rudder' : 'horizontal-tail');
  lineSegments(group, ribs, '#a5a895', 0.5, vertical ? 'rudder-ribs' : 'stabilizer-ribs');
}

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

export function createAircraft(span = 25.1, incidence = 3.2) {
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
    mint: shaded('#159e8f'), gold: shaded('#efc142'), display: shaded('#92c3ba'),
    carbon: shaded('#394848'), skin: shaded('#c59370'), helmet: shaded('#335266'), suit: shaded('#306986'),
  };
  for (const [name, material] of Object.entries(materials)) material.name = name;
  const wing = new THREE.Group();
  wing.name = 'main-wing';
  root.add(wing);
  addWing(wing, -1, span / 25.1, incidence, materials);
  addWing(wing, 1, span / 25.1, incidence, materials);
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
