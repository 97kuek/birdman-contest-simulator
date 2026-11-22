import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

// Reuse the original vertex attributes, UVs and materials at both distances.
// The alternate index lists are small (only a few hundred entries per tree).
export async function addVenueLod(document, readView) {
  await MeshoptSimplifier.ready;
  function readAccessor(id, Type, size) {
    const accessor = document.accessors[id];
    const view = document.bufferViews[accessor.bufferView];
    const bytes = readView(accessor.bufferView);
    const stride = (view.byteStride ?? Type.BYTES_PER_ELEMENT * size) / Type.BYTES_PER_ELEMENT;
    const array = new Type(bytes.buffer, bytes.byteOffset + (accessor.byteOffset ?? 0),
      (accessor.count - 1) * stride + size);
    if (stride === size) return array;
    return Type.from({ length: accessor.count * size }, (_, i) => array[Math.floor(i / size) * stride + i % size]);
  }
  for (const node of document.nodes) {
    const instances = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
    if (!instances) continue;
    const count = document.accessors[instances.TRANSLATION].count;
    if (count < 80) continue;
    for (const primitive of document.meshes[node.mesh].primitives) {
      const indices = document.accessors[primitive.indices];
      // A field of two-triangle cards is already cheaper in a single draw.
      if (indices.count <= 6 || count * indices.count / 3 < 15000) continue;
      const detail = {};
      (primitive.extras ??= {}).venueLod = detail;
      const Type = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array }[indices.componentType];
      const original = Uint32Array.from(readAccessor(primitive.indices, Type, 1));
      const positions = readAccessor(primitive.attributes.POSITION, Float32Array, 3);
      const [reduced, error] = MeshoptSimplifier.simplify(original, positions, 3,
        3 * Math.ceil(indices.count / 3 * .23), .045, ['Permissive']);
      if (reduced.length < .8 * indices.count) {
        detail.indices = Array.from(reduced);
        detail.error = error * MeshoptSimplifier.getScale(positions, 3);
      }
    }
  }
}
