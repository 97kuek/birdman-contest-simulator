import * as THREE from 'three';
import { RADIANS_PER_DEGREE } from '../../domain/units.js';
import { readFlightInstruments } from '../../domain/flight-instruments.js';
import { windReading } from '../../domain/weather.js';

const sources = { pressure: '気圧', blended: '気圧＋超音波', ultrasonic: '超音波' };
const WIDTH = 600, HEIGHT = 300;
const INK = '#172f33', PAPER = '#d7e3d7', SECONDARY = '#aec2b4';
const degrees = radians => Math.round((radians ?? 0) / RADIANS_PER_DEGREE);
const signed = value => value > 0 ? '+' + value : String(value);

function horizon(ctx, pitch, bank) {
  const radius = 43;
  ctx.save();
  ctx.translate(300, 91);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#658c98';
  ctx.fillRect(-radius, -radius, 2 * radius, 2 * radius);
  ctx.save();
  ctx.rotate(-bank * RADIANS_PER_DEGREE);
  const line = THREE.MathUtils.clamp(pitch, -35, 35);
  ctx.fillStyle = '#9d8463';
  ctx.fillRect(-65, line, 130, 120);
  ctx.fillStyle = '#f1f5e6';
  ctx.fillRect(-65, line - 1, 130, 3);
  ctx.restore();
  ctx.strokeStyle = '#fff8ac';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-32, 0); ctx.lineTo(-9, 0); ctx.lineTo(0, 5);
  ctx.lineTo(9, 0); ctx.lineTo(32, 0); ctx.stroke();
  ctx.restore();
}

function windArrow(ctx, angle) {
  ctx.save();
  ctx.translate(382, 274);
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
export function createCockpitDisplay(aircraft, { weather, platformBearing, describe }) {
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
  function primary(label, value, unit, x) {
    text(label, x, 39, 31);
    text(value, x, 119, 87, INK, 183);
    text(unit, x, 150, 27);
  }
  let sample, instruments, previous;
  function update(next) {
    sample = next;
    const wind = windReading(weather(), next.heading, next, next.windTime ?? next.t ?? 0);
    instruments = readFlightInstruments(next);
    const speed = instruments.airspeed.toFixed(1), height = instruments.altitude.toFixed(1);
    const source = sources[instruments.source];
    const pitch = degrees(next.pitch), bank = degrees(next.bank);
    const climb = Number((next.verticalSpeed ?? 0).toFixed(1));
    const rudder = Math.round(next.rudderDeg ?? 0);
    const course = (degrees(platformBearing + (next.track ?? next.heading)) % 360 + 360) % 360;
    const time = next.t === undefined ? '台上' : Math.floor(next.t) + ' s';
    const windSpeed = wind.speed.toFixed(1), flow = degrees(wind.angle);
    const key = [speed, height, source, pitch, bank, climb, rudder, course, time, windSpeed, flow].join('/');
    if (key === previous) return;
    previous = key;

    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    primary('対気速度', speed, 'm/s · ピトー管', 115);
    primary('推定高度', height, 'm · ' + source, 485);
    horizon(ctx, pitch, bank);
    text('姿勢', 300, 37, 25);
    ctx.fillStyle = SECONDARY;
    ctx.fillRect(0, 163, WIDTH, 3);
    text('昇降 m/s', 102, 195, 24);
    text(signed(climb), 102, 235, 39);
    text('ピッチ / バンク', 300, 195, 24);
    text(signed(pitch) + '° / ' + signed(bank) + '°', 300, 234, 32);
    text('ラダー', 505, 195, 24);
    const rudderText = rudder === 0 ? '中立' : (rudder > 0 ? '右' : '左') + Math.abs(rudder) + '°';
    text(rudderText, 505, 234, 33);
    ctx.fillStyle = INK;
    ctx.fillRect(0, 248, WIDTH, 52);
    text(time, 62, 283, 29, PAPER);
    text('進路 ' + course + '°', 218, 283, 27, PAPER);
    if (wind.speed >= 0.05) windArrow(ctx, flow);
    text(wind.speed < 0.05 ? '無風' : '風 ' + windSpeed + ' m/s', 483, 283, 27, PAPER);

    texture.needsUpdate = true;
    describe('対気速度 ' + speed + ' m/s（ピトー管）、推定高度 ' + height + ' m（' + source + '）、昇降 ' + signed(climb) +
      ' m/s、ピッチ ' + signed(pitch) + '°、バンク ' + signed(bank) + '°、ラダー ' + rudderText +
      '、進路 ' + course + '°、風速 ' + windSpeed + ' m/s、' + (next.t === undefined ? '台上' : '離台後 ' + Math.floor(next.t) + ' 秒') + '。');
  }
  return { update, get sample() { return sample; }, get instruments() { return instruments; } };
}
