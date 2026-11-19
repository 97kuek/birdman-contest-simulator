import * as THREE from 'three';
import { RADIANS_PER_DEGREE } from '../../domain/units.js';
import { readFlightInstruments } from '../../domain/flight-instruments.js';
import { windReading } from '../../domain/weather.js';

const WIDTH = 600, HEIGHT = 300;
const INK = '#172f33', PAPER = '#d7e3d7', SECONDARY = '#aec2b4';
const degrees = radians => Math.round((radians ?? 0) / RADIANS_PER_DEGREE);
function windArrow(ctx, angle) {
  ctx.save();
  ctx.translate(220, 258);
  ctx.rotate(angle * RADIANS_PER_DEGREE);
  ctx.beginPath();
  ctx.moveTo(0, 12); ctx.lineTo(0, -12);
  ctx.moveTo(-7, -4); ctx.lineTo(0, -12); ctx.lineTo(7, -4);
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

// A single LCD mounted inside the glider. The telemetry also describes the WebGL
// canvas for readers that cannot see the texture.
export function createCockpitDisplay(aircraft, { weather, describe }) {
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
    instruments = readFlightInstruments(next);
    const onDeck = next.t === undefined;
    const wind = onDeck && windReading(weather(), next.heading, next, next.windTime ?? 0);
    const speed = instruments.airspeed.toFixed(1), height = instruments.altitude.toFixed(1);
    const rudder = Math.round(next.rudderDeg ?? 0);
    const windSpeed = onDeck ? wind.speed.toFixed(1) : '', flow = onDeck ? degrees(wind.angle) : 0;
    const key = [speed, height, windSpeed, flow, rudder].join('/');
    if (key === previous) return;
    previous = key;

    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const top = onDeck ? 18 : 56;
    primary('対気速度', speed, 'm/s', 150, top);
    primary('推定高度', height, 'm', 450, top);
    ctx.fillStyle = SECONDARY;
    ctx.fillRect(299, top + 7, 2, 164);
    if (onDeck) {
      ctx.fillStyle = INK;
      ctx.fillRect(0, 218, WIDTH, 82);
      if (wind.speed >= .05) windArrow(ctx, flow);
      text(wind.speed < .05 ? '無風' : '風 ' + windSpeed + ' m/s', 325, 270, 36, PAPER);
    }
    texture.needsUpdate = true;
    const command = rudder === 0 ? '中立' : (rudder > 0 ? '右' : '左') + Math.abs(rudder) + '°';
    describe('対気速度 ' + speed + ' m/s、推定高度 ' + height + ' m、' +
      (onDeck ? '台上の風速 ' + windSpeed + ' m/s' : 'ラダー ' + command) + '。');
  }
  return { update, get sample() { return sample; }, get instruments() { return instruments; } };
}
