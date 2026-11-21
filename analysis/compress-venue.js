// Lossless buffer compression. Blender still owns the mesh topology, normals and UVs.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { MeshoptEncoder } from 'meshoptimizer';

const [input, output] = process.argv.slice(2);
const raw = readFileSync(input);
const jsonLength = raw.readUInt32LE(12);
const doc = JSON.parse(raw.subarray(20, 20 + jsonLength));
const binary = raw.subarray(28 + jsonLength);
const chunks = [];
let length = 0;

function append(bytes) {
  const offset = length;
  const pad = (4 - bytes.length % 4) % 4;
  chunks.push(bytes, Buffer.alloc(pad));
  length += bytes.length + pad;
  return offset;
}

await MeshoptEncoder.ready;
const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const dimensions = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const fallback = doc.buffers[0].byteLength;
for (const [i, view] of doc.bufferViews.entries()) {
  const start = view.byteOffset || 0;
  const bytes = binary.subarray(start, start + view.byteLength);
  const accessor = doc.accessors.find(a => a.bufferView === i);
  const stride = view.byteStride || (accessor && componentBytes[accessor.componentType] * dimensions[accessor.type]);
  const mode = view.target === 34963 ? 'TRIANGLES' : 'ATTRIBUTES';
  if (!stride || bytes.length % stride || (mode === 'ATTRIBUTES' && (stride % 4 || stride > 256))) {
    view.byteOffset = append(bytes);
    continue;
  }
  const count = bytes.length / stride;
  const compressed = MeshoptEncoder.encodeGltfBuffer(bytes, count, stride, mode, 0);
  view.extensions = { EXT_meshopt_compression: {
    buffer: 0, byteOffset: append(compressed), byteLength: compressed.length, byteStride: stride, count, mode,
  } };
  view.buffer = 1;
}
doc.buffers = [{ byteLength: length }, { byteLength: fallback, extensions: { EXT_meshopt_compression: { fallback: true } } }];
for (const key of ['extensionsRequired', 'extensionsUsed']) (doc[key] ??= []).push('EXT_meshopt_compression');
const json = Buffer.from(JSON.stringify(doc));
const jsonSize = Math.ceil(json.length / 4) * 4;
const header = Buffer.alloc(20);
header.write('glTF');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonSize + length, 8);
header.writeUInt32LE(jsonSize, 12);
header.write('JSON', 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(length);
binHeader.write('BIN', 4);
writeFileSync(output, gzipSync(Buffer.concat([header, json, Buffer.alloc(jsonSize-json.length, 32), binHeader, ...chunks]), { level: 9 }));
