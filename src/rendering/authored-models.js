import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { prepareSceneryLod } from './terrain/scenery-lod.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const models = new Map();

// Both venues use the same instrument. Copies share geometry and materials.
export function loadAuthoredModel(name) {
  if (!models.has(name)) {
    const url = new URL('models/' + name + '.glb', document.baseURI);
    const pending = loader.loadAsync(url.href).then(({ scene }) => {
      scene.traverse(part => {
        if (part.isMesh) part.castShadow = part.receiveShadow = true;
      });
      return scene;
    }).catch(error => {
      models.delete(name);
      throw error;
    });
    models.set(name, pending);
  }
  return models.get(name).then(scene => scene.clone());
}

// Large venues stay separate downloads. Native decompression is preferred on
// mobile; the bundled fallback also accepts already-decoded static responses.
export async function loadVenueModel(name) {
  const url = new URL('models/' + name + '.glb.gz', document.baseURI);
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load ' + url.pathname + ' (' + response.status + ')');
  let bytes = await response.arrayBuffer();
  const magic = new Uint8Array(bytes, 0, 2);
  if (magic[0] === 0x1f && magic[1] === 0x8b) {
    if (typeof DecompressionStream === 'function') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = await new Response(stream).arrayBuffer();
    } else {
      const { gunzipSync } = await import('three/addons/libs/fflate.module.js');
      bytes = gunzipSync(new Uint8Array(bytes)).buffer;
    }
  }
  const { scene } = await loader.parseAsync(bytes, new URL('.', url).href);
  scene.traverse(part => {
    if (!part.isMesh) return;
    if (!name.endsWith('-scenery')) part.castShadow = part.receiveShadow = true;
    const material = part.material;
    if (material.map) material.map.anisotropy = 8;
    const offset = material.userData.offset;
    if (offset) {
      material.polygonOffset = true;
      [material.polygonOffsetFactor, material.polygonOffsetUnits] = offset;
    }
  });
  if (name.endsWith('-scenery')) prepareSceneryLod(scene);
  return scene;
}
