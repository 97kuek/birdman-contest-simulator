import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadVenueModel } from '../authored-models.js';

// Geometry is available before a factory returns, including in command-line
// flight analyses. Headless consumers read the identical exported mesh.
const templates = new Map();
export function loadAircraftTemplate(id) {
  if (!templates.has(id)) {
    templates.set(id, readTemplate(id).catch(error => {
      templates.delete(id);
      throw error;
    }));
  }
  return templates.get(id);
}

async function readTemplate(id) {
  const name = 'aircraft-' + id;
  let scene;
  if (typeof document !== 'undefined') {
    scene = await loadVenueModel(name);
  } else {
    const source = new URL('../../../assets/models/' + name + '.glb.gz', import.meta.url);
    const bytes = await process.getBuiltinModule('fs').promises.readFile(source);
    const glb = process.getBuiltinModule('zlib').gunzipSync(bytes);
    const loader = new GLTFLoader();
    loader.register(() => ({ name: 'HeadlessTextures', loadTexture: async () => new Texture() }));
    ({ scene } = await loader.parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), ''));
  }
  const [root] = scene.children;
  root.traverse(part => {
    const data = part.userData;
    if (data.partName) part.name = data.partName;
    if (data.hidden) part.visible = false;
    if (part.isGroup && data.wingSide) {
      // glTF exposes a mesh with multiple materials as one mesh per primitive.
      for (const [i, child] of part.children.entries()) {
        Object.assign(child.userData, data);
        child.userData.partName = data.partName + (i ? '-film' : '');
      }
      part.name += '-panels';
    }
    if (!part.isMesh) return;
    part.castShadow = data.shadow !== 0 && !data.excludeFromHull;
    part.receiveShadow = true;
    part.renderOrder = data.renderLayer ?? 0;
    if (data.wingSide) part.frustumCulled = false;
    if (part.material.userData.depthWrite !== undefined) part.material.depthWrite = part.material.userData.depthWrite;
    if (part.material.userData.offset) {
      part.material.polygonOffset = true;
      [part.material.polygonOffsetFactor, part.material.polygonOffsetUnits] = part.material.userData.offset;
    }
  });
  return root;
}

export function matchingParts(root, name) {
  const parts = [];
  root.traverse(part => { if (part.name === name) parts.push(part); });
  return parts.sort((a, b) => a.userData.partIndex - b.userData.partIndex);
}
