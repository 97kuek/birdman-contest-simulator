import * as THREE from 'three';

// Typeset the identification in the host's fonts.
const letteringMaps = new Map();
export function lettering(label) {
  if (!letteringMaps.has(label) && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#152b31';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = label === '竜海' ? 'bold 130px "Hiragino Mincho ProN","Yu Mincho",serif' : 'bold 104px Arial,sans-serif';
      ctx.fillText(label, 256, 84, 500);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      letteringMaps.set(label, texture);
    }
  }
  const map = letteringMaps.get(label);
  return new THREE.MeshBasicMaterial({
    map: map || null, visible: !!map, alphaTest: 0.35, side: THREE.FrontSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}
