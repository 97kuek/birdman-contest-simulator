import * as THREE from 'three';
import { readFlightInstruments } from '../../domain/flight-instruments.js';

const WIDTH = 600, HEIGHT = 300;
const INK = '#172f33', PAPER = '#d7e3d7', SECONDARY = '#aec2b4';
// A single LCD mounted inside the glider. The telemetry also describes the WebGL
// canvas for readers that cannot see the texture.
export function createCockpitDisplay(aircraft, { describe, aircraftId }) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.149, 0.0745),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  aircraft.getObjectByName('cockpit-display-mount').add(face);
  ctx.textAlign = 'center';

  function text(value, x, y, size, color = INK, maxWidth = WIDTH) {
    ctx.font = 'bold ' + size + 'px sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(value, x, y, maxWidth);
  }
  function primary(label, value, unit, x, top) {
    text(label, x, top + 33, 35);
    text(value, x, top + 133, 100, INK, 245);
    text(unit, x, top + 171, 29);
  }
  let sample, instruments, previous;
  function update(next) {
    sample = next;
    instruments = readFlightInstruments(next, aircraftId);
    const onDeck = next.t === undefined;
    const speed = instruments.airspeed.toFixed(1), height = instruments.altitude.toFixed(1);
    const rudder = Math.round(next.rudderDeg ?? 0);
    const key = [onDeck, speed, height, rudder].join('/');
    if (key === previous) return;
    previous = key;

    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const top = 56;
    primary('対気速度', speed, 'm/s', 150, top);
    primary('推定高度', height, 'm', 450, top);
    ctx.fillStyle = SECONDARY;
    ctx.fillRect(299, top + 7, 2, 164);
    texture.needsUpdate = true;
    const command = rudder === 0 ? '中立' : (rudder > 0 ? '右' : '左') + Math.abs(rudder) + '°';
    describe('対気速度 ' + speed + ' m/s、推定高度 ' + height + ' m' + (onDeck ? '' : '、ラダー ' + command) + '。');
  }
  return { update, get sample() { return sample; }, get instruments() { return instruments; } };
}
