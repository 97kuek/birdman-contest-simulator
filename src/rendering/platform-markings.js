import * as THREE from 'three';
import { deckHeight } from './launch-deck.js';

// QX-25, 2025 official broadcast, overhead and side views:
// https://www.youtube.com/watch?v=SFUEIepMicU&t=174s
// Reconstructed lettering, panel dimensions and attachment points.
function markingAtlas() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  function strip(row, background, color, font, lines) {
    const top = row * 256;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, top, 1024, 256);
    }
    ctx.fillStyle = color;
    ctx.font = font;
    lines.forEach((line, i) => {
      ctx.fillText(line, 512, top + (i + .5) * 256 / lines.length + 3, 984);
    });
  }
  strip(0, null, '#d52941', 'italic 900 218px "Arial Black", sans-serif', ['BIRDMAN RALLY']);
  strip(1, '#fffdf9', '#cc2037', 'bold 229px Helvetica, Arial, sans-serif', ['Iwatani']);
  strip(2, '#fffdf9', '#182556', 'bold 93px sans-serif', ['水素で　世界を動かせ。']);
  strip(3, '#223865', '#ffffff', 'bold 109px sans-serif', ['水素で', '世界を動かせ。']);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function createPlatformMarkings(halfWidth, deckRun) {
  const position = [], uv = [], faces = [];
  function mark(corners, row) {
    const start = position.length / 3;
    for (const p of corners) position.push(...p);
    const top = 1 - row / 4 - .002, bottom = 1 - (row + 1) / 4 + .002;
    uv.push(.002, bottom, .998, bottom, .998, top, .002, top);
    faces.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const top = (x, z) => [x, deckHeight(z) + .014, z];
  // Read the centre lettering from the lip back toward the staging deck.
  mark([top(-.48, .88), top(-.48, 8.65), top(.48, 8.65), top(.48, .88)], 0);
  for (const side of [-1, 1]) {
    const x = side * 3.65;
    mark([top(x - 1.67, deckRun + 2.25), top(x + 1.67, deckRun + 2.25),
      top(x + 1.67, deckRun + 1.10), top(x - 1.67, deckRun + 1.10)], side < 0 ? 2 : 1);
    // Cloth signs hang below the deck outside the working galleries.
    for (const [a, b, row] of [[5.45, 9.95, 3], [10.02, 15.08, 1]]) {
      const left = side > 0 ? b : a, right = side > 0 ? a : b;
      const vert = (z, dy) => [side * (halfWidth + 1.15), deckHeight(z) + dy, z];
      mark([vert(left, -2.22), vert(right, -2.22), vert(right, -.57), vert(left, -.57)], row);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(faces);
  geo.computeVertexNormals();
  const marking = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: markingAtlas(), roughness: .9, alphaTest: .35, side: THREE.DoubleSide,
  }));
  marking.name = '助走面の大会名・台側面の掲示幕';
  marking.receiveShadow = true;
  return marking;
}
