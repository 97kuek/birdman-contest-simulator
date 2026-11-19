import * as THREE from 'three';
import { RAMP_LENGTH } from '../domain/launch.js';
import { deckHeight, deckRun } from './launch-deck.js';

// Metres. The published launch run is 10 m down a 3.5° incline.
// The layout behind it, fan width, deck framing and shore connection are estimates
// from the JHF 2025 report (p. 11) and Nagoya AirCraft 2018 report (p. 5).
const halfAngle = THREE.MathUtils.degToRad(43);
const radius = RAMP_LENGTH;
const halfWidth = radius * Math.sin(halfAngle);
const rear = 16;

// A tiling painted-panel finish. Dimensions and wear are visual approximations.
function deckFinish() {
  const size=256, pixels=new Uint8Array(size*size*4);
  let seed=7123;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const edge=Math.min(x,size-1-x,y,size-1-y);
    const grain=2*Math.sin(2*Math.PI*(x/size*11+0.12*Math.sin(y/size*2*Math.PI)));
    const value=Math.round(245 + grain + 6*(seed/4294967296-0.5) - (edge===0?22:0));
    const i=4*(y*size+x);
    pixels[i]=pixels[i+1]=pixels[i+2]=value; pixels[i+3]=255;
  }
  const map=new THREE.DataTexture(pixels,size,size);
  map.colorSpace=THREE.SRGBColorSpace;
  map.wrapS=map.wrapT=THREE.RepeatWrapping;
  map.generateMipmaps=true;
  map.minFilter=THREE.LinearMipmapLinearFilter;
  map.magFilter=THREE.LinearFilter;
  map.anisotropy=4;
  map.needsUpdate=true;
  return map;
}

export function createPlatform({ shoreDistance = 100 } = {}) {
  const group = new THREE.Group();
  group.name = '松原湖岸・プラットフォーム';
  const shoreEnd = Math.max(rear + 8, shoreDistance);
  const positions = [], colors = [], tubes = [];
  const red = '#d8254e', blue = '#36bfdc', yellow = '#ffdb3a';
  const steel = '#718085', lightSteel = '#a3aeb0', braces = '#667679';
  const paint = new THREE.Color();

  // Solid panels use one geometry and the scaffold uses one instanced draw.
  function triangle(a, b, c, color) {
    // Orient sloped decking toward the light, including the radial fan panels.
    const normalY=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
    if(normalY<0) positions.push(...a,...c,...b);
    else positions.push(...a,...b,...c);
    paint.set(color);
    for (let i = 0; i < 3; i++) colors.push(paint.r, paint.g, paint.b);
  }
  function quad(a, b, c, d, color) {
    triangle(a, b, c, color);
    triangle(a, c, d, color);
  }
  function tube(a, b, diameter, color) {
    tubes.push({ a, b, diameter, color });
  }
  function at(x, z, lift = 0) { return [x, deckHeight(z) + lift, z]; }
  function panel(x0, x1, z0, z1, color, lift = 0) {
    quad(at(x0, z0, lift), at(x0, z1, lift), at(x1, z1, lift), at(x1, z0, lift), color);
  }
  function fanPoint(angle, r, lift = 0) {
    const z = deckRun * (1 - (r / radius) * Math.cos(angle));
    return at(r * Math.sin(angle), z, lift);
  }

  // The radial yellow panel ends in a curved red safety strip; the flanking
  // blue wings fill out the rectangular working deck behind the circular lip.
  const edgeZ = fanPoint(halfAngle, radius)[2];
  for (let i = 0; i < 36; i++) {
    const left = -halfAngle + i * 2 * halfAngle / 36;
    const right = -halfAngle + (i + 1) * 2 * halfAngle / 36;
    const a = fanPoint(left, radius), b = fanPoint(right, radius);
    const innerA = fanPoint(left, radius - 0.67), innerB = fanPoint(right, radius - 0.67);
    triangle(fanPoint(0, 0), innerA, innerB, yellow);
    quad(a, b, innerB, innerA, red);
    quad(a, [a[0], a[1] - 0.18, a[2]], [b[0], b[1] - 0.18, b[2]], b, '#b32543');
  }
  for (const sign of [-1, 1]) {
    const edge = sign * halfWidth;
    triangle(at(0, deckRun), at(edge, edgeZ), at(edge, deckRun), blue);
    quad(at(edge, edgeZ), at(edge, rear), at(edge, rear, -0.18), at(edge, edgeZ, -0.18), '#3599a9');
  }
  panel(-halfWidth, halfWidth, deckRun, rear, blue);
  // The painted centre lane carries through from the staging deck into the fan.
  panel(-0.7, 0.7, deckRun, rear, yellow, 0.006);
  for (const sign of [-1, 1]) {
    // Rear service galleries are lower than the launch surface. No rail
    // crosses the launch edge or the area swept by an aircraft at departure.
    const inner = sign * halfWidth, outer = sign * (halfWidth + 1.1);
    panel(Math.min(inner, outer), Math.max(inner, outer), 7.5, rear, '#a99678', -0.5);
    for (const y of [0.05, 0.52]) tube(at(outer, 7.5, y), at(outer, rear, y), 0.055, lightSteel);
    for (let z = 7.5; z <= rear; z += 2.1) tube(at(outer, z, -0.57), at(outer, z, 0.55), 0.062, steel);
  }

  const rows = [0.95, 3.3, 6.25, 9.3, 12.35, 15.65];
  const frameWidth = z => Math.min(halfWidth - 0.18, radius * Math.sqrt(1 - Math.max(0, 1 - z / deckRun) ** 2) - 0.25);
  for (let j = 0; j < rows.length; j++) {
    const z = rows[j], w = frameWidth(z);
    for (let i = 0; i <= 4; i++) {
      const x = (i / 2 - 1) * w;
      tube([x, -0.45, z], at(x, z, -0.12), 0.098, steel);
      if (i < 4) {
        const nextX = x + w / 2;
        tube(at(x, z, -0.22), at(nextX, z, -0.22), 0.17, lightSteel);
        for (const h of [0.75, 3.75, 6.75]) {
          tube([x, h, z], [nextX, h, z], 0.075, steel);
          if (j === 0 || j === rows.length - 1) {
            tube([x, h, z], [nextX, h + 2.85, z], 0.057, braces);
            tube([nextX, h, z], [x, h + 2.85, z], 0.057, braces);
          }
        }
      }
      if (j + 1 === rows.length) continue;
      const nextZ = rows[j + 1], nextX = (i / 2 - 1) * frameWidth(nextZ);
      tube(at(x, z, -0.14), at(nextX, nextZ, -0.14), 0.16, steel);
      if (i === 0 || i === 4) {
        for (const h of [0.75, 3.75, 6.75]) {
          tube([x, h, z], [nextX, h, nextZ], 0.08, lightSteel);
          tube([x, h, z], [nextX, h + 2.85, nextZ], 0.058, braces);
          tube([x, h + 2.85, z], [nextX, h, nextZ], 0.058, braces);
        }
      }
    }
  }

  // The long timber gangway descends to the beach. Board lengths, bay spacing
  // and the 1.15 m shoreline elevation are reconstruction parameters.
  const bays = Math.ceil((shoreEnd - rear) / 4);
  const boardColors = ['#a49680', '#b5a68b', '#a89d89', '#c1ad90', '#b5a38d'];
  const pierHeight = z => THREE.MathUtils.lerp(deckHeight(rear), 1.15, (z - rear) / (shoreEnd - rear));
  const pier = (x, z, dy = 0) => [x, pierHeight(z) + dy, z];
  const pierWidth = 4.2, boards = 18;
  for (let j = 0; j < bays; j++) {
    const z0 = rear + (shoreEnd - rear) * j / bays;
    const z1 = rear + (shoreEnd - rear) * (j + 1) / bays;
    for (let i = 0; i < boards; i++) {
      const x = (i / boards - 0.5) * pierWidth;
      const x1 = x + pierWidth / boards - 0.009;
      const color = i >= 7 && i <= 10 ? '#48aaca' : boardColors[(i * 7 + j * 3) % boardColors.length];
      quad(pier(x, z0), pier(x, z1 - 0.01), pier(x1, z1 - 0.01), pier(x1, z0), color);
    }
    for (const sign of [-1, 1]) {
      const x = sign * (pierWidth / 2 - 0.05);
      tube([x, -0.4, z0], pier(x, z0, 0.85), 0.085, steel);
      tube(pier(x, z0, -0.17), pier(x, z1, -0.17), 0.15, steel);
      tube(pier(x, z0, 0.85), pier(x, z1, 0.85), 0.049, lightSteel);
      tube(pier(x, z0, 0.4), pier(x, z1, 0.4), 0.034, lightSteel);
      tube(pier(x, z0, -0.25), [x, 0.27, z1], 0.061, braces);
      if (j === bays - 1) tube([x, -0.4, z1], pier(x, z1, 0.85), 0.085, steel);
    }
    tube(pier(-pierWidth / 2, z0, -0.23), pier(pierWidth / 2, z0, -0.23), 0.12, steel);
  }

  const panels = new THREE.BufferGeometry();
  panels.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const uv=[];
  for(let i=0;i<positions.length;i+=3) uv.push(positions[i]/1.82,positions[i+2]/0.91);
  panels.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  panels.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  panels.computeVertexNormals();
  const deck = new THREE.Mesh(panels, new THREE.MeshStandardMaterial({
    map:deckFinish(), vertexColors: true, side: THREE.DoubleSide, roughness: 0.88
  }));
  deck.name = '助走面・作業床・木製搬入路';
  deck.receiveShadow = deck.castShadow = true;
  group.add(deck);

  const frame = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.34, roughness: 0.55 }), tubes.length);
  frame.name = '鋼管足場';
  const transform = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3(), start = new THREE.Vector3(), end = new THREE.Vector3();
  tubes.forEach(({ a, b, diameter, color }, i) => {
    start.fromArray(a); end.fromArray(b);
    dir.subVectors(end, start);
    transform.position.addVectors(start, end).multiplyScalar(0.5);
    transform.scale.set(diameter, dir.length(), diameter);
    transform.quaternion.setFromUnitVectors(up, dir.normalize());
    transform.updateMatrix();
    frame.setMatrixAt(i, transform.matrix);
    frame.setColorAt(i, paint.set(color));
  });
  frame.computeBoundingSphere();
  frame.castShadow = frame.receiveShadow = true;
  group.add(frame);
  return group;
}
