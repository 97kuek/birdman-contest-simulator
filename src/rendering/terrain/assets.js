import * as THREE from 'three';

// Each venue owns its files beneath the page URL (including on GitHub Pages).
export function terrainAssets(directory) {
  const loader = new THREE.TextureLoader();
  const url = name => new URL(directory + '/' + name, document.baseURI).href;

  async function fetchFile(name) {
    const response = await fetch(url(name));
    if (!response.ok) throw new Error(`Terrain asset ${directory}/${name}: ${response.status}`);
    return response;
  }

  async function buffer(name) {
    const bytes = await (await fetchFile(name)).arrayBuffer();
    if (!name.endsWith('.gz')) return bytes;
    const header = new Uint8Array(bytes);
    // A static host may already have decoded the Content-Encoding.
    if (header[0] !== 0x1f || header[1] !== 0x8b) return bytes;
    if (typeof DecompressionStream === 'function') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).arrayBuffer();
    }
    const { gunzipSync } = await import('three/addons/libs/fflate.module.js');
    return gunzipSync(header).buffer;
  }

  async function elevations(layer, name) {
    const bytes = await buffer(name);
    if (bytes.byteLength !== layer.width * layer.height * Int16Array.BYTES_PER_ELEMENT)
      throw new Error(`Invalid elevation grid: ${directory}/${name}`);
    return new Int16Array(bytes);
  }

  const texture = name => loader.loadAsync(url(name));
  async function photo(name, anisotropy) {
    const image = await texture(name);
    image.colorSpace = THREE.SRGBColorSpace;
    image.anisotropy = anisotropy;
    return image;
  }
  async function json(name) {
    return (await fetchFile(name)).json();
  }
  return { buffer, elevations, json, photo, texture };
}
