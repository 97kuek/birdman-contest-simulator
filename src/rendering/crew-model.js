import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const uniforms = {
  ryukai: { cloth: '#4eacb6', hem: '#42949f', trim: '#dbefeb' },
  ren: { cloth: '#db3e32', hem: '#bc362e', trim: '#f1e3cb' },
  qx25: { cloth: '#efa522', hem: '#d58b23', trim: '#b6761c' },
};
const finish = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .88 });

const profiles=[
  {name:'左翼',style:'HairSwept',side:-1,scale:.98,skin:'#c68e72',hair:'#262528',shoe:'#e3e4d7',phase:.25},
  {name:'胴体',style:'HairCrop',side:0,scale:1.035,skin:'#c9987c',hair:'#2e2927',shoe:'#374250',phase:2.25},
  {name:'右翼',style:'HairTied',side:1,scale:1.01,skin:'#d3a187',hair:'#232322',shoe:'#ece9e0',phase:4.55},
];
// glTF primitives are split by material. Tint the team kit and bake each
// joint to one mesh so the runner's moving parts still cost one draw each.
function person(model, profile, team) {
  const kit = uniforms[team];
  const palette = {
    Cloth: kit.cloth, Seam: kit.hem, Print: kit.trim,
    Skin: profile.skin, Hair: profile.hair, Upper: profile.shoe,
    HairLight: new THREE.Color(profile.hair).multiplyScalar(1.46),
  };
  function joint(...names) {
    const nodes = names.map(name => model.getObjectByName(name));
    const origin = nodes[0].getWorldPosition(new THREE.Vector3());
    const local = new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z);
    const parts = [];
    for (const node of nodes) {
      node.traverse(part => {
        if (!part.isMesh) return;
        const geometry = part.geometry.clone().applyMatrix4(local.clone().multiply(part.matrixWorld));
        const tint = palette[part.material.name];
        const color = tint ? new THREE.Color(tint) : part.material.color;
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        parts.push(geometry);
      });
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), finish);
    mesh.name = names[0];
    mesh.position.copy(origin);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }
  const root = new THREE.Group();
  root.name = 'プッシャー・' + profile.name;
  const torso = joint('Torso');
  const head = joint('Head', profile.style);
  head.position.sub(torso.position);
  torso.add(head);
  root.add(torso);
  function limb(name, sign) {
    const prefix = (sign < 0 ? 'L_' : 'R_') + name;
    const [upper, lower, end] = ['Upper', 'Lower', 'End'].map(suffix => joint(prefix + suffix));
    const [hip, knee, ankle] = [upper.position, lower.position, end.position];
    root.add(upper, lower, end);
    return { upper, lower, end, length: hip.distanceTo(knee), lowerLength: knee.distanceTo(ankle), sign };
  }
  const arms = [-1, 1].map(sign => limb('Arm', sign));
  const legs = [-1, 1].map(sign => limb('Leg', sign));
  root.scale.setScalar(profile.scale);
  return { root, torso, head, arms, legs, clips: model.getObjectByName('GroundCrewRig').userData.crewMotion, ...profile };
}

export function createCrewMembers(model, team = 'ryukai', count = profiles.length) {
  // Reveal the optional hair meshes on a private copy for profile assembly.
  const rest = model.clone();
  rest.traverse(part => {
    if (part.userData.crewRestScale) part.scale.fromArray(part.userData.crewRestScale);
  });
  rest.updateMatrixWorld(true);
  const models = profiles.map(profile => person(rest, profile, team));
  const members = models.slice(0, count);
  while (members.length < count) {
    const base = models[members.length % models.length];
    const root = base.root.clone();
    const copy = bone => root.children[base.root.children.indexOf(bone)];
    const limb = ({ upper, lower, end, ...rest }) => ({ ...rest, upper: copy(upper), lower: copy(lower), end: copy(end) });
    const torso = copy(base.torso);
    members.push({ ...base, root, torso, head: torso.children[0], arms: base.arms.map(limb), legs: base.legs.map(limb) });
  }
  return members;
}

// Waiting ground crew hold one pose for most of the trial. Bake that pose to
// a single draw call; articulated copies take over when a crew member moves.
function standingCrewGeometry(member) {
  const inverse = member.root.matrixWorld.clone();
  member.root.updateWorldMatrix(true, true);
  inverse.copy(member.root.matrixWorld).invert();
  const parts = [];
  member.root.traverse(part => {
    if (part.material !== finish) return;
    const local = inverse.clone().multiply(part.matrixWorld);
    parts.push(part.geometry.clone().applyMatrix4(local));
  });
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return geometry;
}

// At 100 m a few centimetres occupy less than one pixel in the overview.
// Cluster the baked standing pose in local metres, retaining its silhouette
// and vertex colours. The articulated skeleton is never simplified.
function distantStandingGeometry(source) {
  const cell = .055;
  const { position, color } = source.attributes;
  const cells = new Map(), remap = new Uint32Array(position.count);
  const vertices = [], colours = [], counts = [], indices = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const key = [x, y, z].map(v => Math.round(v / cell)).join(',');
    let id = cells.get(key);
    if (id === undefined) {
      id = counts.length;
      cells.set(key, id);
      counts.push(0);
      vertices.push(0, 0, 0);
      colours.push(0, 0, 0);
    }
    counts[id]++;
    remap[i] = id;
    const k = id * 3;
    vertices[k] += x; vertices[k + 1] += y; vertices[k + 2] += z;
    colours[k] += color.getX(i); colours[k + 1] += color.getY(i); colours[k + 2] += color.getZ(i);
  }
  const original = source.index.array;
  for (let i = 0; i < original.length; i += 3) {
    const a = remap[original[i]], b = remap[original[i + 1]], c = remap[original[i + 2]];
    if (a !== b && b !== c && c !== a) indices.push(a, b, c);
  }
  const mean = values => new THREE.Float32BufferAttribute(values.map((v, i) => v / counts[Math.floor(i / 3)]), 3);
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', mean(vertices));
  result.setAttribute('color', mean(colours));
  result.setIndex(indices);
  result.computeVertexNormals();
  return result;
}

export function waitingCrewModel(member) {
  const near = standingCrewGeometry(member);
  const lod = new THREE.LOD();
  for (const [geometry, distance] of [[near, 0], [distantStandingGeometry(near), 100]]) {
    const mesh = new THREE.Mesh(geometry, finish);
    mesh.castShadow = true;
    lod.addLevel(mesh, distance, .12);
  }
  return lod;
}
