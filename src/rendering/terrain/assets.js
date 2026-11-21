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
  return { json, photo, texture };
}
