import * as THREE from 'three';

const missing = -32768;
const water = -32767;

export function inBounds(x, z, bounds) {
  return bounds && x > bounds[0] && x < bounds[2] && z > bounds[1] && z < bounds[3];
}

// Sample the same two triangles that terrainMesh emits, including their diagonal.
// This is also the height that finer data has to meet at the edge of a hole.
function surfaceHeight(surface, x, z) {
  const { layer, heights } = surface;
  const { bounds, width, height } = layer;
  const u = THREE.MathUtils.clamp((x-bounds[0])/(bounds[2]-bounds[0])*(width-1),0,width-1);
  const v = THREE.MathUtils.clamp((z-bounds[1])/(bounds[3]-bounds[1])*(height-1),0,height-1);
  const i = Math.min(Math.floor(u),width-2), j = Math.min(Math.floor(v),height-2);
  const fx = u-i, fz = v-j, at = j*width+i;
  const a = heights[at], b = heights[at+1], c = heights[at+width], d = heights[at+width+1];
  return fx+fz <= 1 ? a+(b-a)*fx+(c-a)*fz : d+(c-d)*(1-fx)+(b-d)*(1-fz);
}

export function terrainMesh(layer, elevations, texture, parent) {
  const { width, height, bounds, hole } = layer;
  const [west, north, east, south] = bounds;
  const dx = (east - west) / (width - 1);
  const dz = (south - north) / (height - 1);
  const positions = new Float32Array(width * height * 3);
  const uv = new Float32Array(width * height * 2);
  const tint = texture ? null : new Float32Array(positions.length);
  const indices = [];
  const heights = new Float32Array(width * height);

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const k = j * width + i;
      const v = elevations[k];
      const x = west + i * dx;
      const z = north + j * dz;
      positions[k * 3] = x;
      let y = v === water ? -0.7 : (v === missing ? 0 : Math.max(0.12, v * 0.1));
      const fromEdge = Math.min(i,j,width-1-i,height-1-j);
      if (parent && fromEdge < 3) {
        y = THREE.MathUtils.lerp(surfaceHeight(parent,x,z),y,fromEdge/3);
      }
      heights[k] = y;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
      uv[k * 2] = i / (width - 1);
      uv[k * 2 + 1] = 1 - j / (height - 1);

      // Ridge shading uses real relief. This material also works with no scene lights.
      if (tint) {
        const vEast = elevations[j * width + Math.min(i + 1, width - 1)];
        const vNorth = elevations[Math.max(j - 1, 0) * width + i];
        const gradient = vEast > water && vNorth > water ? (vEast - vNorth) * 0.1 / dx : 0;
        const brightness = THREE.MathUtils.clamp(1 + gradient * 0.5, 0.67, 1.28);
        const high = THREE.MathUtils.clamp((v * 0.1 - 40) / 380, 0, 1);
        tint[k * 3] = (0.135 - high * 0.038) * brightness;
        tint[k * 3 + 1] = (0.217 - high * 0.042) * brightness;
        tint[k * 3 + 2] = (0.183 - high * 0.026) * brightness;
      }

      if (i === width - 1 || j === height - 1 || inBounds(x + dx / 2, z + dz / 2, hole)) continue;
      const a = k, b = k + 1, c = k + width, d = c + 1;
      for (const [p, q, r] of [[a, c, b], [b, c, d]]) {
        const vp = elevations[p], vq = elevations[q], vr = elevations[r];
        if (vp === missing || vq === missing || vr === missing) continue;
        if (vp === water && vq === water && vr === water) continue;
        indices.push(p, q, r);
      }
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setIndex(indices);
  if (texture) geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (tint) geom.setAttribute('color', new THREE.BufferAttribute(tint, 3));
  const mat = new THREE.MeshBasicMaterial({ map: texture, vertexColors: Boolean(tint),
    polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-2 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = `GSI terrain · ${layer.name}`;
  return {mesh,layer,heights,photo:texture};
}

export function matsubaraGround(detail, buffer, texture, parent) {
  const { bounds, vertices, triangles } = detail;
  const [west, north, east, south] = bounds;
  const Index = vertices > 65535 ? Uint32Array : Uint16Array;
  const indexOffset = vertices * 6;
  if (buffer.byteLength !== indexOffset + triangles * 3 * Index.BYTES_PER_ELEMENT) {
    throw new Error('Invalid Matsubara terrain mesh');
  }
  const samples = new Int16Array(buffer, 0, vertices * 3);
  const positions = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  for (let i = 0; i < vertices; i++) {
    // Restore exact shared boundary coordinates after decimetre quantisation.
    const qx = samples[i*3], qz = samples[i*3+2];
    const x = qx === Math.round((east-west)*10) ? east-west : qx*0.1;
    const z = qz === Math.round((south-north)*10) ? south-north : qz*0.1;
    const distance = Math.min(x,z,east-west-x,south-north-z);
    let y = samples[i*3+1]*0.01;
    if (distance < 3.9) y = THREE.MathUtils.lerp(surfaceHeight(parent,west+x,north+z),y,distance/3.9);
    positions.set([west+x,y,north+z],i*3);
    uv.set([x / (east - west), 1 - z / (south - north)], i * 2);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.setIndex(new THREE.BufferAttribute(new Index(buffer, indexOffset), 1));
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ map: texture,
    polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-2 }));
  mesh.name = 'Matsubara beach and estuary · clipped DEM1A';
  return mesh;
}
