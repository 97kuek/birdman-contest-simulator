import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

// Meshoptimizer's quadric error budget is in local metres. In areas with
// buildings, vegetation and runway fixtures only level interiors may collapse.
const layers = new Map([
  ['GSI terrain · shore', { metres: .015, levelOnly: true }],
  ['GSI terrain · hills', { metres: .22 }],
  ['DEM_runway', { metres: .005, levelOnly: true }],
  ['DEM_river', { metres: .075, levelOnly: true }],
  ['DEM_mountains', { metres: 1.5, levelOnly: true }],
  ['DEM_fuji', { metres: 1.1 }],
]);

function planarPhotoUv(position, uv, indices) {
  // Fit the affine map in XZ from one triangle and check the whole photograph.
  const [a, b, c] = indices.subarray(0, 3);
  const ax = position[3*a], az = position[3*a+2];
  const bx = position[3*b] - ax, bz = position[3*b+2] - az;
  const cx = position[3*c] - ax, cz = position[3*c+2] - az;
  const det = bx * cz - cx * bz;
  if (Math.abs(det) < .0001) return false;
  for (let i = 0; i < position.length / 3; i++) {
    const x = position[3*i] - ax, z = position[3*i+2] - az;
    const u = (x * cz - z * cx) / det, v = (bx * z - bz * x) / det;
    for (let j = 0; j < 2; j++) {
      const base = uv[2*a+j];
      const expected = base + u * (uv[2*b+j] - base) + v * (uv[2*c+j] - base);
      if (Math.abs(uv[2*i+j] - expected) > .00003) return false;
    }
  }
  return true;
}

function lockSlopes(position, indices) {
  const lock = new Uint8Array(position.length / 3);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i+1], c = indices[i+2];
    const ya = position[3*a+1], yb = position[3*b+1], yc = position[3*c+1];
    if (Math.max(ya, yb, yc) - Math.min(ya, yb, yc) > .0001) lock[a] = lock[b] = lock[c] = 1;
  }
  return lock;
}

export async function simplifyVenueTerrain(doc, readView) {
  await MeshoptSimplifier.ready;
  const replacements = new Map();
  const references = new Map();
  for (const mesh of doc.meshes) for (const primitive of mesh.primitives) {
    for (const id of [primitive.indices, ...Object.values(primitive.attributes)]) {
      references.set(id, (references.get(id) ?? 0) + 1);
    }
  }
  function replace(accessor, array, dimensions) {
    accessor.count = array.length / dimensions;
    if (accessor.min || accessor.max) {
      const min = Array(dimensions).fill(Infinity), max = Array(dimensions).fill(-Infinity);
      for (let i = 0; i < array.length; i++) {
        const j = i % dimensions;
        min[j] = Math.min(min[j], array[i]);
        max[j] = Math.max(max[j], array[i]);
      }
      Object.assign(accessor, { min, max });
    }
    replacements.set(accessor.bufferView, new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  for (const node of doc.nodes) {
    const policy = layers.get(node.name);
    if (!policy || node.mesh === undefined) continue;
    const mesh = doc.meshes[node.mesh];
    if (mesh.primitives.length !== 1) continue;
    const p = mesh.primitives[0], attrs = p.attributes;
    if (Object.keys(attrs).sort().join(',') !== 'NORMAL,POSITION,TEXCOORD_0' || p.targets) continue;
    const ids = [p.indices, attrs.POSITION, attrs.NORMAL, attrs.TEXCOORD_0];
    // These Blender exports have a tightly packed, private view per attribute.
    // Leave differently authored or shared buffers intact.
    if (ids.some(id => {
      const a = doc.accessors[id], view = doc.bufferViews[a.bufferView];
      return references.get(id) !== 1 || a.sparse || a.byteOffset || view.byteStride
        || doc.accessors.some(other => other !== a && other.bufferView === a.bufferView);
    })) continue;
    const [idx, pos, normal, uv] = ids.map(id => doc.accessors[id]);
    if (![5123, 5125].includes(idx.componentType) || [pos, normal, uv].some(a => a.componentType !== 5126)) continue;
    function values(a, Type) {
      const bytes = readView(a.bufferView);
      return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
    }
    const original = Uint32Array.from(values(idx, idx.componentType === 5123 ? Uint16Array : Uint32Array));
    const position = values(pos, Float32Array), texcoords = values(uv, Float32Array);
    if (!planarPhotoUv(position, texcoords, original)) continue;
    const lock = policy.levelOnly ? lockSlopes(position, original) : null;
    const [reduced] = MeshoptSimplifier.simplifyWithAttributes(original, position, 3,
      new Float32Array(), 0, [], lock, 3 * Math.ceil(original.length / 3 * .18),
      policy.metres, ['ErrorAbsolute', 'LockBorder']);
    if (reduced.length > .95 * original.length) continue;
    const [remap, count] = MeshoptSimplifier.compactMesh(reduced);
    idx.componentType = count <= 65535 ? 5123 : 5125;
    replace(idx, idx.componentType === 5123 ? Uint16Array.from(reduced) : reduced, 1);
    for (const [accessor, data, size] of [[pos, position, 3], [normal, values(normal, Float32Array), 3], [uv, texcoords, 2]]) {
      const compact = new Float32Array(count * size);
      for (let old = 0; old < remap.length; old++) {
        if (remap[old] !== 0xffffffff) compact.set(data.subarray(old * size, (old + 1) * size), remap[old] * size);
      }
      replace(accessor, compact, size);
    }
  }
  return replacements;
}
