// Headless geometry analyses use authored transforms without decoding images.
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function readModel(file) {
  const data = await readFile(new URL('../assets/models/' + file, import.meta.url));
  const raw = file.endsWith('.gz') ? gunzipSync(data) : data;
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'HeadlessTextures', loadTexture: async () => new Texture() }));
  const { scene } = await loader.parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '');
  return scene;
}
