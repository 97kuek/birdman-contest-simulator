import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simplifyVenueTerrain } from '../analysis/simplify-venue-terrain.js';

function runwayFixture(warpUv = false) {
  const positions = [], normals = [], uv = [], indices = [];
  const side = 25;
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    const y = x === 12 ? .3 : 0;
    positions.push(x, y, z);
    normals.push(0, 1, 0);
    uv.push(x / (side - 1), z / (side - 1));
    const i = x + z * side;
    if (x + 1 < side && z + 1 < side) indices.push(i, i + side, i + 1, i + 1, i + side, i + side + 1);
  }
  if (warpUv) uv[uv.length - 2] -= .05;
  const arrays = [Uint16Array.from(indices), Float32Array.from(positions), Float32Array.from(normals), Float32Array.from(uv)];
  const doc = {
    nodes: [{ name: 'DEM_runway', mesh: 0 }],
    meshes: [{ primitives: [{ indices: 0, attributes: { POSITION: 1, NORMAL: 2, TEXCOORD_0: 3 } }] }],
    bufferViews: arrays.map(array => ({ byteLength: array.byteLength })),
    accessors: arrays.map((array, i) => ({
      componentType: i === 0 ? 5123 : 5126, bufferView: i, count: i === 0 ? array.length : side * side,
    })),
  };
  return { doc, readView: i => new Uint8Array(arrays[i].buffer), side };
}

test('地形の配布用メッシュは外周と土手の頂点を保ち、写真UVの歪んだ地形は温存する', async () => {
  const { doc, readView, side } = runwayFixture();
  const replacements = await simplifyVenueTerrain(doc, readView);
  assert.ok(doc.accessors[1].count < side * side * .75);
  const position = new Float32Array(replacements.get(1).buffer);
  const points = new Set();
  for (let i = 0; i < position.length; i += 3) points.add(Array.from(position.subarray(i, i + 3)).join(','));
  for (let i = 0; i < side; i++) {
    for (const x of [0, 11, 12, 13, side - 1]) assert.ok(points.has([x, x === 12 ? .3 : 0, i].map(Math.fround).join(',')));
    for (const z of [0, side - 1]) assert.ok(points.has([i, i === 12 ? .3 : 0, z].map(Math.fround).join(',')));
  }
  const warped = runwayFixture(true);
  assert.equal((await simplifyVenueTerrain(warped.doc, warped.readView)).size, 0);
});
